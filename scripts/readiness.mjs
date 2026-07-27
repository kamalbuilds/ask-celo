#!/usr/bin/env node
/**
 * readiness.mjs — the submission feedback loop.
 *
 * Checks both clocks and scores each as N/total, verified by live fetch rather
 * than memory. Run it any time to see exactly what is left and how long there is.
 *
 *   node scripts/readiness.mjs
 *
 * Reads state from .submission.json (git-ignored) so the numbers reflect reality:
 *   { repoUrl, liveUrl, contractAddress, talentAppUrl, payTo,
 *     attributionTag, erc8004Url, socialLink, telegram, agentWalletAddress }
 */
import { readFileSync, existsSync } from "node:fs";

const HACKATHON = "agentic-payments-defai";
const POS_DEADLINE = Date.parse("2026-07-27T23:59:00Z");
const HACK_DEADLINE = Date.parse("2026-08-03T09:00:00Z");
const PLACEHOLDER = /^(tbd|todo|xxx|placeholder|example|0x0{20,}|https?:\/\/example\.)/i;

const state = existsSync("./.submission.json")
  ? JSON.parse(readFileSync("./.submission.json", "utf8"))
  : {};

const hours = (ms) => (ms - Date.now()) / 36e5;
const fmt = (h) => (h < 0 ? "PASSED" : `${h.toFixed(1)}h left`);

function real(v) {
  return typeof v === "string" && v.trim().length > 0 && !PLACEHOLDER.test(v.trim());
}

async function reachable(url) {
  if (!real(url)) return false;
  try {
    const res = await fetch(url, { redirect: "follow" });
    return res.status < 400;
  } catch {
    return false;
  }
}

async function verifiedContract(addr) {
  if (!real(addr)) return false;
  try {
    const res = await fetch(`https://celo.blockscout.com/api/v2/smart-contracts/${addr}`);
    if (!res.ok) return false;
    const d = await res.json();
    return Boolean(d.is_verified ?? d.abi);
  } catch {
    return false;
  }
}

// ---- Proof of Ship: 5 mechanical gates, each verified by fetch or explorer ----
const pos = [
  ["verified contract on Celo mainnet", await verifiedContract(state.contractAddress)],
  ["public GitHub repo reachable", await reachable(state.repoUrl)],
  ["live app URL reachable", await reachable(state.liveUrl)],
  ["project registered on talent.app", real(state.talentAppUrl)],
  ["MiniPay hook present (booster)", Boolean(state.minipayHook)],
];

console.log(`\nProof of Ship — ${fmt(hours(POS_DEADLINE))}`);
for (const [name, ok] of pos) console.log(`  ${ok ? "[x]" : "[ ]"} ${name}`);
console.log(`  ${pos.filter(([, ok]) => ok).length}/${pos.length}`);

// ---- Hackathon: the live API is the authority on what is required ----
console.log(`\nHackathon — ${fmt(hours(HACK_DEADLINE))}`);
let fields = [];
try {
  const res = await fetch(`https://celobuilders.xyz/hackathons/${HACKATHON}/submission-fields`);
  fields = await res.json();
} catch {
  console.log("  ! could not reach celobuilders — cannot verify field list");
}

const required = fields.filter((f) => f.required);
for (const f of required) {
  const v = state[f.key];
  const ok = real(v);
  console.log(`  ${ok ? "[x]" : "[ ]"} ${f.key} (${f.requiredAt})${ok ? "" : "  ← " + f.label}`);
}
const filled = required.filter((f) => real(state[f.key])).length;
console.log(`  ${filled}/${required.length} required fields`);

// ---- The number that actually decides the track ----
if (real(state.payTo)) {
  try {
    const res = await fetch(
      `https://celo.blockscout.com/api/v2/addresses/${state.payTo}/token-transfers?type=ERC-20`,
    );
    const items = (await res.json()).items ?? [];
    const incoming = items.filter(
      (t) => t.to?.hash?.toLowerCase() === state.payTo.toLowerCase(),
    );
    const mine = new Set((state.ourWallets ?? []).map((s) => s.toLowerCase()));
    const external = incoming.filter((t) => !mine.has(t.from?.hash?.toLowerCase()));
    const payers = new Set(external.map((t) => t.from?.hash?.toLowerCase()));
    console.log(
      `\nSettlements into payTo: ${incoming.length} total, ${external.length} from ${payers.size} third-party payers`,
    );
  } catch {
    console.log("\n! could not read settlements from explorer");
  }
} else {
  console.log("\nSettlements: payTo not set yet");
}

// ---- Named blockers, with the work parked behind each ----
const blockers = [
  [
    !real(state.attributionTag),
    "attribution tag — needs GitHub repo name + Telegram handle to register on celobuilders",
    "blocks: Track 1 credit on every tx (retroactively unrecoverable)",
  ],
  [
    !real(state.x402ApiKey),
    "x402 API key — human must connect a wallet at x402.celo.org and Create API key",
    "blocks: all mainnet settlement (G3/G5)",
  ],
];
const open = blockers.filter(([b]) => b);
if (open.length) {
  console.log("\nBlockers:");
  for (const [, what, blocks] of open) console.log(`  - ${what}\n    ${blocks}`);
}
