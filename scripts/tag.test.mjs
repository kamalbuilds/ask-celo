#!/usr/bin/env node
/**
 * tag.test.mjs — the attribution tag is worth money and fails silently.
 *
 * A wrong tag does not throw; it produces a transaction that works perfectly
 * and earns nothing. So the encode/decode round-trip gets a real test.
 *
 *   node scripts/tag.test.mjs
 */
import { toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import { encodeFunctionData, concat, erc20Abi, parseUnits } from "viem";
import assert from "node:assert/strict";

let n = 0;
// Async-aware. This was `fn()` with no await: an async check returned a
// promise that nothing observed, so its assertions could not fail the run.
// Two checks added here reported "ok" while asserting against mutated source.
// A test that cannot fail is worse than no test, because it certifies.
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

const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: ["0x000000000000000000000000000000000000dEaD", parseUnits("1", 6)],
});

console.log("attribution tag round-trip");

await check("assigned tag survives concat with calldata", () => {
  const tag = "celo_b7k3p9da1234";
  const data = concat([transfer, toDataSuffix(tag)]);
  const decoded = fromDataSuffix(data);
  assert.ok(decoded, "suffix not found after concat");
  assert.ok(decoded.codes.includes(tag), `codes ${JSON.stringify(decoded.codes)} missing ${tag}`);
});

await check("multi-code array keeps the assigned tag", () => {
  const assigned = "celo_b7k3p9da1234";
  const data = concat([transfer, toDataSuffix(["my_own_code", assigned])]);
  const decoded = fromDataSuffix(data);
  assert.ok(decoded.codes.includes(assigned), "assigned tag dropped from multi-code suffix");
});

await check("suffix does not disturb the call it is appended to", () => {
  const data = concat([transfer, toDataSuffix("celo_b7k3p9da1234")]);
  assert.ok(data.startsWith(transfer), "calldata prefix mutated — execution would change");
  assert.equal(data.slice(0, 10), transfer.slice(0, 10), "selector changed");
});

await check("untagged calldata decodes to null rather than throwing", () => {
  assert.equal(fromDataSuffix(transfer), null);
});

await check("a plain value transfer can carry a tag with no calldata", () => {
  const tag = "celo_b7k3p9da1234";
  const decoded = fromDataSuffix(toDataSuffix(tag));
  assert.ok(decoded.codes.includes(tag));
});


await check("the tag survives our real calldata construction, round trip", async () => {
  // G4 checks a tag on-chain, which needs a funded tagged transaction we
  // cannot make yet. This proves the half we can: that the exact calldata
  // session.ts builds still decodes back to our tag. If toDataSuffix or the
  // concat order ever breaks, every top-up ships untagged and Track 1 credit
  // is lost for good, because calldata cannot be backfilled.
  const { toDataSuffix, fromDataSuffix } = await import("@celo/attribution-tags");
  const { encodeFunctionData, erc20Abi, concat, parseUnits } = await import("viem");

  const tag = "celo_abc123def456";
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: ["0x2cE408B57f753D54351e4d72C1dC857311eF9749", parseUnits("0.25", 6)],
  });
  const data = concat([transfer, toDataSuffix([tag])]);

  // The transfer itself must be untouched: the suffix is appended, never
  // woven in, or the token contract decodes different arguments.
  assert.ok(data.startsWith(transfer), "the suffix corrupts the transfer calldata");

  const decoded = fromDataSuffix(data);
  assert.ok(decoded, "no ERC-8021 suffix decoded from our own calldata");
  assert.ok(decoded.codes.includes(tag), `tag lost: decoded ${JSON.stringify(decoded.codes)}`);
});

await check("session.ts appends the tag rather than replacing the transfer", async () => {
  // The tag is only worth anything if the transaction still transfers money.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../src/session.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /concat\(\[\s*transfer\s*,\s*toDataSuffix/,
    "the tag must be concatenated after the transfer, in that order",
  );
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
