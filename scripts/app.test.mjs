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
process.env.X402_API_KEY ??= "x402_test_key_not_used_for_these_checks";

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
    // Must be a question we can answer: unanswerable ones are refused for
    // free before the paywall, so they never produce a challenge.
    body: JSON.stringify({ q: "what is a dollar in shillings" }),
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


await check("every browser-facing env var has a VITE_ twin in go-live", async () => {
  // Two production bugs came from setting the server form and not the browser
  // one. This asserts the deploy script sets both, so the third does not happen.
  const { readFileSync } = await import("node:fs");
  const goLive = readFileSync(new URL("./go-live.sh", import.meta.url), "utf8");
  const { BROWSER_KEYS } = await import("../src/config.ts");
  for (const key of BROWSER_KEYS) {
    assert.ok(goLive.includes(`VITE_${key}=`), `go-live.sh never sets VITE_${key}`);
  }
});


await check("an unreadable balance never lets anyone spend", async () => {
  // The bug: refreshBalance threw before disabling anything, so Ask stayed
  // clickable over a placeholder balance and the user paid for a request that
  // could not complete. On 2G this is a normal condition, not an edge case.
  const { unknownBalance } = await import("../src/balance.ts");
  assert.equal(unknownBalance.canAsk, false, "Ask enabled with an unknown balance");
  assert.equal(unknownBalance.canSweep, false, "sweep offered with an unknown balance");
  assert.match(unknownBalance.message, /connection/i, "the message does not explain why");
});

await check("the balance view gates spending on affordability", async () => {
  const { balanceView } = await import("../src/balance.ts");
  const { PRICE } = await import("../src/config.ts");

  // An empty session with a funded wallet is one tap from working; an empty
  // wallet is a dead end. Telling the second group to "add credit" is advice
  // they cannot act on, which is the difference between a stalled user and a
  // lost one.
  const noFunds = balanceView(0, 0);
  assert.match(noFunds.message, /need USDC/i, "a user with no USDC anywhere is told to add credit");
  const canTopUp = balanceView(0, 5);
  assert.match(canTopUp.message, /Add credit/i, "a funded wallet is not offered the top-up path");

  const empty = balanceView(0);
  assert.equal(empty.canAsk, false, "can ask with nothing");
  assert.equal(empty.canSweep, false, "can sweep nothing");
  assert.equal(empty.showStorageWarning, false, "warns about losing an empty balance");

  // Exactly one question's worth must be enough, and a fraction must not be.
  assert.equal(balanceView(PRICE.usd).canAsk, true, "exactly one question is not affordable");
  assert.equal(balanceView(PRICE.usd / 2).canAsk, false, "half a question is affordable");

  const funded = balanceView(5);
  assert.equal(funded.canAsk, true);
  assert.equal(funded.balance, "$5.00");
  assert.match(funded.message, /500 questions left/);
  assert.equal(funded.showStorageWarning, true, "no warning while holding real money");
});


