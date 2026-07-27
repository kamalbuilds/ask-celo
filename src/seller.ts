import { serve } from "@hono/node-server";
import { getAddress } from "viem";
import { NETWORK, CFG } from "./config.js";
import { createApp } from "./app.js";

// Local entry point. The service itself lives in app.ts so this and the Vercel
// function cannot drift apart.
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp().fetch, port });
console.log(
  `seller on :${port} — ${NETWORK} (${CFG.caip}), payTo ${getAddress(process.env.SELLER_PAY_TO!)}`,
);
