#!/usr/bin/env node
/**
 * gates.mjs — the project's feedback loop.
 *
 * Five ordered gates. Each is a real check against a live system, prints PASS/FAIL,
 * and the script exits non-zero if any gate that should pass does not. Run it after
 * every change; the number of passing gates is the progress metric.
 *
 *   node scripts/gates.mjs            # run all gates
 *   node scripts/gates.mjs --only=1   # run one gate
 *
 * G1  facilitator reachable and advertises the exact scheme on our network
 * G2  seller returns 402 with a decodable payment-required header naming our payTo
 * G3  a session key signs EIP-3009, the facilitator settles, hash resolves on-chain
 * G4  attribution tag survives on-chain (verifyTx finds the assigned celo_ code)
 * G5  settlements counted, split by whether the payer is us or a third party
 */
import { createPublicClient, http } from "viem";
import { celo, celoSepolia } from "viem/chains";

// Ask the service being tested which network it is on, rather than assuming.
// Defaulting to testnet while production ran mainnet made G1 check the wrong
// facilitator and G2 "fail" by correctly reporting eip155:42220 — two red
// gates that were really one wrong assumption in the harness.
// Default to the deployed service, not localhost. Run bare from a clone this
// reported "fetch failed" for G2, which reads as a broken gate rather than
// "there is no server on port 3000 because you did not start one".
const { readFileSync: _readFileSync, existsSync: _existsSync } = await import("node:fs");
const _state = _existsSync(".submission.json")
  ? JSON.parse(_readFileSync(".submission.json", "utf8"))
  : {};
// `env()` not `??`: an exported-but-empty variable is neither null nor
// undefined, so `??` keeps the empty string and every downstream fetch fails
// with a bare "fetch failed". This bit twice, here and on SELLER_PAY_TO.
const env = (k) => (process.env[k] || undefined);
const SELLER_URL = env("SELLER_URL") ?? _state.liveUrl ?? "https://ask-celo.vercel.app";
const NETWORK = await fetch(`${SELLER_URL}/api/health`, { signal: AbortSignal.timeout(15_000) })
  .then((r) => r.json())
  .then((h) => (h.network === "mainnet" ? "mainnet" : "testnet"))
  .catch(() => (process.env.X402_NETWORK === "mainnet" ? "mainnet" : "testnet"));
// Imported, not restated. This file kept its own copy of the network table
// and spent a day checking testnet while production sold on mainnet.
const { NETWORKS } = await import("../src/config.ts");
const CFG = NETWORKS[NETWORK];

const SELLER = SELLER_URL;
// Same source as SELLER_URL: the deployed state file already knows the payTo,
// so a bare run reports real settlement counts instead of "not set".
// .submission.json is gitignored, so a clone has neither. The live service
// publishes its own payTo on /api/health, which makes a bare run meaningful
// for someone who has never seen this repo before.
const PAY_TO =
  env("SELLER_PAY_TO") ??
  _state.payTo ??
  (await fetch(`${SELLER_URL}/api/health`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.json())
    .then((h) => h.payTo)
    .catch(() => undefined));
const TAG = env("ATTRIBUTION_TAG") ?? _state.attributionTag;

let pass = 0;
let ran = 0;
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

async function gate(n, name, fn) {
  if (only && only !== String(n)) return;
  ran++;
  process.stdout.write(`G${n} ${name} ... `);
  try {
    const detail = await fn();
    pass++;
    console.log(`PASS${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    console.log(`FAIL — ${e.message}`);
  }
}

// G1 — is the facilitator alive and does it support our (scheme, network) pair?
await gate(1, `facilitator supports exact on ${CFG.caip}`, async () => {
  const res = await fetch(`${CFG.facilitator}/supported`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct} (SPA false-green?)`);
  const body = await res.json();
  const kinds = body.kinds ?? [];
  const hit = kinds.find((k) => k.scheme === "exact" && k.network === CFG.caip);
  if (!hit) throw new Error(`no exact/${CFG.caip} in ${JSON.stringify(kinds).slice(0, 200)}`);
  return `x402Version ${hit.x402Version}`;
});