await check("the docs describe the product that actually ships", async () => {
  // SUBMISSION.md spent hours describing a product two pivots old: every
  // command in it was valid and every fact was true, and the overall
  // description was still wrong. Nothing fails when docs rot, so this asserts
  // the headline capabilities are named where a judge would read them.
  const { readFileSync } = await import("node:fs");
  const { answer } = await import("../src/inference.ts");

  // What the product leads with, taken from the product itself.
  const fx = await answer("what is USD to KES");
  const remittance = await answer("what does it cost to send money home");
  assert.match(fx, /1 USD = [\d.]+ KES/, "the FX answer changed shape");
  assert.match(remittance, /Sending \$\d+ in stablecoins on Celo costs/, "the remittance answer changed shape");

  for (const file of ["../README.md", "../docs/SUBMISSION.md"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8").toLowerCase();
    assert.ok(
      /exchange rate|what is my money worth|shillings/.test(text),
      `${file} does not mention the FX answer the product leads with`,
    );
    assert.ok(
      /remittance|cost to send|sending money/.test(text),
      `${file} does not mention what sending money costs`,
    );
  }
});


await check("every command and link in the docs exists", async () => {
  // Docs accumulate references to things that get renamed. A dead link or a
  // command that no longer exists is the first thing a judge hits, and nothing
  // fails when it rots.
  const { readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

  const docs = ["README.md", "STATUS.md", "docs/TRY-IT.md", "docs/GO-LIVE.md"];
  for (const doc of docs) {
    const text = readFileSync(`${root}/${doc}`, "utf8");

    for (const m of text.matchAll(/npm run ([a-z:0-9-]+)/g)) {
      assert.ok(pkg.scripts[m[1]], `${doc} references missing script: npm run ${m[1]}`);
    }
    // Two syntaxes to follow: markdown links, and bare paths in backticks —
    // the docs list files as `docs/NAME.md` rather than linking them, so a
    // check that only understood [text](link) matched nothing and passed a
    // deliberately broken reference.
    const dir = doc.includes("/") ? doc.slice(0, doc.lastIndexOf("/")) : ".";
    const refs = [
      ...[...text.matchAll(/\]\((?!https?:|mailto:)([^)#\s]+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/`((?:docs\/)?[A-Za-z0-9._-]+\.md)`/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      // A bare `docs/X.md` is written from the repo root wherever it appears.
      const base = ref.startsWith("docs/") ? root : `${root}/${dir}`;
      assert.ok(existsSync(`${base}/${ref}`), `${doc} references a missing file: ${ref}`);
    }
  }
});


await check("the pre-selected amount is the smallest, and the code agrees", async () => {
  // Two failure modes. A $1 default asks a first-time buyer to risk four times
  // more than they need to evaluate the thing — 25c already buys 25 questions.
  // And if the JS default and the markup disagree, the first tap charges an
  // amount the user did not choose.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const html = readFileSync(`${root}/web/index.html`, "utf8");
  const main = readFileSync(`${root}/web/main.ts`, "utf8");

  const amounts = [...html.matchAll(/data-amount="([0-9.]+)"/g)].map((m) => Number(m[1]));
  const selected = Number(html.match(/class="choice is-selected" data-amount="([0-9.]+)"/)?.[1]);
  assert.ok(amounts.length > 0, "no amount choices found");
  assert.equal(selected, Math.min(...amounts), "the default is not the smallest amount offered");

  // The code must read the default from the markup rather than hardcoding it.
  assert.match(main, /\.choice\.is-selected/, "main.ts hardcodes the default instead of reading it");
});


await check("an empty question is refused before it costs anything", async () => {
  // The handler returns early on an empty box, so no payment is attempted.
  // Worth asserting: the server also refuses, so a client bug cannot turn
  // whitespace into a charge.
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "   " }),
  });
  // 402 (payment first) or 400 (rejected) are both fine. A 200 would mean
  // paying for nothing.
  assert.notEqual(res.status, 200, "an empty question returned an answer");
});

await check("the answered question is cleared from the box", async () => {
  // Left in place, a second question starts with manual deletion and a repeat
  // tap re-charges for something already on screen.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(fileURLToPath(new URL("../web/main.ts", import.meta.url)), "utf8");
  const afterAnswer = main.slice(main.indexOf('$("answer").textContent = answer'));
  assert.match(
    afterAnswer.slice(0, 400),
    /\("q"\)\.value = ""/,
    "the question is not cleared after it is answered",
  );
});


await check("an unanswerable question is refused free, not charged", async () => {
  // The payment middleware charges on the way in. Without a pre-check, asking
  // something off-topic costs $0.01 and returns a list of suggestions —
  // a refund request, and the fastest way to lose a first-time payer.
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "what is the capital of France" }),
  });
  assert.equal(res.status, 400, `off-topic question returned ${res.status}, not a free refusal`);
  const body = await res.json();
  assert.ok(body.hint?.includes("USD to KES"), "the refusal does not say what it can answer");
});

await check("an answerable question still reaches the paywall", async () => {
  // The guard must not swallow real questions. A topic match should get past
  // it and hit the 402, not the 400.
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "what is a dollar in shillings" }),
  });
  assert.equal(res.status, 402, `answerable question returned ${res.status}, not a payment challenge`);
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
server.close();
