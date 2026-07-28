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
  // Anchor on the paid-answer call, not on a DOM assignment: the assignment
  // moved into showAnswer() during a refactor and this check broke while the
  // behaviour was fine. Anchor on what the code does, not how it is spelled.
  const afterAnswer = main.slice(main.indexOf("showAnswer(answer)"));
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


await check("the free refusal is shown to the user, not swallowed as an error", async () => {
  // The server refuses off-topic questions with a hint. If the client renders
  // "request failed (400)" instead, the user sees a broken app rather than
  // the one message that tells them what to ask.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(fileURLToPath(new URL("../web/main.ts", import.meta.url)), "utf8");
  const guard = main.slice(main.indexOf("if (!res.ok)"), main.indexOf("if (!res.ok)") + 600);
  assert.match(guard, /body\.hint/, "the client ignores the server's hint on a refusal");
});


await check("build output is not tracked in source", async () => {
  // Vercel runs `npm run build`, so a committed dist/ is never served — it is
  // stale output that can silently disagree with web/. Reviewing a diff where
  // the bundle says one thing and the source another wastes real time, and it
  // is how "I fixed that" turns into "the fix is not live".
  const { execSync } = await import("node:child_process");
  const tracked = execSync("git ls-files dist/", { encoding: "utf8" }).trim();
  assert.equal(tracked, "", `dist/ is tracked in git:\n${tracked}`);
});


await check("questions about the service are answered free", async () => {
  // "Is this a scam" behind a paywall answers itself. These are what a
  // stranger asks while deciding whether to pay at all, before they have
  // agreed to anything. Charging is absurd; refusing is a dead end at the
  // exact moment trust is decided.
  for (const q of ["is this a scam", "can I get a refund", "what happens to my money"]) {
    const res = await fetch(url("/api/ask"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q }),
    });
    assert.equal(res.status, 200, `"${q}" returned ${res.status} instead of a free answer`);
    const { answer } = await res.json();
    assert.ok(answer.length > 100, `"${q}" got a stub answer`);
  }
});

await check("the free path does not swallow paid questions", async () => {
  // A generous free match is a revenue hole: every question it catches is one
  // nobody pays for. Real questions must still hit the paywall.
  const res = await fetch(url("/api/ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "how much does it cost to send money to india" }),
  });
  assert.equal(res.status, 402, `a paid question returned ${res.status}, not a payment challenge`);
});

await check("the free answer only claims things that are true", async () => {
  // A page can say anything about money. This one says refunds work with no
  // CELO and that questions are not stored — both must be backed by code.
  const { aboutAnswer } = await import("../src/inference.ts");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const a = await aboutAnswer();
  const session = readFileSync(fileURLToPath(new URL("../src/session.ts", import.meta.url)), "utf8");

  if (/no CELO|without .*CELO|holds no CELO/i.test(a)) {
    assert.match(
      session,
      /transferWithAuthorization|TransferWithAuthorization/,
      "claims gasless refunds but the sweep is not EIP-3009",
    );
  }
  if (/not stored|are not stored/i.test(a)) {
    const app = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(app, /console\.log\([^)]*\bq\b/, "claims questions are not stored but logs them");
  }
});


await check("the MiniPay path never calls a method MiniPay lacks", async () => {
  // The whole product rests on this: MiniPay implements neither personal_sign
  // nor eth_signTypedData, so any wallet call that needs a signature is a dead
  // end for millions of users. Verified in a real browser with a locked-down
  // MiniPay provider — top-up used eth_sendTransaction only. This asserts the
  // source keeps that property, so a refactor cannot quietly reintroduce a
  // signature prompt on the one path MiniPay users must take.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const session = readFileSync(fileURLToPath(new URL("../src/session.ts", import.meta.url)), "utf8");

  // Everything the page asks the INJECTED wallet to do (window.ethereum).
  const walletCalls = [...session.matchAll(/method:\s*"([a-zA-Z_0-9]+)"/g)].map((m) => m[1]);
  const forbidden = walletCalls.filter((m) => /^personal_sign|^eth_sign/.test(m));
  assert.deepEqual(
    forbidden,
    [],
    `these ask MiniPay for a signature it cannot give: ${forbidden.join(", ")}`,
  );
  assert.ok(
    walletCalls.includes("eth_sendTransaction"),
    "the top-up no longer uses a plain transfer",
  );
});


