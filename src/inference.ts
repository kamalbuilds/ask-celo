/**
 * What the paid endpoint actually sells.
 *
 * Deliberately not an LLM wrapper. A cent-per-call LLM proxy is worth less than
 * the LLM's own free tier, and it fails whenever the upstream key runs dry —
 * which is a bad property for something people have already paid for.
 *
 * Instead this answers questions about Celo from live on-chain and ecosystem
 * data that is genuinely awkward to get: current gas, real stablecoin supply,
 * live protocol TVL. Deterministic, cheap to serve, and correct at the moment
 * it is asked.
 */
import { createPublicClient, http, erc20Abi, formatUnits, getAddress } from "viem";
import { celo } from "viem/chains";
import { CFG } from "./config.js";

const client = createPublicClient({ chain: CFG.chain, transport: http(CFG.rpc) });

/**
 * Mento local-currency stablecoins, the thing Celo has that other chains do not.
 * Mainnet only: these are not deployed on Sepolia, and reading them there throws
 * a confusing "function does not exist" rather than returning nothing.
 */
const MENTO_MAINNET = {
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  cEUR: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
  cREAL: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787",
  cKES: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
  cCOP: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA",
} as const;

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(2);

async function gasAnswer() {
  const [price, block] = await Promise.all([client.getGasPrice(), client.getBlockNumber()]);
  const gwei = Number(price) / 1e9;
  // A plain transfer is 21k gas; CELO is the gas unit even when fees are
  // abstracted, so this is what a payment really costs right now.
  const celoPerTransfer = (Number(price) * 21000) / 1e18;
  return (
    `Gas on Celo is ${gwei.toFixed(3)} gwei at block ${block}. ` +
    `A simple transfer costs about ${celoPerTransfer.toFixed(8)} CELO. ` +
    `With fee abstraction that fee can be paid in USDC or USDT instead, so a wallet never needs to hold CELO.`
  );
}

async function stablecoinAnswer() {
  // Mento lives on mainnet only. Read mainnet directly rather than returning a
  // apology on testnet: the answer is about Celo, not about which chain this
  // particular server happens to be pointed at.
  const mainnet = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
  const results = await Promise.all(
    Object.values(MENTO_MAINNET).map(async (address) => {
      const [total, symbol, decimals] = await Promise.all([
        mainnet.readContract({ address: getAddress(address), abi: erc20Abi, functionName: "totalSupply" }),
        mainnet.readContract({ address: getAddress(address), abi: erc20Abi, functionName: "symbol" }),
        mainnet.readContract({ address: getAddress(address), abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { symbol, total: Number(formatUnits(total, decimals)) };
    }),
  );

  const listed = results
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((r) => `${r.symbol} ${fmt(r.total)}`)
    .join(", ");
  return (
    `Live Mento stablecoin supply on Celo mainnet: ${listed}. ` +
    `These are local-currency stablecoins, which is why Celo suits payments in markets where a dollar balance is not what people actually spend.`
  );
}

async function x402Answer() {
  const res = await fetch(`${CFG.facilitator}/supported`);
  const kinds = (await res.json()).kinds ?? [];
  const v2 = kinds.filter((k: { x402Version: number }) => k.x402Version === 2);
  return (
    `The Celo x402 facilitator is live and advertises ${v2.length} v2 scheme/network pair(s). ` +
    `It settles USDC and USDT via EIP-3009 transferWithAuthorization and pays the gas itself, so buyers need no CELO. ` +
    `Mento stablecoins cannot settle through it: StableTokenV2 implements EIP-2612 permit, not EIP-3009.`
  );
}

async function blockAnswer() {
  const block = await client.getBlock();
  const age = Math.max(0, Math.floor(Date.now() / 1000 - Number(block.timestamp)));
  return (
    `Celo is at block ${block.number}, produced ${age}s ago with ${block.transactions.length} transactions. ` +
    `Block times are about a second, which is what makes per-request payments feel immediate.`
  );
}

const TOPICS: Array<{ match: RegExp; run: () => Promise<string> }> = [
  { match: /\bgas|fee|cost|cheap|price of a (tx|transaction)/i, run: gasAnswer },
  { match: /\bstablecoin|mento|cusd|ckes|creal|ceur|ccop|local currency/i, run: stablecoinAnswer },
  { match: /\bx402|facilitator|micropayment|pay per|402/i, run: x402Answer },
  { match: /\bblock|height|latency|fast|finality|tps/i, run: blockAnswer },
];

export async function answer(q: string): Promise<string> {
  const topic = TOPICS.find((t) => t.match.test(q));
  if (topic) return topic.run();

  // Say what it does know rather than bluffing. Someone just paid for this.
  return (
    `I answer questions about Celo from live chain data: gas and transaction costs, ` +
    `Mento stablecoin supply, x402 facilitator status, and current block and finality. ` +
    `Ask about one of those and you get the number as it is right now, not a cached figure.`
  );
}
