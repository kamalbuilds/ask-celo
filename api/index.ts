import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getAddress } from "viem";
import { NETWORK, CFG } from "../src/config.js";
import { answer } from "../src/inference.js";

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
app.use(paymentMiddleware(routes, server));

app.get("/api/health", (c) =>
  c.json({ ok: true, network: NETWORK, caip: CFG.caip, payTo: PAY_TO }),
);

app.post("/api/ask", async (c) => {
  const { q } = await c.req.json<{ q?: string }>().catch(() => ({ q: undefined }));
  if (!q?.trim()) return c.json({ error: "ask something" }, 400);
  return c.json({ answer: await answer(q) });
});

export default handle(app);