await check("the docs do not quote a test count that can go stale", async () => {
  // A hardcoded "35 checks" in a doc is a claim about our own rigor that a
  // judge can check in one command — and it was already wrong by 19. Nothing
  // updates prose when a test is added, so the number must not be there.
  const { readFileSync, readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  // Recurse: docs/ gained a subdirectory and the flat readdir crashed with
  // EISDIR rather than saying so.
  const walk = (dir, prefix) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`) : `${prefix}${e.name}`,
    );
  const docs = ["README.md", "STATUS.md", ...walk(`${root}/docs`, "docs/")];
  const stale = [];
  for (const d of docs) {
    const text = readFileSync(`${root}/${d}`, "utf8");
    for (const m of text.matchAll(/(\d+)\s+(checks|tests|suites)\b/g)) {
      // "7 contract tests" is fixed by the contract's own file; a count that
      // grows with every new check is the one that rots.
      if (m[2] !== "suites" && Number(m[1]) > 10) stale.push(`${d}: "${m[0]}"`);
    }
  }
  assert.deepEqual(stale, [], `these counts will be wrong by the next commit:\n  ${stale.join("\n  ")}`);
});


await check("the price in the docs is the price the server charges", async () => {
  // The price lived in seven places once. It now lives in PRICE, but prose is
  // outside the type system: a doc can quote a price the server does not
  // charge, and a judge or a payer reads the doc.
  const { readFileSync, readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { PRICE } = await import("../src/config.ts");
  const root = fileURLToPath(new URL("..", import.meta.url));
  // Recurse: docs/ gained a subdirectory and the flat readdir crashed with
  // EISDIR rather than saying so.
  const walk = (dir, prefix) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`) : `${prefix}${e.name}`,
    );
  const docs = ["README.md", "STATUS.md", ...walk(`${root}/docs`, "docs/")];
  const wrong = [];
  for (const d of docs) {
    for (const m of readFileSync(`${root}/${d}`, "utf8").matchAll(/\$0\.\d+ (per|a) question/g)) {
      if (!m[0].startsWith(PRICE.display)) wrong.push(`${d}: "${m[0]}" but we charge ${PRICE.display}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n  "));
});


await check("the README's promise about not charging is enforced by code", async () => {
  // The README now promises two things about money: unanswerable questions are
  // refused before payment, and questions about the service are free. Prose is
  // outside the type system, so this is the category of bug no test catches —
  // a page asserting something about money that nothing measured. Hold the
  // promise to the running server, not to a string.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  if (!/refused before payment/i.test(readme)) return; // promise not made

  const ask = (q) =>
    fetch(url("/api/ask"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q }),
    });

  const offTopic = await ask("what is the capital of France");
  assert.equal(offTopic.status, 400, "README promises a free refusal; the server charges");

  const about = await ask("is this a scam");
  assert.equal(about.status, 200, "README promises service questions are free; the server charges");
});


await check("a POST with no body does not hang", async () => {
  // This is the check that would have caught a 30s production hang. The
  // pre-check read the body with c.req.raw.clone().json(); the clone's stream
  // was never consumed, and on Vercel's Node runtime every POST to /api/ask
  // stalled until the gateway gave up — including one with no body.
  //
  // The whole suite passed while production was down, because Node's fetch
  // and Vercel's runtime handle an abandoned clone differently. A timeout is
  // the only assertion that survives that difference.
  for (const init of [{}, { body: "" }, { body: "not json" }]) {
    const t0 = Date.now();
    const res = await fetch(url("/api/ask"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5000),
      ...init,
    }).catch((e) => {
      throw new Error(`POST ${JSON.stringify(init)} never returned: ${e.message}`);
    });
    assert.ok(Date.now() - t0 < 5000, `POST ${JSON.stringify(init)} took too long`);
    assert.ok(res.status < 500, `POST ${JSON.stringify(init)} returned ${res.status}`);
  }
});

await check("the request body is read once, through the cached parser", async () => {
  // c.req.json() caches on the context; c.req.raw.clone() does not, and the
  // abandoned stream is what hung production. The timeout check above cannot
  // see this locally, so assert the shape directly.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  // Strip comments first: this file explains the bug, and the explanation
  // must not trip the check that guards against it.
  const app = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    app,
    /raw\s*\.\s*clone\(\)/,
    "reading the body via raw.clone() hangs POSTs on Vercel's Node runtime",
  );
});


await check("the scoring harness asks questions the service still answers", async () => {
  // gates.mjs asked "gate check", which is not answerable, so the free
  // refusal caught it before the paywall and the kill test stopped testing
  // settlement. A harness that silently stops measuring is worse than one
  // that fails: it reports green.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { canAnswer } = await import("../src/inference.ts");
  const gates = readFileSync(fileURLToPath(new URL("./gates.mjs", import.meta.url)), "utf8");
  const asked = [...gates.matchAll(/\bq:\s*"([^"]+)"/g)].map((m) => m[1]);
  const refused = asked.filter((q) => !canAnswer(q));
  assert.deepEqual(refused, [], `the harness asks questions we refuse: ${refused.join(", ")}`);
});

await check("settlement counts name the network they came from", async () => {
  // gates.mjs defaulted to testnet while production sold on mainnet, and
  // reported "9 settlements" — a flattering number for a chain nobody was
  // paying on. A count without its network is not evidence.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const here = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
  assert.match(here("./gates.mjs"), /settlements on \$\{NETWORK\}/, "gates.mjs reports a bare count");
  assert.match(here("./readiness.mjs"), /celo mainnet\)/, "readiness.mjs reports a bare count");
});


await check("the Ask button works at a zero balance", async () => {
  // Free answers are for the visitor who has not paid yet. A button disabled
  // until they top up made every one of them unreachable by the exact person
  // they exist for — the free paths worked over HTTP and could not be reached
  // from the page. Verified in a browser at $0: "is this a scam" answers.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(fileURLToPath(new URL("../web/main.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(
    main,
    /ask-btn"\)\.disabled = !view\.canAsk/,
    "the Ask button is gated on balance, so free answers cannot be reached",
  );
  // And a paid question at $0 must explain itself rather than throw a status.
  assert.match(
    main,
    /res\.status === 402/,
    "a paid question with no credit shows a raw error instead of saying to top up",
  );
});


await check("every tx hash cited in the docs names its chain", async () => {
  // Four docs cited a settlement as proof without saying which chain. It was
  // Celo Sepolia; the service sells on mainnet, so a judge would fairly read
  // "proven on-chain" as mainnet. An unlabelled hash next to a claim is the
  // most expensive kind of imprecision: it reads as stronger evidence than it
  // is, and it is checkable in one click.
  const { readFileSync, readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  // Recurse: docs/ gained a subdirectory and the flat readdir crashed with
  // EISDIR rather than saying so.
  const walk = (dir, prefix) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`) : `${prefix}${e.name}`,
    );
  const docs = ["README.md", "STATUS.md", ...walk(`${root}/docs`, "docs/")];
  const unlabelled = [];
  for (const d of docs) {
    const lines = readFileSync(`${root}/${d}`, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/0x[0-9a-f]{64}/i.test(line)) return;
      // The chain may be named on the hash's line or in the two lines either
      // side, since markdown wraps.
      const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      if (!/sepolia|mainnet|testnet/i.test(context)) unlabelled.push(`${d}:${i + 1}`);
    });
  }
  assert.deepEqual(unlabelled, [], `tx hashes cited without a chain:\n  ${unlabelled.join("\n  ")}`);
});


