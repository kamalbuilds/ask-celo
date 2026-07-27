#!/usr/bin/env node
/**
 * app.test.mjs — the service contract, asserted against a running instance.
 *
 * The service used to exist twice and drift. It is one module now, but the
 * behaviour that matters was only ever checked by hand against a deployed URL.
 * These run it in-process, so a refactor cannot quietly change what buyers see.
 *
 *   tsx scripts/app.test.mjs
 */
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";

process.env.SELLER_PAY_TO ??= "0x000000000000000000000000000000000000dEaD";
process.env.X402_API_KEY ??= "test-key-not-used-for-these-checks";

const { createApp } = await import("../src/app.ts");
const { PRICE, CFG } = await import("../src/config.ts");

// Port 0 lets the OS pick a free one, so this never collides with a dev server.
const server = serve({ fetch: createApp().fetch, port: 0 });
const { port } = server.address();
const url = (p) => `http://127.0.0.1:${port}${p}`;

let n = 0;
const check = async (name, fn) => {
  n++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

console.log("service contract");

await check("health states the price the challenge will charge", async () => {
  const res = await fetch(url("/api/health"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.price.amount, PRICE.amount, "health quotes a different amount than PRICE");
  assert.equal(body.price.display, PRICE.display);
  assert.equal(body.caip, CFG.caip, "health reports the wrong network");
});

await check("an unpaid ask is 402, never 200", async () => {
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "dollar to shillings" }),
  });
  // The whole product depends on this. A 200 here is giving away the answer.
  assert.equal(res.status, 402, `unpaid request returned ${res.status}`);
});

await check("the 402 challenge names our payTo, asset and amount", async () => {
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "x" }),
  });
  const header = res.headers.get("payment-required");
  assert.ok(header, "no payment-required header");
  const accepts = JSON.parse(Buffer.from(header, "base64").toString()).accepts?.[0];
  assert.equal(accepts.network, CFG.caip);
  assert.equal(accepts.amount, PRICE.amount, "challenge amount disagrees with PRICE");
  assert.equal(accepts.asset.toLowerCase(), CFG.usdc.toLowerCase());
  assert.equal(accepts.payTo.toLowerCase(), process.env.SELLER_PAY_TO.toLowerCase());
});

await check("the refund endpoint rejects incomplete input", async () => {
  const res = await fetch(url("/api/refund"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /signature and authorization/);
});

await check("the browser can read the headers it needs", async () => {
  // Without these exposed, a cross-origin caller cannot see the challenge or
  // the receipt, and the payment loop silently cannot complete.
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://ask-celo.vercel.app" },
    body: JSON.stringify({ q: "x" }),
  });
  const exposed = res.headers.get("access-control-expose-headers") ?? "";
  assert.match(exposed, /payment-required/);
  assert.match(exposed, /payment-response/);
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
server.close();
