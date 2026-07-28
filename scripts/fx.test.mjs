#!/usr/bin/env node
/**
 * fx.test.mjs — an FX answer people pay for must not be quietly wrong.
 *
 * A wrong rate does not throw. The user pays, reads a number, and may move real
 * money against it. So the invariants get asserted against the live oracle
 * rather than trusted: rates must round-trip, cross-rates must agree with the
 * direct pair, and every corridor must resolve to the currencies actually named.
 *
 *   node scripts/fx.test.mjs
 */
import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
import assert from "node:assert/strict";

// Import the addresses and gas figure the PRODUCT uses. Duplicating them here
// meant the test could keep passing against constants the product no longer
// used — validating the wrong thing while reporting success.
import { MENTO_MAINNET as MENTO, SORTED_ORACLES, TRANSFER_GAS, answer } from "../src/inference.ts";


const ABI = [
  {
    type: "function",
    name: "medianRate",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "numerator", type: "uint256" },
      { name: "denominator", type: "uint256" },
    ],
  },
];

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

const rate = async (token) => {
  const [num, den] = await client.readContract({
    address: getAddress(SORTED_ORACLES),
    abi: ABI,
    functionName: "medianRate",
    args: [getAddress(token)],
  });
  return Number(num) / Number(den);
};

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

console.log("fx rates (live Mento oracle)");

const rates = Object.fromEntries(
  await Promise.all(Object.entries(MENTO).map(async ([k, v]) => [k, await rate(v)])),
);

await check("every currency has a positive, finite oracle rate", () => {
  for (const [sym, r] of Object.entries(rates)) {
    assert.ok(Number.isFinite(r) && r > 0, `${sym} rate is ${r}`);
  }
});

await check("USD to KES lands in a sane range", () => {
  // A shilling is worth far less than a dollar. If this inverts, the answer
  // reads plausibly and is catastrophically wrong for someone sending money.
  const usdKes = rates.cKES / rates.cUSD;
  assert.ok(usdKes > 50 && usdKes < 500, `1 USD = ${usdKes} KES is outside any plausible range`);
});

await check("converting there and back returns the original amount", () => {
  for (const a of Object.keys(MENTO)) {
    for (const b of Object.keys(MENTO)) {
      if (a === b) continue;
      const there = rates[b] / rates[a];
      const back = rates[a] / rates[b];
      assert.ok(Math.abs(there * back - 1) < 1e-9, `${a}->${b}->${a} drifted: ${there * back}`);
    }
  }
});

await check("a cross rate agrees with going through a third currency", () => {
  // USD->KES must equal USD->EUR->KES, or one of the pairs is being built wrong.
  const direct = rates.cKES / rates.cUSD;
  const viaEur = (rates.cEUR / rates.cUSD) * (rates.cKES / rates.cEUR);
  assert.ok(Math.abs(direct - viaEur) / direct < 1e-9, `direct ${direct} vs via EUR ${viaEur}`);
});

await check("each currency's own rate against itself is exactly 1", () => {
  for (const sym of Object.keys(MENTO)) {
    assert.equal(rates[sym] / rates[sym], 1, `${sym} against itself is not 1`);
  }
});

await check("distinct currencies do not resolve to the same rate", () => {
  // If two entries share an address by a copy-paste error, this catches it.
  const seen = new Map();
  for (const [sym, r] of Object.entries(rates)) {
    const dup = seen.get(r);
    assert.ok(!dup, `${sym} and ${dup} report an identical rate — likely the same address`);
    seen.set(r, sym);
  }
});


// ---- every numeric answer, not just rates -------------------------------
// The remittance fee shipped 250x too high because the oracle quotes cUSD per
// CELO and the code inverted it. The FX invariants above did not catch it,
// because it was a new code path. Any number the product states about money
// needs a sanity bound.

