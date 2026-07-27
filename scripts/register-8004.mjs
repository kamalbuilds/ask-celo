#!/usr/bin/env node
/**
 * register-8004.mjs — mint the agent's ERC-8004 identity on Celo.
 *
 * The hackathon requires an 8004 Agent ID URL, and 8004scan warns on metadata
 * that follows the older shape, so this builds the current spec shape and
 * pins it to IPFS (the CID is the integrity check; an https URI can be
 * swapped after registration and nobody can prove it changed).
 *
 *   AGENT_PRIVATE_KEY=0x... AGENT_DOMAIN=https://… node scripts/register-8004.mjs --dry-run
 *   AGENT_PRIVATE_KEY=0x... AGENT_DOMAIN=https://… node scripts/register-8004.mjs
 *
 * --dry-run prints the metadata and validates it without spending anything.
 */
import { createWalletClient, createPublicClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

const MAINNET = process.env.X402_NETWORK === "mainnet";
const CHAIN = MAINNET ? celo : celoSepolia;
const RPC = MAINNET ? "https://forno.celo.org" : "https://forno.celo-sepolia.celo-testnet.org";
const REGISTRY = getAddress(
  MAINNET
    ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    : "0x8004A818BFB912233c491871b3d84c89A494BD9e",
);
const USDC_ADAPTER = MAINNET
  ? "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B"
  : "0x4822e58de6f5e485eF90df51C41CE01721331dC0";

const dryRun = process.argv.includes("--dry-run");
const domain = process.env.AGENT_DOMAIN;
if (!domain) throw new Error("AGENT_DOMAIN not set (e.g. https://ask.example.com)");

// Current EIP-8004 registration shape. The three things 8004scan flags are
// `type: "Agent"`, an `endpoints` array, and `url` per entry — all fixed here.
const metadata = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: process.env.AGENT_NAME ?? "Ask",
  description:
    "Answers questions for a cent each, paid over x402 on Celo. Brings MiniPay " +
    "wallets onto x402 with a device-local session key, since MiniPay implements " +
    "neither personal_sign nor eth_signTypedData and cannot sign EIP-3009 directly.",
  services: [
    { name: "web", endpoint: domain },
    { name: "x402", endpoint: `${domain}/api/ask`, version: "2" },
  ],
  supportedTrust: ["reputation"],
};

function validate(m) {
  const problems = [];
  if (m.type !== "https://eips.ethereum.org/EIPS/eip-8004#registration-v1")
    problems.push("type must be the #registration-v1 spec URI");
  if (m.endpoints) problems.push("`endpoints` is deprecated — use `services`");
  if (!Array.isArray(m.services) || m.services.length === 0)
    problems.push("services[] is required");
  for (const s of m.services ?? []) {
    if (!s.name) problems.push("every service needs a name");
    if (!s.endpoint) problems.push(`service ${s.name} needs \`endpoint\` (not \`url\`)`);
  }
  return problems;
}

const problems = validate(metadata);
if (problems.length) {
  console.error("metadata would trigger validator warnings:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(JSON.stringify(metadata, null, 2));
console.log(`\nnetwork:  ${MAINNET ? "celo mainnet" : "celo sepolia"}`);
console.log(`registry: ${REGISTRY}`);

/** Pin to IPFS so the CID is the integrity check. */
async function pin(json) {
  const token = process.env.PINATA_JWT;
  if (!token)
    throw new Error(
      "PINATA_JWT not set. The agentURI must be content-addressed (ipfs://): an " +
        "https URI can be mutated after registration, which the validator flags.",
    );
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ pinataContent: json }),
  });
  if (!res.ok) throw new Error(`pinata ${res.status}: ${await res.text()}`);
  return `ipfs://${(await res.json()).IpfsHash}`;
}

if (dryRun) {
  console.log("\ndry run — metadata valid, nothing pinned or sent.");
  process.exit(0);
}

if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY not set");

const agentURI = await pin(metadata);
console.log(`agentURI: ${agentURI}`);

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });

const abi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
];

const hash = await wallet.writeContract({
  address: REGISTRY,
  abi,
  functionName: "register",
  args: [agentURI],
  feeCurrency: USDC_ADAPTER, // gas in USDC, no CELO balance needed
});

console.log(`tx: ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("registration reverted");

// agentId is the ERC-721 token id, carried in the Transfer topic.
const transfer = receipt.logs.find(
  (l) => l.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
);
const agentId = transfer?.topics[3] ? BigInt(transfer.topics[3]).toString() : "?";

console.log(`\nagentId: ${agentId}`);
console.log(`8004scan: https://8004scan.io/agents/celo/${agentId}`);
console.log(`celoscan: https://celoscan.io/nft/${REGISTRY}/${agentId}`);
