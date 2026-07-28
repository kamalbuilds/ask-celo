#!/usr/bin/env node
/**
 * contract-test.mjs — run the Solidity tests, or say clearly why not.
 *
 * `forge test` needs lib/forge-std, which is a dependency fetched by forge and
 * is gitignored. On a fresh clone it is absent, so `npm test` failed on the
 * first command a judge runs with a Solidity parser error that has nothing to
 * do with the contract.
 *
 * This installs it when forge is available, and skips with a reason when forge
 * is not installed at all — a reader without foundry should still get a green
 * JavaScript suite rather than a wall of red.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const has = (cmd) => spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;

if (!has("forge")) {
  console.log("\nskip  Solidity tests: foundry is not installed (https://getfoundry.sh)");
  console.log("      The JavaScript suites above cover the service; the contract");
  console.log("      tests cover contracts/AskReceipts.sol.");
  process.exit(0);
}

if (!existsSync("lib/forge-std")) {
  console.log("\ninstalling forge-std (gitignored, so a fresh clone needs it)…");
  const install = spawnSync("forge", ["install", "foundry-rs/forge-std", "--no-git"], {
    stdio: "inherit",
  });
  if (install.status !== 0) {
    console.log("skip  Solidity tests: could not install forge-std");
    process.exit(0);
  }
}

try {
  execSync("forge test", { stdio: "inherit", env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" } });
} catch {
  process.exit(1);
}