// G2 — unpaid request must be exactly 402, and the challenge must name our payTo.
await gate(2, "seller returns a well-formed 402 challenge", async () => {
  const res = await fetch(`${SELLER}/api/ask`, { method: "POST", body: "{}" }).catch((e) => {
    throw new Error(
      `${SELLER} is not reachable (${e.message}). Set SELLER_URL, or run \`npm run seller\` first.`,
    );
  });
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`);
  const header = res.headers.get("payment-required");
  if (!header) throw new Error("no payment-required header");
  const challenge = JSON.parse(Buffer.from(header, "base64").toString());
  const accepts = challenge.accepts?.[0];
  if (!accepts) throw new Error("challenge has no accepts[]");
  if (accepts.network !== CFG.caip) throw new Error(`challenge network ${accepts.network}`);
  if (PAY_TO && accepts.payTo?.toLowerCase() !== PAY_TO.toLowerCase())
    throw new Error(`payTo ${accepts.payTo} != ${PAY_TO}`);
  const amount = accepts.amount ?? accepts.price?.amount ?? accepts.maxAmountRequired;
  if (!amount) throw new Error("challenge names no amount");
  return `${amount} base units to ${accepts.payTo?.slice(0, 10)}…`;
});

// G3 — THE KILL TEST. A session key (not a browser wallet) must be able to pay.
// If a session-key signature cannot settle, the entire product thesis is dead.
await gate(3, "session key signs EIP-3009 and the facilitator settles", async () => {
  if (!env("SESSION_TEST_KEY"))
    throw new Error("set SESSION_TEST_KEY to a funded throwaway key to run the kill test");
  const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const { privateKeyToAccount } = await import("viem/accounts");

  const account = privateKeyToAccount(env("SESSION_TEST_KEY"));
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
  const payFetch = wrapFetchWithPayment(fetch, client);

  const res = await payFetch(`${SELLER}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Must be answerable: unanswerable questions are refused for free before
    // the paywall, so anything else never reaches settlement and the kill test
    // silently stops testing anything.
    body: JSON.stringify({ q: "dollar to shillings" }),
  });
  if (res.status !== 200) {
    // "returned 402" hides the only thing worth knowing: whether the thesis
    // broke or the wallet is simply empty. Read the balance and say which.
    if (res.status === 402) {
      const { createPublicClient, http, erc20Abi } = await import("viem");
      const pub = createPublicClient({
        chain: CFG.chain,
        transport: http(CFG.rpc, { retryCount: 3, retryDelay: 300 }),
      });
      const balance = await pub
        .readContract({
          address: CFG.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        })
        .catch(() => null);
      if (balance === 0n)
        throw new Error(
          `test key ${account.address} holds 0 USDC on ${NETWORK}: fund it to run the kill test`,
        );
      throw new Error(
        `402 with a balance of ${balance === null ? "unknown" : Number(balance) / 1e6} USDC: the signature was rejected`,
      );
    }
    throw new Error(`paid request returned ${res.status}`);
  }
  const receipt = res.headers.get("payment-response");
  if (!receipt) throw new Error("200 but no payment-response header — nothing settled");
  const decoded = JSON.parse(Buffer.from(receipt, "base64").toString());
  const hash = decoded.transaction ?? decoded.txHash;
  if (!hash) throw new Error(`receipt has no tx hash: ${JSON.stringify(decoded).slice(0, 200)}`);

  // The receipt is the seller's claim. Confirm it against the chain.
  const pub = createPublicClient({ chain: CFG.chain, transport: http(CFG.rpc) });
  const rcpt = await pub.getTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`settlement tx reverted: ${hash}`);
  return `settled ${hash}`;
});

// G4 — the tag is worthless if it does not survive on-chain. Assert, never assume:
// the docs warn that some smart-account and relayer paths strip trailing calldata.
await gate(4, "attribution tag survives on-chain", async () => {
  const hash = env("TAGGED_TX_HASH");
  if (!hash) throw new Error("set TAGGED_TX_HASH to a real top-up tx to check the tag");
  if (!TAG) throw new Error("ATTRIBUTION_TAG not set — register on celobuilders first");
  const { verifyTx } = await import("@celo/attribution-tags");
  const pub = createPublicClient({ chain: CFG.chain, transport: http(CFG.rpc) });
  const result = await verifyTx({ client: pub, hash });
  if (!result) throw new Error(`no ERC-8021 suffix found on ${hash}`);
  if (!result.codes.includes(TAG))
    throw new Error(`tag missing: found ${JSON.stringify(result.codes)}, want ${TAG}`);
  return `codes ${JSON.stringify(result.codes)}`;
});

// G5 — the number that actually wins the track, and the one that survives sybil review:
// settlements whose payer is somebody other than us.
await gate(5, "settlements counted, third-party payers separated", async () => {
  if (!PAY_TO)
    throw new Error(
      "no payTo to count against. Set SELLER_PAY_TO, or ask the live service: " +
        `curl -s ${SELLER}/api/health | grep payTo`,
    );
  const url = `${CFG.explorer}/api/v2/addresses/${PAY_TO}/token-transfers?type=ERC-20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`explorer returned ${res.status}`);
  const items = (await res.json()).items ?? [];
  const incoming = items.filter((t) => t.to?.hash?.toLowerCase() === PAY_TO.toLowerCase());
  const mine = new Set(
    (process.env.OUR_WALLETS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  const external = incoming.filter((t) => !mine.has(t.from?.hash?.toLowerCase()));
  const payers = new Set(external.map((t) => t.from?.hash?.toLowerCase()));
  // Name the network. This read testnet while production sold on mainnet and
  // reported 9 settlements — a flattering number for a chain nobody was
  // paying on. A count without its network is not evidence.
  return `${incoming.length} settlements on ${NETWORK}, ${external.length} from ${payers.size} third-party payers`;
});

console.log(`\n${pass}/${ran} gates passing`);
process.exit(pass === ran ? 0 : 1);