await check("the answer is scrolled into view when it appears", async () => {
  // On a 360x640 phone the answer renders ~500px tall, below the fold. The
  // user taps Ask, nothing appears to happen, and the product looks broken at
  // the moment it worked. Desktop hid this because the whole page fits.
  // Verified in an emulated phone: without the scroll the answer sits at
  // y=854 in a 640px viewport; with it, scrollY=770 and it is visible.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(fileURLToPath(new URL("../web/main.ts", import.meta.url)), "utf8");
  assert.match(main, /scrollIntoView/, "the answer is revealed without being scrolled to");
  // Not smooth: it is ignored under headless emulation and with reduced-motion,
  // so the behaviour that matters could not be verified. Instant always runs.
  assert.doesNotMatch(
    main,
    /scrollIntoView\(\{[^}]*smooth/,
    "smooth scrolling cannot be verified and is skipped under reduced-motion",
  );
  // And every path that reveals an answer must go through the same helper.
  const reveals = [...main.matchAll(/show\("answer"\)/g)].length;
  assert.equal(reveals, 1, `show("answer") appears ${reveals} times; it belongs only in showAnswer()`);
});


await check("touch targets meet the 44px minimum", async () => {
  // Measured on a 360x640 phone: the example-question chips were 36px tall.
  // Those are the control that shows a new visitor what to ask, so a mistap
  // there costs the first impression. WCAG 2.5.5 and both platform guidelines
  // say 44.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const css = readFileSync(fileURLToPath(new URL("../web/style.css", import.meta.url)), "utf8");
  const example = css.slice(css.indexOf(".example {"), css.indexOf(".example {") + 400);
  assert.match(example, /min-height:\s*44px/, "example chips are under the 44px touch minimum");
});

await check("the answer is announced to a screen reader", async () => {
  // The answer arrives asynchronously after payment. Without a live region a
  // screen-reader user pays a cent and is told nothing at all.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const html = readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8");
  const answer = html.slice(html.indexOf('id="answer"') - 100, html.indexOf('id="answer"') + 200);
  assert.match(answer, /aria-live/, "the answer element has no aria-live, so it is never announced");
});


await check("a failed chain read says the payment was not taken", async () => {
  // Verified against a dead RPC: the handler threw and Hono returned a bare
  // "Internal Server Error". The x402 middleware cancels settlement on any
  // status >= 400, so the money was safe — but the user had no way to know
  // that, and "Internal Server Error" after paying reads as money gone.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const app = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");
  const handler = app.slice(app.indexOf('app.post("/api/ask"'));
  assert.match(handler.slice(0, 900), /try\s*\{/, "the answer call is not guarded");
  assert.match(handler.slice(0, 900), /not taken|not charged/i, "the failure never says the payment was not taken");
  // Must be >= 400 or the middleware settles a request that produced no answer.
  assert.match(handler.slice(0, 900), /50[0-9],/, "the failure status would let settlement proceed");
});


await check("no source file restates a URL that config already owns", async () => {
  // Duplicated constants are the single most productive bug source in this
  // codebase: the price in seven places, the service defined twice, the
  // suggestion text in two spots, a committed dist/, a mainnet RPC in both
  // config.ts and inference.ts. Each pair agreed when written and had nothing
  // keeping it that way.
  const { readFileSync, readdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const offenders = [];
  for (const f of readdirSync(root).filter((f) => f.endsWith(".ts") && f !== "config.ts")) {
    const src = readFileSync(`${root}/${f}`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const m of src.matchAll(/"(https:\/\/(?:forno|api\.x402)[^"]*)"/g)) {
      offenders.push(`${f}: ${m[1]}`);
    }
  }
  // Scripts too. gates.mjs and verify-signature.mjs each kept a private copy
  // of the network table, which is how the scoring harness spent a day
  // checking testnet while production sold on mainnet.
  const scripts = fileURLToPath(new URL(".", import.meta.url));
  for (const f of readdirSync(scripts).filter((f) => f.endsWith(".mjs"))) {
    const src = readFileSync(`${scripts}/${f}`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // A CAIP id or the USDC address outside config means a second source of
    // truth for which chain we are on.
    for (const m of src.matchAll(/"(eip155:\d+|0xcebA9300[0-9a-fA-F]*)"/g)) {
      offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `these restate a URL config owns:\n  ${offenders.join("\n  ")}`);
});


await check("the ERC-8004 registration would actually succeed", async () => {
  // The registry address and ABI had never been exercised: go-live would have
  // spent gas from a hand-funded wallet to find out. Simulated against Celo
  // mainnet, which proves both without sending anything.
  const { createPublicClient, http } = await import("viem");
  const { NETWORKS } = await import("../src/config.ts");
  const cfg = NETWORKS.mainnet;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { retryCount: 3, retryDelay: 300 }),
  });
  const abi = [
    {
      type: "function",
      name: "register",
      stateMutability: "nonpayable",
      inputs: [{ name: "agentURI", type: "string" }],
      outputs: [{ name: "agentId", type: "uint256" }],
    },
  ];
  const res = await client
    .simulateContract({
      address: cfg.registry8004,
      abi,
      functionName: "register",
      args: ["ipfs://bafkreiexampleexampleexampleexampleexampleexampleexampleexam"],
      account: "0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77",
    })
    .catch((e) => ({ error: e.shortMessage ?? e.message }));
  assert.ok(!res.error, `registration would revert: ${res.error}`);
  assert.ok(typeof res.result === "bigint", "registry returned no agent id");
});


await check("the contract is deployable and the funding ask matches its cost", async () => {
  // go-live spends gas from a wallet funded by hand. The bytecode had never
  // been estimated against mainnet, and the documented cost was a guess that
  // ran about 5x high — asking someone for five times what a thing needs is
  // its own kind of wrong number about money.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { createPublicClient, http } = await import("viem");
  const { NETWORKS } = await import("../src/config.ts");

  const artifactPath = fileURLToPath(new URL("../out/AskReceipts.sol/AskReceipts.json", import.meta.url));
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    console.log("  skip  contract not built (run forge build)");
    return;
  }

  const cfg = NETWORKS.mainnet;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { retryCount: 3, retryDelay: 300 }),
  });
  const recorder = "E626fC73E7FcE36a2371D7B4f3482Aed17308A77";
  const gas = await client
    .estimateGas({
      account: `0x${recorder}`,
      data: `${artifact.bytecode.object}000000000000000000000000${recorder}`,
    })
    .catch((e) => ({ error: e.shortMessage ?? e.message }));
  assert.ok(typeof gas === "bigint", `the contract would not deploy: ${gas.error}`);

  // The documented floor must cover the real cost with headroom.
  const price = await client.getGasPrice();
  const celo = (Number(gas) * Number(price)) / 1e18;
  const goLive = readFileSync(fileURLToPath(new URL("./go-live.sh", import.meta.url)), "utf8");
  const floor = Number(/BAL_CELO < ([\d.]+)/.exec(goLive)?.[1]);
  assert.ok(Number.isFinite(floor), "go-live.sh has no balance floor");
  assert.ok(floor > celo, `floor ${floor} CELO is below the ${celo.toFixed(3)} deploy alone`);
  assert.ok(floor < celo * 10, `floor ${floor} CELO asks for far more than the ${celo.toFixed(3)} needed`);
});


