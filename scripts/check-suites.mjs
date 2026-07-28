#!/usr/bin/env node
/**
 * check-suites.mjs — did every suite actually run?
 *
 * The receipt suite crashed on an unresolvable import, ran none of its checks,
 * and npm test still exited 0. Reading "all passing" from the suites that did
 * run gave no hint that a whole file had vanished from the count.
 *
 * A test harness that cannot tell "passed" from "never ran" is the same class
 * of failure as the rest of today's bugs: it works, and it is wrong.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const suites = readdirSync(new URL(".", import.meta.url))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (suites.length === 0) {
  console.error("no test suites found — did they move?");
  process.exit(1);
}

let total = 0;
let failed = false;

for (const suite of suites) {
  let out = "";
  let crashed = false;
  try {
    out = execFileSync("npx", ["tsx", `scripts/${suite}`], { encoding: "utf8", timeout: 120000 });
  } catch (e) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    crashed = true;
  }

  // "N checks" is printed only after the checks have run. Its absence means the
  // file died before reaching the end, which is exactly what hid for hours.
  const count = Number(out.match(/(\d+) checks/)?.[1] ?? 0);
  const ok = !crashed && count > 0 && !/FAILED|FAIL /.test(out);

  console.log(`  ${ok ? "ok  " : "FAIL"} ${suite.padEnd(22)} ${count} checks`);
  if (!ok) {
    failed = true;
    const why = crashed ? out.match(/Error[^\n]*/)?.[0] : "a check failed";
    if (why) console.log(`       ${why.slice(0, 100)}`);
  }
  total += count;
}

console.log(`\n${suites.length} suites, ${total} checks`);
process.exit(failed ? 1 : 0);
