import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getAddress } from "viem";
import { NETWORK, CFG, PRICE } from "./config.js";
import { ABOUT_MATCH, aboutAnswer, answer, canAnswer, SUGGESTIONS, TOPIC_EXAMPLES } from "./inference.js";
import { recordReceipt, receiptStats, receiptsEnabled } from "./receipts.js";
import { settleRefund } from "./refund.js";

/**
 * The whole service, built once and mounted by both entry points: a Node
 * server for local work and a Vercel function in production.
 *
 * They were previously two near-identical files. The payment terms, the
 * receipt hook and the refund guard all existed twice, which is the shape that
 * has produced most of this project's bugs — the copies drift, and the one
 * nobody is looking at is the one that ships.
 */
/**
 * Fail at boot, not at the first sale.
 *
 * Without SELLER_PAY_TO the app died deep inside viem with an InvalidAddress
 * stack trace naming neither the variable nor the fix. Without X402_API_KEY it
 * booted fine, served a healthy /api/health, and then failed every settlement:
 * a service that looks up and cannot take money.
 */
function required(key: string, looksValid: (v: string) => boolean = Boolean): string {
  const value = process.env[key];
  // An unfilled placeholder from .env.example is present but useless, and
  // passing a truthy check only moves the failure somewhere less clear: `0x`
  // reached viem and produced "Address 0x is invalid" instead of naming the
  // variable the reader needs to fill in.
  if (!value || !looksValid(value)) {
    throw new Error(
      `${key} is not set to a usable value (got ${JSON.stringify(value ?? null)}). ` +
        `The service cannot take payments without it — see .env.example.`,
    );
  }
  return value;
}

const isAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v);