await check("submission values match the hosts the organizers accept", async () => {
  // The organizers restrict several fields to specific hosts, and publishing
  // rejects anything else. Finding that out at submission time, against a
  // deadline, is the worst moment to learn it. Checked against their live
  // field spec rather than a copy of it.
  const { readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));

  const spec = await fetch(
    "https://celobuilders.xyz/hackathons/agentic-payments-defai/submission-fields",
    { signal: AbortSignal.timeout(15_000) },
  )
    .then((r) => r.json())
    .catch(() => null);
  if (!spec) {
    console.log("  skip  celobuilders unreachable");
    return;
  }
  const fields = Array.isArray(spec) ? spec : (spec.submissionFields ?? spec.fields ?? []);
  assert.ok(fields.length > 0, "no submission fields returned");

  const state = existsSync(`${root}/.submission.json`)
    ? JSON.parse(readFileSync(`${root}/.submission.json`, "utf8"))
    : {};

  for (const f of fields) {
    const value = state[f.key];
    if (!value) continue; // absent is a readiness question, not a validity one
    if (f.allowedHosts?.length) {
      const host = new URL(value).hostname;
      assert.ok(
        f.allowedHosts.includes(host),
        `${f.key} is ${host}, which is not in ${f.allowedHosts.join(", ")}`,
      );
    }
    if (f.options?.length) {
      assert.ok(f.options.includes(value), `${f.key} is "${value}", not one of ${f.options.join(", ")}`);
    }
  }

  // go-live builds the 8004 URL. Its host must be acceptable before it runs.
  const goLive = readFileSync(`${root}/scripts/go-live.sh`, "utf8");
  const built = /erc8004Url"\] = f"https:\/\/([^/]+)/.exec(goLive)?.[1];
  const allowed = fields.find((f) => f.key === "erc8004Url")?.allowedHosts;
  if (built && allowed) {
    assert.ok(allowed.includes(built), `go-live builds an 8004 URL on ${built}, not in ${allowed.join(", ")}`);
  }
});


