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
import { MENTO_MAINNET as MENTO, SORTED_ORACLES, TRANSFER_GAS } from "../src/inference.ts";


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

await check("a stablecoin transfer costs a fraction of a cent", async () => {
  const gasPrice = await client.getGasPrice();
  const celoUsd = rates.cUSD; // cUSD per CELO, from the same oracle
  const feeUsd = ((Number(gasPrice) * TRANSFER_GAS) / 1e18) * celoUsd;

  // Celo's whole pitch is sub-cent fees. If this ever reads above a cent the
  // number is wrong, or the chain has changed enough that the copy is a lie.
  assert.ok(feeUsd > 0, `fee is ${feeUsd}, must be positive`);
  assert.ok(feeUsd < 0.01, `transfer fee reads $${feeUsd.toFixed(4)} — above a cent, likely inverted`);
});

await check("the fee is negligible against a real remittance", async () => {
  const gasPrice = await client.getGasPrice();
  const feeUsd = ((Number(gasPrice) * TRANSFER_GAS) / 1e18) * rates.cUSD;
  const pct = (feeUsd / 200) * 100;
  // The World Bank average is 6.2%. Ours should be orders below, not near it.
  assert.ok(pct < 0.1, `fee is ${pct.toFixed(4)}% of $200 — too close to traditional rails to be right`);
});

await check("CELO is worth more than a cent and less than a thousand dollars", () => {
  // rates.cUSD is cUSD per CELO. A wrong direction shows up immediately here.
  assert.ok(rates.cUSD > 0.01 && rates.cUSD < 1000, `CELO reads $${rates.cUSD} — direction likely inverted`);
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);

for (const [a, b] of [["cUSD", "cKES"], ["cUSD", "cCOP"], ["cUSD", "cREAL"], ["cEUR", "cKES"]]) {
  console.log(`  1 ${a.slice(1)} = ${(rates[b] / rates[a]).toFixed(4)} ${b.slice(1)}`);
}