export function createApp() {
  const PAY_TO = getAddress(required("SELLER_PAY_TO", isAddress));
  required("X402_API_KEY", (v) => v.startsWith("x402_"));

  const facilitator = new HTTPFacilitatorClient({
    url: CFG.facilitator,
    // The API key is a facilitator credential. It goes to the facilitator and
    // nowhere else — never to buyers, never to the browser.
    createAuthHeaders: async () => {
      const h = { "X-API-Key": process.env.X402_API_KEY! };
      return { verify: h, settle: h, supported: h };
    },
  });

  const server = new x402ResourceServer(facilitator);
  server.register("eip155:*", new ExactEvmScheme());

  const routes = {
    "POST /api/ask": {
      accepts: [
        {
          scheme: "exact" as const,
          network: CFG.caip,
          payTo: PAY_TO,
          // Celo is absent from the x402 packages' default-asset table, so a
          // bare `price: "$0.01"` type-checks and then 500s at request time.
          // The explicit price object is mandatory here, not stylistic.
          price: {
            amount: PRICE.amount,
            asset: getAddress(CFG.usdc),
            extra: { name: "USDC", version: "2" as const },
          },
        },
      ],
      description: "One question answered, paid per call.",
    },
  };

  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowHeaders: ["content-type", "x-payment"],
      exposeHeaders: ["payment-required", "payment-response"],
    }),
  );

  // Settlement happens *after* the route handler returns, so the receipt header
  // does not exist inside the handler — checking there silently recorded
  // nothing. This wraps the payment middleware and runs once settlement is real.
  app.use("/api/ask", async (c, next) => {
    await next();
    const header = c.res?.headers.get("payment-response");
    if (!header) return;
    try {
      const decoded = JSON.parse(Buffer.from(header, "base64").toString());
      const hash = decoded.transaction ?? decoded.txHash;
      const payer = decoded.payer ?? decoded.from;
      if (hash && payer) recordReceipt(payer, PRICE.micros, hash);
    } catch {
      // A malformed receipt header must never affect the paid response.
    }
  });

  // Long enough for any real question, short enough that a large body cannot
  // be used as free compute.
  const MAX_QUESTION_CHARS = 500;

  // Refuse an unanswerable question BEFORE the payment middleware sees it.
  // The middleware charges on the way in, so without this the user pays $0.01
  // to be told what else to try. 402-then-suggestions is a refund request.
  app.use("/api/ask", async (c, next) => {
    // c.req.json() caches the parsed body on the context, so the handler and
    // the payment middleware can both read it afterwards. An earlier version
    // used c.req.raw.clone().json(), which left the clone's stream unconsumed
    // and hung every POST on Vercel's Node runtime for 30s until the gateway
    // gave up — including requests with no body at all.
    const body = await c.req.json<{ q?: string }>().catch(() => ({}) as { q?: string });
    const q = body.q;
    // Bound the input before anything else touches it. A 40KB question reached
    // the paywall and a 1MB one burned seconds of function time before failing
    // on a regex. Nobody asks a real question in more than a couple of hundred
    // characters, and an unbounded body is free compute for whoever wants it.
    if (q && q.length > MAX_QUESTION_CHARS) {
      return c.json(
        {
          error: "question too long",
          hint: `Keep it under ${MAX_QUESTION_CHARS} characters. Nothing this service answers needs more.`,
        },
        400,
      );
    }
    // Questions about the service are answered free. Someone deciding whether
    // to trust us has not agreed to pay anything yet, and "is this a scam"
    // behind a paywall answers itself.
    if (q?.trim() && ABOUT_MATCH.test(q)) {
      return c.json({ answer: await aboutAnswer() });
    }
    if (q?.trim() && !canAnswer(q)) {
      return c.json(
        {
          error: "not something I can answer from chain data",
          hint: SUGGESTIONS,
        },
        400,
      );
    }
    return next();
  });

  app.use(paymentMiddleware(routes, server)); // routes first, then server

  // Refunds. The session key cannot send an ordinary transfer (it holds USDC
  // and no CELO), so returning funds goes through the facilitator like any
  // payment.
  app.post("/api/refund", async (c) => {
    const { signature, authorization } = await c.req
      .json<{ signature?: string; authorization?: Record<string, string> }>()
      .catch(() => ({ signature: undefined, authorization: undefined }));

    if (!signature || !authorization?.from || !authorization?.to || !authorization?.value) {
      return c.json({ error: "signature and authorization required" }, 400);
    }
    try {
      return c.json({ transaction: await settleRefund(signature, authorization) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "refund failed" }, 502);
    }
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      // What this sells, in the same document as what it costs. An agent
      // deciding whether to buy should not have to pay first to find out
      // whether the answer is relevant, and a marketplace crawler has nothing
      // else to read. Derived from the topic table, so it cannot drift from
      // what the service actually answers.
      service: {
        name: "Ask",
        description:
          "Answers questions about money on Celo from live chain reads: exchange " +
          "rates from the Mento oracle, what a transfer costs, remittance " +
          "comparisons, stablecoin supply, and block finality.",
        answers: TOPIC_EXAMPLES,
        free: "Questions about the service, and questions it cannot answer, are not charged.",
      },
      network: NETWORK,
      caip: CFG.caip,
      payTo: PAY_TO,
      // The 402 challenge is base64 in a header, which is right for machines
      // and useless to a person holding a wallet wondering what this costs.
      // State the terms in plain JSON so they are readable with curl alone.
      price: {
        amount: PRICE.amount,
        decimals: 6,
        display: PRICE.display,
        asset: CFG.usdc,
        symbol: "USDC",
      },
      docs: "https://github.com/kamalbuilds/ask-celo/blob/master/docs/TRY-IT.md",
      // Sales can keep working while attribution quietly stops. Surface it.
      receipts: { enabled: receiptsEnabled, ...receiptStats },
    }),
  );

  app.post("/api/ask", async (c) => {
    const { q } = await c.req.json<{ q?: string }>().catch(() => ({ q: undefined }));
    if (!q?.trim()) return c.json({ error: "ask something" }, 400);
    try {
      return c.json({ answer: await answer(q) });
    } catch (err) {
      // A chain read failed after the user paid. The x402 middleware cancels
      // settlement on any status >= 400, so a 502 here means they are not
      // charged — but only if we return a status instead of letting the throw
      // become a bare "Internal Server Error" with no explanation.
      console.error("answer failed:", err);
      return c.json(
        {
          error: "could not read the chain just now",
          hint: "Your payment was not taken. Try again in a moment.",
        },
        502,
      );
    }
  });

  return app;
}
