import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getAddress } from "viem";
import { NETWORK, CFG, PRICE } from "./config.js";
import { answer } from "./inference.js";
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
    return c.json({ answer: await answer(q) });
  });

  return app;
}
