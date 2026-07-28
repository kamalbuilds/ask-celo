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


await check("a tag set in the environment reaches the browser bundle", async () => {
  // The tag is the one thing that cannot be backfilled: it has to be in the
  // top-up calldata at send time. Every part of that path is testable now
  // except the value itself, so rehearse it — build with a tag set and prove
  // it survives into the shipped bundle.
  //
  // This has failed before in exactly one way: setting ATTRIBUTION_TAG without
  // VITE_ATTRIBUTION_TAG, because vite only exposes VITE_-prefixed variables.
  // The server was configured and every top-up shipped untagged.
  const { execFileSync } = await import("node:child_process");
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));

  const probe = "celo_testtag0001";
  execFileSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "ignore",
    timeout: 120_000,
    env: { ...process.env, ATTRIBUTION_TAG: probe, VITE_ATTRIBUTION_TAG: probe },
  });

  const assets = `${root}/dist/assets`;
  assert.ok(existsSync(assets), "no build output");
  // Count occurrences, not presence. Vite inlines import.meta.env wholesale,
  // so the tag appears once inside that object even when the code that should
  // read it does not — a mutation breaking the real reader still left the
  // bundle "containing" the tag. Two is the honest signal: the env object AND
  // the constant the page actually uses.
  const bundleText = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(`${assets}/${f}`, "utf8"))
    .join("");
  const occurrences = bundleText.split(probe).length - 1;

  // Rebuild clean before asserting, so a failure does not leave a test tag in
  // the tree for a later deploy to pick up.
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore", timeout: 120_000 });

  assert.ok(
    occurrences >= 2,
    `the tag appears ${occurrences}x in the bundle: it is in the env object but nothing reads it, ` +
      "so every top-up would ship untagged",
  );
});

console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
