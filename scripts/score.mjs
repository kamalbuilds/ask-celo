#!/usr/bin/env node
/**
 * score.mjs — one number for the whole project.
 *
 *   npm run score            # print the score and what moves it next
 *   npm run score -- --json  # machine-readable, for the history log
 *
 * Runs both harnesses, weights them by what actually wins, and appends the
 * result to .score-history.jsonl so progress is comparable across runs.
 * The score only moves when something real changes on-chain or on a live URL.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

function run(script) {
  try {
    return execFileSync("node", [script], { encoding: "utf8", timeout: 120000 });
  } catch (e) {
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

const gates = run("scripts/gates.mjs");
const ready = run("scripts/readiness.mjs");

const gatesPassing = Number(gates.match(/(\d+)\/(\d+) gates passing/)?.[1] ?? 0);
const posDone = Number(ready.match(/\n\s+(\d+)\/5\n/)?.[1] ?? 0);
const fieldsDone = Number(ready.match(/(\d+)\/(\d+) required fields/)?.[1] ?? 0);
const fieldsTotal = Number(ready.match(/(\d+)\/(\d+) required fields/)?.[2] ?? 5);
const thirdParty = Number(
  ready.match(/(\d+) from (\d+) third-party payers/)?.[2] ?? 0,
);
const settlements = Number(ready.match(/(\d+) total, (\d+) from/)?.[1] ?? 0);

// Weights reflect what decides the outcome, not what is easy to finish.
// Third-party payers are capped in the score but uncapped in reality: they are
// the only metric that both wins Track 2 and survives the judges' sybil review.
const parts = [
  { name: "gates passing", value: gatesPassing, max: 5, weight: 30 },
  { name: "hackathon fields", value: fieldsDone, max: fieldsTotal, weight: 20 },
  { name: "proof-of-ship items", value: posDone, max: 5, weight: 10 },
  { name: "third-party payers", value: Math.min(thirdParty, 25), max: 25, weight: 40 },
];

const score = parts.reduce((s, p) => s + (p.value / p.max) * p.weight, 0);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ score, parts, settlements, thirdParty }));
} else {
  console.log(gates.trimEnd());
  console.log(ready.trimEnd());
  console.log("\n" + "=".repeat(52));
  for (const p of parts) {
    const pts = ((p.value / p.max) * p.weight).toFixed(1);
    console.log(`  ${p.name.padEnd(22)} ${String(p.value).padStart(3)}/${String(p.max).padEnd(3)}  ${pts.padStart(5)} / ${p.weight} pts`);
  }
  console.log(`  ${"SCORE".padEnd(22)} ${score.toFixed(1)} / 100`);

  // What single action moves the score most from here.
  const next = parts
    .map((p) => ({ ...p, headroom: (1 - p.value / p.max) * p.weight }))
    .sort((a, b) => b.headroom - a.headroom)[0];
  if (next.headroom > 0)
    console.log(`\n  biggest lever: ${next.name} (+${next.headroom.toFixed(1)} pts available)`);
}

const entry = { t: new Date().toISOString(), score: Number(score.toFixed(1)), gatesPassing, fieldsDone, posDone, thirdParty, settlements };
appendFileSync(".score-history.jsonl", JSON.stringify(entry) + "\n");

// Show the trend so a run can be compared against the last one.
if (!process.argv.includes("--json") && existsSync(".score-history.jsonl")) {
  const hist = readFileSync(".score-history.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  if (hist.length > 1) {
    const prev = hist[hist.length - 2];
    const delta = entry.score - prev.score;
    console.log(`  since last run: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} (${hist.length} runs)`);
  }
}
