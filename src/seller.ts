import { serve } from "@hono/node-server";
import { getAddress } from "viem";
import { NETWORK, CFG } from "./config.js";
import { createApp } from "./app.js";

// Local entry point. The service itself lives in app.ts so this and the Vercel
// function cannot drift apart.
// `|| 3000`, not `?? 3000`: PORT="" is a string, so ?? keeps it, Number("")
// is 0, and the server binds a random port while printing ":0". The printed
// URL is then wrong and nothing says why. Same bug as CELO_RPC="".
const port = Number(process.env.PORT || 3000);
serve({ fetch: createApp().fetch, port });
console.log(
  `seller on :${port} — ${NETWORK} (${CFG.caip}), payTo ${getAddress(process.env.SELLER_PAY_TO!)}`,
);
