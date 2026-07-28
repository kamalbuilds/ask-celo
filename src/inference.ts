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
 * Gas for one stablecoin transfer, measured from real Celo mainnet settlements
 * rather than assumed (median 85,794 across a sample of live
 * transferWithAuthorization txs). Two earlier guesses were both wrong: 21,000
 * is a bare native send, and 65,000 undercounted an ERC-20 transfer.
 */
export const TRANSFER_GAS = 86_000;

/**
 * Mento local-currency stablecoins, the thing Celo has that other chains do not.
 * Mainnet only: these are not deployed on Sepolia, and reading them there throws
 * a confusing "function does not exist" rather than returning nothing.
 */
export const MENTO_MAINNET = {
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
  // CELO is the gas unit even when fees are abstracted, so this is what a
  // stablecoin payment really costs right now.
  const celoPerTransfer = (Number(price) * TRANSFER_GAS) / 1e18;
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

/**
 * Mento's on-chain oracle: the median CELO rate for each local stablecoin.
 * Dividing two of them gives a real FX rate between local currencies, sourced
 * on-chain rather than from a rate-shop's website.
 */
export const SORTED_ORACLES = "0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33";
const ORACLE_ABI = [
  {
    type: "function",
    name: "medianRate",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "numerator", type: "uint256" },
      { name: "denominator", type: "uint256" },
    ],
  },
] as const;

/** Local currency names, because "cKES" means nothing to the person holding it. */
const CURRENCY = {
  cUSD: "US dollars",
  cEUR: "euros",
  cREAL: "Brazilian reais",
  cKES: "Kenyan shillings",
  cCOP: "Colombian pesos",
} as const;

const mainnetClient = () =>
  createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

async function ratePerCelo(token: string) {
  const [num, den] = await mainnetClient().readContract({
    address: getAddress(SORTED_ORACLES),
    abi: ORACLE_ABI,
    functionName: "medianRate",
    args: [getAddress(token)],
  });
  return Number(num) / Number(den);
}

/**
 * What a paycheck is worth in another currency, from the oracle the chain
 * itself settles against. This is the question someone sending money home
 * actually asks, and the answer is worth more than the cent it costs.
 */
async function fxAnswer(q: string) {
  // Match on how people actually name money, not on ticker symbols. "pesos",
  // "brazil" and "shillings" must each find the right currency; matching only
  // the ticker made every query fall through to the same default.
  const ALIASES: Array<[keyof typeof MENTO_MAINNET, RegExp]> = [
    ["cUSD", /\b(usd|dollars?|usdc?|usdt)\b/i],
    ["cEUR", /\b(eur|euros?)\b/i],
    ["cREAL", /\b(real|reais|brl|brazil(ian)?)\b/i],
    ["cKES", /\b(kes|shillings?|kenya(n)?)\b/i],
    ["cCOP", /\b(cop|pesos?|colombia(n)?)\b/i],
  ];

  // Order by where each currency appears, so "USD to KES" and "KES to USD"
  // are not the same question.
  const found = ALIASES.map(([sym, re]) => [sym, q.search(re)] as const)
    .filter(([, i]) => i >= 0)
    .sort((x, y) => x[1] - y[1])
    .map(([sym]) => sym);

  const pair: [keyof typeof MENTO_MAINNET, keyof typeof MENTO_MAINNET] =
    found.length >= 2 ? [found[0], found[1]] : ["cUSD", found[0] ?? "cKES"];
  const [a, b] = pair;
  if (a === b) return `Name two different currencies, for example "USD to KES".`;

  const [rateA, rateB] = await Promise.all([
    ratePerCelo(MENTO_MAINNET[a]),
    ratePerCelo(MENTO_MAINNET[b]),
  ]);

  // Both are quoted per CELO, so the ratio cancels CELO out.
  const rate = rateB / rateA;
  return (
    `1 ${a.slice(1)} = ${rate.toFixed(rate > 100 ? 0 : 4)} ${b.slice(1)}, ` +
    `from Mento's on-chain oracle (${CURRENCY[a]} to ${CURRENCY[b]}). ` +
    `This is the rate the chain settles at, so a swap on Celo executes near it ` +
    `rather than at a counter's posted spread.`
  );
}