await check("registering is not entering: a publish path exists", async () => {
  // The live skill is explicit that publishing is a separate POST from saving
  // a draft. register.mjs had start/claim/status and no way to publish, so
  // following it end to end would have left the project registered, tagged,
  // and never actually entered.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("./register.mjs", import.meta.url)), "utf8");
  assert.match(src, /submissions\/me\/publish/, "no publish call: registering alone does not enter");
  assert.match(src, /confirm: true/, "publish must confirm");
  // socialLink is the documented exception to customFields. Sending it in the
  // wrong place is a 400 at the worst moment.
  assert.match(src, /delete customFields\.socialLink/, "socialLink must be sent top-level, not in customFields");
});


await check("we satisfy the hackathon's own rules", async () => {
  // Read from their API, not from memory. "Celo mainnet only" is a rule, and
  // the docs led with a testnet proof hash for most of a day — honest, but it
  // reads like a violation to anyone skimming.
  const rules = await fetch("https://celobuilders.xyz/hackathons/agentic-payments-defai/rules", {
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!rules) {
    console.log("  skip  celobuilders unreachable");
    return;
  }
  const text = JSON.stringify(rules).toLowerCase();

  if (text.includes("mainnet only") || text.includes("celo-mainnet")) {
    // The live service must actually be on mainnet.
    const health = await fetch("https://ask-celo.vercel.app/api/health", {
      signal: AbortSignal.timeout(20_000),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (health) {
      assert.equal(health.network, "mainnet", "the rule is mainnet only and we are not on mainnet");
      // From config, not a literal: the duplicate-constant check flagged my
      // own hardcoded CAIP id here, which is exactly what it is for.
      const { NETWORKS } = await import("../src/config.ts");
      assert.equal(health.caip, NETWORKS.mainnet.caip);
    }
  }

  if (text.includes("public github")) {
    const repo = await fetch("https://api.github.com/repos/kamalbuilds/ask-celo", {
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (repo) assert.equal(repo.private, false, "the rule requires a public repo");
  }
});


await check("the icon the page and Aigora both point at exists in the build", async () => {
  // The live site had no favicon at all, and the Aigora registration draft
  // cited an icon URL that 404'd. Both referenced a file that did not exist.
  const { existsSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));

  const html = readFileSync(`${root}/web/index.html`, "utf8");
  const href = /<link rel="icon"[^>]*href="([^"]+)"/.exec(html)?.[1];
  assert.ok(href, "the page declares no icon");

  const source = `${root}/web/public${href}`;
  assert.ok(existsSync(source), `${href} is referenced but ${source} does not exist`);

  // It must survive the build, or it 404s in production exactly as before.
  if (existsSync(`${root}/dist`)) {
    assert.ok(existsSync(`${root}/dist${href}`), `${href} is not copied into dist/`);
  }

  // Aigora rejects a malformed image URI, so the SVG must parse.
  const svg = readFileSync(source, "utf8");
  assert.match(svg, /^<svg|^<\?xml/, "the icon is not an SVG");
  assert.ok(!svg.includes("<!--") || !/<!--[^>]*--[^>]*-->/.test(svg), "invalid XML comment in the SVG");
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
server.close();
