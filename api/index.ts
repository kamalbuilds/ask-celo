import { getRequestListener } from "@hono/node-server";
import { createApp } from "../src/app.js";

export const config = { runtime: "nodejs" };

/**
 * Production entry point. hono/vercel's handle() assumes a Web Request, but
 * Vercel's Node runtime delivers a Node IncomingMessage — the x402 middleware
 * then fails reading headers off an object that has none, which surfaces as a
 * hang rather than an error. getRequestListener converts properly.
 */
export default getRequestListener(createApp().fetch);