/**
 * What sending money actually costs, which is the question behind most
 * remittance searches. The Celo side is measured live; the comparison figure
 * is the World Bank's published global average (Remittance Prices Worldwide,
 * ~6.2% of a $200 transfer) and is labelled as such rather than implied.
 */
async function remittanceAnswer(q: string) {
  const mainnet = mainnetClient();
  const [gasPrice, celoUsd] = await Promise.all([
    mainnet.getGasPrice(),
    ratePerCelo(MENTO_MAINNET.cUSD),
  ]);

  // medianRate(cUSD) quotes cUSD per CELO directly, so it multiplies —
  // inverting it overstated the fee ~250x, which would have been a
  // confidently wrong number about money.
  const feeUsd = ((Number(gasPrice) * TRANSFER_GAS) / 1e18) * celoUsd;

  const amount = Number(q.match(/\$?\s?(\d{2,6})/)?.[1] ?? 200);
  const WORLD_BANK_PCT = 6.2;
  const traditional = (amount * WORLD_BANK_PCT) / 100;
  const pct = (feeUsd / amount) * 100;

  return (
    `Sending $${amount} in stablecoins on Celo costs about $${feeUsd.toFixed(4)} in network fees ` +
    `(${pct.toFixed(4)}% of the amount), at ${(Number(gasPrice) / 1e9).toFixed(1)} gwei right now. ` +
    `The World Bank puts the global average cost of sending $200 at ${WORLD_BANK_PCT}%; ` +
    `at that rate this transfer would cost about $${traditional.toFixed(2)}. ` +
    `The fee can be paid in the stablecoin itself, so no separate gas token is needed.`
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

const TOPICS: Array<{ match: RegExp; run: (q: string) => Promise<string> }> = [
  {
    match: /\b(remit\w*|send(ing)? money|transfer fee|western union|moneygram|wire|abroad|back home|diaspora)\b/i,
    run: remittanceAnswer,
  },
  {
    match: /\b(usd|eur|kes|cop|brl|real|reais|shillings?|pesos?|dollars?|euros?|kenya\w*|colombia\w*|brazil\w*|rate|exchange|fx|convert|worth)\b/i,
    run: fxAnswer,
  },
  { match: /\bgas|fee|cost|cheap|price of a (tx|transaction)/i, run: gasAnswer },
  { match: /\bstablecoin|mento|cusd|ckes|creal|ceur|ccop|local currency/i, run: stablecoinAnswer },
  { match: /\bx402|facilitator|micropayment|pay per|402/i, run: x402Answer },
  { match: /\bblock|height|latency|fast|finality|tps/i, run: blockAnswer },
];

/**
 * Whether a question matches a topic we can actually answer from chain data.
 *
 * The payment middleware runs before the handler, so without this check an
 * unanswerable question is charged $0.01 and receives a list of suggestions.
 * Taking money for "I cannot answer that" is the fastest way to lose the
 * third-party payer we are trying to earn.
 */
export const SUGGESTIONS =
  `I answer from live Celo chain data. Try an exchange rate ("what is USD to KES"), ` +
  `what a transaction costs, how much of a local stablecoin exists, or how fast blocks are. ` +
  `Every answer is read at the moment you ask, not cached.`;

export function canAnswer(q: string): boolean {
  return TOPICS.some((t) => t.match.test(q));
}

export async function answer(q: string): Promise<string> {
  const topic = TOPICS.find((t) => t.match.test(q));
  if (topic) return topic.run(q);

  // Unreachable via /api/ask, which refuses unanswerable questions for free
  // before charging. Kept so a direct caller of answer() still gets guidance
  // rather than an empty string.
  return SUGGESTIONS;
}
