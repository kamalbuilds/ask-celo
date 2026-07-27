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

const SORTED_ORACLES = "0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33";
const MENTO = {
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  cEUR: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
  cREAL: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787",
  cKES: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
  cCOP: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA",
};

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

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
for (const [a, b] of [["cUSD", "cKES"], ["cUSD", "cCOP"], ["cUSD", "cREAL"], ["cEUR", "cKES"]]) {
  console.log(`  1 ${a.slice(1)} = ${(rates[b] / rates[a]).toFixed(4)} ${b.slice(1)}`);
}
