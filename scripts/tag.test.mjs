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
const check = (name, fn) => {
  n++;
  try {
    fn();
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

check("assigned tag survives concat with calldata", () => {
  const tag = "celo_b7k3p9da1234";
  const data = concat([transfer, toDataSuffix(tag)]);
  const decoded = fromDataSuffix(data);
  assert.ok(decoded, "suffix not found after concat");
  assert.ok(decoded.codes.includes(tag), `codes ${JSON.stringify(decoded.codes)} missing ${tag}`);
});

check("multi-code array keeps the assigned tag", () => {
  const assigned = "celo_b7k3p9da1234";
  const data = concat([transfer, toDataSuffix(["my_own_code", assigned])]);
  const decoded = fromDataSuffix(data);
  assert.ok(decoded.codes.includes(assigned), "assigned tag dropped from multi-code suffix");
});

check("suffix does not disturb the call it is appended to", () => {
  const data = concat([transfer, toDataSuffix("celo_b7k3p9da1234")]);
  assert.ok(data.startsWith(transfer), "calldata prefix mutated — execution would change");
  assert.equal(data.slice(0, 10), transfer.slice(0, 10), "selector changed");
});

check("untagged calldata decodes to null rather than throwing", () => {
  assert.equal(fromDataSuffix(transfer), null);
});

check("a plain value transfer can carry a tag with no calldata", () => {
  const tag = "celo_b7k3p9da1234";
  const decoded = fromDataSuffix(toDataSuffix(tag));
  assert.ok(decoded.codes.includes(tag));
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
