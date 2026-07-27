import { Hono } from "hono";
import { cors } from "hono/cors";
import { getRequestListener } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getAddress } from "viem";
import { NETWORK, CFG } from "../src/config.js";
import { answer } from "../src/inference.js";
import { recordReceipt } from "../src/receipts.js";
import { settleRefund } from "../src/refund.js";

export const config = { runtime: "nodejs" };

const PAY_TO = getAddress(process.env.SELLER_PAY_TO!);

const facilitator = new HTTPFacilitatorClient({
  url: CFG.facilitator,
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
        price: {
          // Celo is absent from the packages' default-asset table, so a bare
          // dollar price throws at request time. 6 decimals: $0.01 = "10000".
          amount: "10000",
          asset: getAddress(CFG.usdc),
          extra: { name: "USDC", version: "2" as const },
        },
      },
    ],
    description: "One question answered, paid per call.",
  },
};

const app = new Hono().basePath("/");

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["content-type", "x-payment"],
    exposeHeaders: ["payment-required", "payment-response"],
  }),
);
/**
 * Settlement happens *after* the route handler returns, so the receipt header
 * does not exist inside the handler — checking there silently recorded nothing.
 * This wraps the payment middleware instead, and runs once settlement is real.
 */
app.use("/api/ask", async (c, next) => {
  await next();
  const header = c.res?.headers.get("payment-response");
  if (!header) return;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString());
    const hash = decoded.transaction ?? decoded.txHash;
    const payer = decoded.payer ?? decoded.from;
    if (hash && payer) recordReceipt(payer, 10_000n, hash);
  } catch {
    // A malformed receipt header must never affect the paid response.
  }
});

app.use(paymentMiddleware(routes, server));

// Refunds. The session key cannot send an ordinary transfer (it holds USDC and
// no CELO), so returning funds goes through the facilitator like any payment.
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
  c.json({ ok: true, network: NETWORK, caip: CFG.caip, payTo: PAY_TO }),
);

app.post("/api/ask", async (c) => {
  const { q } = await c.req.json<{ q?: string }>().catch(() => ({ q: undefined }));
  if (!q?.trim()) return c.json({ error: "ask something" }, 400);
  return c.json({ answer: await answer(q) });
});

/**
 * hono/vercel's handle() assumes a Web Request, but Vercel's Node runtime
 * delivers a Node IncomingMessage. The app itself worked; the x402 middleware
 * blew up reading headers off an object that has none — "this.raw.headers.get
 * is not a function", visible only in the runtime logs, surfacing as a hang.
 *
 * getRequestListener does the Node -> Web conversion properly.
 */
export default getRequestListener(app.fetch);