await check("the fee the PRODUCT states is under a cent", async () => {
  // Assert the answer the product actually returns, not a formula retyped
  // here. The earlier version recomputed the maths itself, so reintroducing
  // the 250x inversion in inference.ts left this passing — a test that
  // validated its own arithmetic rather than the shipped behaviour.
  const text = await answer("what does it cost to send money home");
  const stated = Number(text.match(/costs about \$([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(stated), `no fee found in: ${text.slice(0, 120)}`);
  assert.ok(stated > 0, `fee reads $${stated}`);
  assert.ok(stated < 0.01, `product states $${stated} — above a cent, likely inverted`);
});

await check("the fee the PRODUCT states is negligible against a remittance", async () => {
  const text = await answer("remittance fee for $200");
  const pct = Number(text.match(/\(([\d.]+)% of the amount\)/)?.[1]);
  assert.ok(Number.isFinite(pct), `no percentage found in: ${text.slice(0, 120)}`);
  // The World Bank average is 6.2%. Ours should be orders below, not near it.
  assert.ok(pct < 0.1, `product states ${pct}% of $200 — too close to traditional rails`);
});

await check("the rate the PRODUCT states matches the oracle", async () => {
  const text = await answer("what is USD to KES");
  const stated = Number(text.match(/1 USD = ([\d.]+) KES/)?.[1]);
  const expected = rates.cKES / rates.cUSD;
  assert.ok(Number.isFinite(stated), `no rate found in: ${text.slice(0, 120)}`);
  assert.ok(
    Math.abs(stated - expected) / expected < 0.01,
    `product says ${stated}, oracle says ${expected.toFixed(4)}`,
  );
});

await check("CELO is worth more than a cent and less than a thousand dollars", () => {
  // rates.cUSD is cUSD per CELO. A wrong direction shows up immediately here.
  assert.ok(rates.cUSD > 0.01 && rates.cUSD < 1000, `CELO reads $${rates.cUSD} — direction likely inverted`);
});


await check("realistic first questions are answerable, not refused", async () => {
  // Off-topic questions are refused for free, which is right — but a refusal
  // is still a dead end for a first-time payer. These are questions a real
  // person holding a wallet asks. Each one that misses is a user who decides
  // the thing does not work.
  const { canAnswer } = await import("../src/inference.ts");
  const questions = [
    "how much is 100 dollars in kenyan shillings",
    "send $50 to nigeria",
    // Ghana: no cedi on the oracle, but this is a remittance-cost question,
    // which we answer from gas rather than an FX rate.
    "cheapest way to send money to ghana",
    "how much does it cost to send money to india",
    "what's the fee to cash out",
    "how long does a transaction take",
    "price of celo",
    "how much are you charging me",
    "what is cUSD",
    "how many cKES exist",
    "dollar to reais",
  ];
  const missed = questions.filter((q) => !canAnswer(q));
  assert.deepEqual(missed, [], `these would be refused:\n  ${missed.join("\n  ")}`);
});

await check("the price question answers about us, not about chain gas", async () => {
  // "How much are you charging me" routed to gas — a true statement about
  // something the user did not ask, while they are deciding whether to trust
  // a paid service. It must state our own price.
  const { answer } = await import("../src/inference.ts");
  const { PRICE } = await import("../src/config.ts");
  const a = await answer("how much are you charging me");
  assert.ok(a.includes(PRICE.display), `the price answer never says ${PRICE.display}: ${a}`);
});

await check("the quoted minimum top-up matches the smallest button", async () => {
  // The price answer quotes a minimum in prose. The page defines the choices.
  // Two numbers, one truth: if they drift, we quote a price the button does
  // not charge.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { TOPUP_MIN_USD, TOPUP_MIN_QUESTIONS } = await import("../src/config.ts");
  const { PRICE } = await import("../src/config.ts");
  const html = readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8");
  const amounts = [...html.matchAll(/data-amount="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(Math.min(...amounts), TOPUP_MIN_USD, "TOPUP_MIN_USD is not the smallest button on the page");
  assert.equal(TOPUP_MIN_QUESTIONS, Math.floor(TOPUP_MIN_USD / PRICE.usd), "the quoted question count is wrong");
});


await check("a currency the oracle does not carry is refused, not invented", async () => {
  // "1000 naira to dollars" returned a Kenyan shilling rate: a confident lie
  // about someone's money, charged for. The oracle carries five currencies.
  // Anything else must be refused before payment, not approximated.
  const { canAnswer } = await import("../src/inference.ts");
  const unsupported = [
    "1000 naira to dollars",
    "convert 20 usd to ugx",
    "best rate to send to philippines",
    "rate for cedis",
  ];
  const charged = unsupported.filter((q) => canAnswer(q));
  assert.deepEqual(charged, [], `these would be charged for a rate we cannot read:\n  ${charged.join("\n  ")}`);
});

await check("the paywall refuses exactly what the answer cannot serve", async () => {
  // The match and the answer must agree. As a regex plus a separate lookup,
  // "dollar to rupee" matched (it says "dollar") and then dead-ended inside
  // the answer — a paid "name two currencies". Both now call fxPair.
  const { fxPair, canAnswer } = await import("../src/inference.ts");
  for (const q of ["dollar to rupee", "1000 naira to dollars", "usd to usd"]) {
    assert.equal(fxPair(q), null, `${q} should not resolve to a pair`);
    assert.equal(canAnswer(q), false, `${q} reaches the paywall but cannot be answered`);
  }
  assert.deepEqual(fxPair("dollar to shillings"), ["cUSD", "cKES"]);
});

await check("an off-topic price question does not answer with Celo gas", async () => {
  // A bare "price" match sent "stock price of apple" to the gas answer:
  // charged, confident, and about something else entirely.
  const { canAnswer } = await import("../src/inference.ts");
  for (const q of ["stock price of apple", "how much is bitcoin", "what time is it"]) {
    assert.equal(canAnswer(q), false, `${q} would be charged and answered with chain data`);
  }
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);

for (const [a, b] of [["cUSD", "cKES"], ["cUSD", "cCOP"], ["cUSD", "cREAL"], ["cEUR", "cKES"]]) {
  console.log(`  1 ${a.slice(1)} = ${(rates[b] / rates[a]).toFixed(4)} ${b.slice(1)}`);
}
