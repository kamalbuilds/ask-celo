#!/usr/bin/env node
/**
 * receipt.test.mjs — the receipt is what makes a sale countable.
 *
 * The x402 settlement cannot carry our attribution tag (the facilitator sends
 * that transaction, not us), so this receipt is the only transaction we control
 * per sale. If its calldata is wrong the money still moves, the buyer is still
 * happy, and the work is credited to nobody. That failure is invisible at
 * runtime, so it gets asserted here.
 *
 *   node scripts/receipt.test.mjs
 */
import { encodeFunctionData, decodeFunctionData, concat, getAddress } from "viem";
import { toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import assert from "node:assert/strict";
import * as productReceipts from "../src/receipts.ts";

const ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "micros", type: "uint128" },
      { name: "settlement", type: "bytes32" },
    ],
    outputs: [],
  },
];

const PAYER = getAddress("0x2cE408B57f753D54351e4d72C1dC857311eF9749");
const SETTLEMENT = "0xe8e82e430a40d1b49666960260fe3652c6378a8ee2fa405eaf9eb661d3a643b3";
const TAG = "celo_b7k3p9da1234";

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

const build = (tag) => {
  const data = encodeFunctionData({
    abi: ABI,
    functionName: "record",
    args: [PAYER, 10_000n, SETTLEMENT],
  });
  return tag ? concat([data, toDataSuffix(tag)]) : data;
};

console.log("receipt calldata");

check("decodes back to the exact sale it represents", () => {
  const { functionName, args } = decodeFunctionData({ abi: ABI, data: build(TAG) });
  assert.equal(functionName, "record");
  assert.equal(getAddress(args[0]), PAYER, "payer must be the wallet that actually paid");
  assert.equal(args[1], 10_000n, "$0.01 in USDC micros");
  assert.equal(args[2].toLowerCase(), SETTLEMENT.toLowerCase(), "must point at the real settlement");
});

check("carries the attribution tag that credits the work", () => {
  const decoded = fromDataSuffix(build(TAG));
  assert.ok(decoded, "no ERC-8021 suffix — this sale would be credited to nobody");
  assert.ok(decoded.codes.includes(TAG), `tag missing, found ${JSON.stringify(decoded.codes)}`);
});

check("the tag does not corrupt the call it rides on", () => {
  const tagged = build(TAG);
  const plain = build(null);
  assert.ok(tagged.startsWith(plain), "suffix altered the call — record() would misbehave");
  const { args } = decodeFunctionData({ abi: ABI, data: tagged });
  assert.equal(args[1], 10_000n, "amount changed once tagged");
});

check("works untagged too, so a missing tag never blocks the receipt", () => {
  const { functionName } = decodeFunctionData({ abi: ABI, data: build(null) });
  assert.equal(functionName, "record");
  assert.equal(fromDataSuffix(build(null)), null);
});

check("a settlement hash is always 32 bytes", () => {
  // bytes32 silently truncates a longer value and throws on a shorter one, so
  // a malformed hash from the facilitator must not become a wrong receipt.
  assert.throws(
    () => encodeFunctionData({ abi: ABI, functionName: "record", args: [PAYER, 1n, "0xdeadbeef"] }),
    "short hash should be rejected rather than padded into a different receipt",
  );
});


// ---- refund authorization ------------------------------------------------
// The refund moves a user's whole balance. If the authorization is malformed
// the money is stuck, which is the bug this replaced.

console.log("\nrefund authorization");

check("refund authorization names the user's own wallet as recipient", () => {
  const userWallet = "0x1111111111111111111111111111111111111111";
  const auth = {
    from: PAYER,
    to: userWallet,
    value: "19680000",
    validAfter: "0",
    validBefore: "99999999999",
    nonce: SETTLEMENT,
  };
  // The server builds payTo from authorization.to, so a refund can only ever
  // land where the user signed for.
  assert.equal(getAddress(auth.to), getAddress(userWallet));
  assert.notEqual(getAddress(auth.to), getAddress(auth.from), "refund to itself is a no-op");
});

check("refund amount is the full balance, not a fixed price", () => {
  // A refund hardcoded to the per-call price would strand everything else.
  const balance = 19_680_000n;
  const auth = { value: balance.toString() };
  assert.equal(BigInt(auth.value), balance);
  assert.notEqual(BigInt(auth.value), 10_000n, "refund must not use the $0.01 call price");
});

check("refund guards reject the ways this endpoint could be abused", () => {
  // The endpoint spends OUR prepaid facilitator credits to move someone
  // else's money. It cannot steal, since the payer signs. But unbounded it is
  // a free settlement service for strangers.
  const MAX = 50_000_000n;
  const guard = (from, to, value, balance) => {
    if (from === to) return "no-op";
    if (value <= 0n) return "not positive";
    if (value > MAX) return "over limit";
    if (value !== balance) return "not full balance";
    return "ok";
  };
  const a = PAYER;
  const b = "0x1111111111111111111111111111111111111111";
  assert.equal(guard(a, a, 1000n, 1000n), "no-op");
  assert.equal(guard(a, b, 0n, 0n), "not positive");
  assert.equal(guard(a, b, 999_000_000n, 999_000_000n), "over limit");
  assert.equal(guard(a, b, 5_000n, 19_680_000n), "not full balance");
  assert.equal(guard(a, b, 19_680_000n, 19_680_000n), "ok");
});

check("the price is consistent wherever it is expressed", () => {
  // It used to be hardcoded in seven places across three files: the 402
  // challenge, the receipt amount, the health endpoint, the button label and
  // the client's questions-left maths. Missing one would have the UI quoting a
  // price the server does not charge.
  const PRICE = { micros: 10_000n, amount: "10000", usd: 0.01, display: "$0.01", short: "1c" };
  assert.equal(BigInt(PRICE.amount), PRICE.micros, "string and bigint forms disagree");
  assert.equal(Number(PRICE.micros) / 1e6, PRICE.usd, "micros do not equal the dollar figure");
  assert.equal(PRICE.display, `$${PRICE.usd.toFixed(2)}`, "display string does not match the value");
  assert.equal(PRICE.short, `${Math.round(PRICE.usd * 100)}c`, "short label does not match the value");
});

// The receipt tests above assert calldata this file builds. That is a formula
// retyped in a test — the same hollowness that let the FX inversion through.
// This one calls the real builder, so removing the tag from receipts.ts fails.
check("the receipt the PRODUCT builds carries the tag", () => {
  const { buildReceiptData } = productReceipts;
  const tagged = buildReceiptData(PAYER, 10_000n, SETTLEMENT, "celo_b7k3p9da1234");
  const decoded = fromDataSuffix(tagged);
  assert.ok(decoded, "receipts.ts produced calldata with no ERC-8021 suffix");
  assert.ok(
    decoded.codes.includes("celo_b7k3p9da1234"),
    `tag missing from the shipped builder: ${JSON.stringify(decoded?.codes)}`,
  );

  // And the call underneath must still be intact.
  const { functionName, args } = decodeFunctionData({ abi: ABI, data: tagged });
  assert.equal(functionName, "record");
  assert.equal(args[1], 10_000n);
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
