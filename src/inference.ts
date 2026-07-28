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
import { CFG, MAINNET_RPC, PRICE, TOPUP_MIN, TOPUP_MIN_QUESTIONS } from "./config.js";

// Same reasoning as MAINNET below: a paid request must not fail because a
// public RPC throttled one read.
const client = createPublicClient({
  chain: CFG.chain,
  transport: http(CFG.rpc, { retryCount: 3, retryDelay: 300 }),
});

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
  const mainnet = mainnetClient();
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
    // Say what they are before saying how much exists. "What is cUSD" was
    // answered with a supply table, which is a fact about the thing rather
    // than an answer to the question.
    `Mento stablecoins are Celo's local-currency stablecoins, each tracking one ` +
    `national currency and backed by an on-chain reserve. On-chain they are now ` +
    `named USDm, KESm, COPm, EURm and BRLm. The older cUSD/cKES names still ` +
    `appear in docs and wallets, but the contracts report the new symbols. ` +
    `Live supply on Celo mainnet: ${listed}. ` +
    `They are why Celo suits payments in markets where a dollar balance is not what people actually spend.`
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
    name: "medianTimestamp",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
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

/**
 * One mainnet client, built once and retrying.
 *
 * This was a factory returning a fresh client per call, with no retry. A
 * public RPC rate-limits, so a burst of oracle reads — which is exactly what
 * one FX answer does — failed outright. The user paid, and got an error.
 * viem retries with backoff when asked; asking costs one argument.
 */
const MAINNET = createPublicClient({
  chain: celo,
  transport: http(MAINNET_RPC, { retryCount: 3, retryDelay: 300 }),
});
const mainnetClient = () => MAINNET;

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
 * How long ago the oracle for a token was last updated, in hours.
 *
 * The product sells these rates as read live. That is true of the read, and
 * not always of the feed: cUSD refreshes every few minutes while the local
 * currencies can sit ten hours old. Selling a ten-hour-old rate as live is
 * the kind of claim about money this codebase keeps having to fix, so the
 * answer says the age when it is material.
 */
async function oracleAgeHours(token: string): Promise<number | null> {
  const t = await mainnetClient()
    .readContract({
      address: getAddress(SORTED_ORACLES),
      abi: ORACLE_ABI,
      functionName: "medianTimestamp",
      args: [getAddress(token)],
    })
    .catch(() => null);
  // 0 means the oracle has never reported for this token, which is a stronger
  // statement than "stale" and must not be rendered as 495,898 hours old.
  if (t === null) return null;
  if (t === 0n) return Infinity;
  return (Date.now() / 1000 - Number(t)) / 3600;
}

/**
 * The currencies the Mento oracle actually carries. Anything outside this
 * list is refused for free rather than answered with a different country's
 * rate — "1000 naira to dollars" was returning a Kenyan shilling figure,
 * which is a confident lie about someone's money.
 */
export const SUPPORTED_CURRENCIES = "US dollars, euros, Kenyan shillings, Colombian pesos and Brazilian reais";

const FX_MATCH =
  /\b(usd|eur|kes|cop|brl|real|reais|shillings?|pesos?|dollars?|euros?|kenya\w*|colombia\w*|brazil\w*|cusd|ceur|ckes|ccop|creal)\b/i;

/**
 * What a paycheck is worth in another currency, from the oracle the chain
 * itself settles against. This is the question someone sending money home
 * actually asks, and the answer is worth more than the cent it costs.
 */
/**
 * The two currencies a question is about, or null if we cannot serve it.
 *
 * The match and the answer must use exactly this function. When they were a
 * regex and a separate lookup, "dollar to rupee" matched (it says "dollar")
 * and then dead-ended in the answer — a paid "name two currencies". A question
 * we cannot answer must be refused before payment, which means the paywall
 * needs the real resolution, not an approximation of it.
 */
export function fxPair(
  q: string,
): [keyof typeof MENTO_MAINNET, keyof typeof MENTO_MAINNET] | null {
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

  // One currency means the other is implied to be the dollar, which is what
  // "what are shillings worth" means. Two of the same is not a question.
  const pair: [keyof typeof MENTO_MAINNET, keyof typeof MENTO_MAINNET] =
    found.length >= 2 ? [found[0], found[1]] : ["cUSD", found[0] ?? "cUSD"];
  return pair[0] === pair[1] ? null : pair;
}

/** A note when the older of two oracle feeds is stale enough to matter. */
function staleNote(a: number | null, b: number | null): string | null {
  const oldest = Math.max(a ?? 0, b ?? 0);
  if (oldest === Infinity)
    return ` One side of this pair has no oracle history on-chain, so treat the rate as indicative rather than current.`;
  if (oldest < 2) return null;
  return oldest > 24
    ? ` This pair's oracle has not updated in over a day, so treat it as indicative rather than current.`
    : ` This pair's oracle last updated about ${Math.round(oldest)}h ago.`;
}

async function fxAnswer(q: string) {
  const pair = fxPair(q);
  // Unreachable through /api/ask, which refuses when fxPair returns null.
  if (!pair) return SUGGESTIONS;
  const [a, b] = pair;

  const [rateA, rateB, ageA, ageB] = await Promise.all([
    ratePerCelo(MENTO_MAINNET[a]),
    ratePerCelo(MENTO_MAINNET[b]),
    oracleAgeHours(MENTO_MAINNET[a]),
    oracleAgeHours(MENTO_MAINNET[b]),
  ]);

  // Both are quoted per CELO, so the ratio cancels CELO out.
  const rate = rateB / rateA;
  return (
    `1 ${a.slice(1)} = ${rate.toFixed(rate > 100 ? 0 : 4)} ${b.slice(1)}, ` +
    `from Mento's on-chain oracle (${CURRENCY[a]} to ${CURRENCY[b]}). ` +
    `This is the rate the chain settles at, so a swap on Celo executes near it ` +
    `rather than at a counter's posted spread.`
    // Say when the feed is old. The read is live; the feed is not always, and
    // "live" about a ten-hour-old rate is exactly the kind of money claim
    // nothing had measured.
    + (staleNote(ageA, ageB) ?? "")
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
  // The fee is priced in dollars through the same oracle, so a stale feed
  // moves the headline number this answer exists to state.
  const [gasPrice, celoUsd, age] = await Promise.all([
    mainnet.getGasPrice(),
    ratePerCelo(MENTO_MAINNET.cUSD),
    oracleAgeHours(MENTO_MAINNET.cUSD),
  ]);

  // medianRate(cUSD) quotes cUSD per CELO directly, so it multiplies —
  // inverting it overstated the fee ~250x, which would have been a
  // confidently wrong number about money.
  const feeUsd = ((Number(gasPrice) * TRANSFER_GAS) / 1e18) * celoUsd;

  // \d{2,6} silently ignored "$5" and answered about $200 instead — a wrong
  // number about the user's own money, with no sign anything was missed.
  // One digit up, commas allowed, and clamped so "$99999999" cannot render a
  // nonsense comparison.
  const raw = q.match(/\$?\s?(\d[\d,]{0,9})/)?.[1];
  const parsed = raw ? Number(raw.replace(/,/g, "")) : NaN;
  const wanted = Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
  const CAP = 1_000_000;
  const amount = Math.min(wanted, CAP);
  // Never silently answer about a different number than the one asked.
  const capNote =
    wanted > CAP ? ` (quoted at the $${CAP.toLocaleString("en-US")} I cap this at)` : "";
  // Remittance Prices Worldwide, Issue 54 (Q3 2025 data, the most recent
  // release). 6.2% was stale. The number is the comparison the whole answer
  // rests on, so it names its source and issue rather than floating free.
  const WORLD_BANK_PCT = 6.36;
  const traditional = (amount * WORLD_BANK_PCT) / 100;
  const pct = (feeUsd / amount) * 100;
  // At $10,000 this rounds to "0.0000%", which reads as a bug rather than as
  // "vanishingly small". Say what it means instead of printing zeros.
  const pctText = pct < 0.001 ? "under 0.001%" : `${pct.toFixed(4)}%`;

  return (
    `Sending $${amount.toLocaleString("en-US")}${capNote} in stablecoins on Celo ` +
    `costs about $${feeUsd.toFixed(4)} in network fees ` +
    `(${pctText} of the amount), at ${(Number(gasPrice) / 1e9).toFixed(1)} gwei right now. ` +
    `The World Bank's Remittance Prices Worldwide (Issue 54, Q3 2025) puts the global ` +
    `average cost of sending $200 at ${WORLD_BANK_PCT}%; ` +
    `at that rate this transfer would cost about $${traditional.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. ` +
    `The fee can be paid in the stablecoin itself, so no separate gas token is needed. ` +
    // Without this the answer is true and misleading. The network fee is not
    // the cost of the transfer: the recipient still has to turn stablecoins
    // into money they can spend, and that spread is the number that decides
    // whether any of this actually helps them.
    `That is the network fee only. Cashing out to local currency costs whatever ` +
    `your exchange or P2P desk charges, and that spread, not the transfer, is ` +
    `usually the real cost.` +
    (staleNote(age, null) ?? "")
  );
}

async function x402Answer() {
  // The user has already paid by the time this runs. A slow facilitator must
  // fail fast enough that the handler can return an error, rather than being
  // killed by the platform with the payment already settled.
  const res = await fetch(`${CFG.facilitator}/supported`, {
    signal: AbortSignal.timeout(10_000),
  });
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


/**
 * What this service costs, and what it charges for.
 *
 * "How much are you charging me" was routing to chain gas, which answers a
 * question nobody asked while the user is holding a wallet wondering what
 * they just agreed to. A paid service that cannot state its own price is
 * not one a stranger pays twice.
 */
async function priceAnswer() {
  return (
    `Each question costs ${PRICE.display} in USDC, taken at the moment you ask. ` +
    `No subscription and no minimum: add ${TOPUP_MIN} and it is ${TOPUP_MIN_QUESTIONS} questions. ` +
    `Unused credit returns to your wallet with the button at the bottom of the page. ` +
    `Off-topic questions are refused before payment, so you are never charged for "I cannot answer that".`
  );
}

/**
 * The CELO price from the same oracle the chain settles against. "Price of
 * celo" was answering with gas — technically about price, not the question.
 */
async function celoPriceAnswer() {
  // Same feed as the FX answers, so the same honesty applies. cUSD refreshes
  // every few minutes today; nothing guarantees it will tomorrow, and a price
  // is exactly the kind of number people act on.
  const [usd, age] = await Promise.all([
    ratePerCelo(MENTO_MAINNET.cUSD),
    oracleAgeHours(MENTO_MAINNET.cUSD),
  ]);
  return (
    `1 CELO is $${usd.toFixed(4)}, read from the Mento SortedOracles median that Celo itself ` +
    `settles stablecoin trades against, not an exchange ticker. ` +
    `Fees on this page are quoted in USDC, so the CELO price does not change what a question costs you.` +
    (staleNote(age, null) ?? "")
  );
}


/**
 * Questions about the service itself, answered free and before the paywall.
 *
 * "Is this a scam", "can I get a refund", "what happens to my money" are what
 * a stranger asks while deciding whether to pay at all. Charging for them is
 * absurd — they have not agreed to anything yet — and refusing them is a dead
 * end at the exact moment trust is being decided. They are free.
 */
export const ABOUT_MATCH =
  /\b(scam|rug|legit|trust|safe|refund|money back|get my money|store|storing|save|privacy|private|log|who (are|made) you|what is this|what.s this|what can I ask|what do you do|how does this work|need (a )?wallet|which wallet|what wallet|happens to my|need celo|why usdc|how do I (add|top ?up)|minipay|sign ?up|account|subscription)\b/i;

export async function aboutAnswer() {
  return (
    `This is a pay-per-question service on Celo. Each question costs ${PRICE.display} in USDC. ` +
    `There is no sign-up and no account: your browser holds a key, you top it up, and questions ` +
    `are paid one at a time over x402. Questions I cannot answer are refused before payment, ` +
    `so you are never charged for a non-answer. ` +
    `Unused credit goes back to your wallet whenever you want: the button at the bottom of the page ` +
    `returns the full remaining balance, and it works even though that key holds no CELO for gas. ` +
    `Questions are answered from live chain reads and are not stored. ` +
    `Any wallet works, including MiniPay, and you never need to hold CELO: fees are paid in USDC. ` +
    `The code is at https://github.com/kamalbuilds/ask-celo if you would rather read it than trust it.`
  );
}

// A topic matches by pattern, or by a predicate when the real test is more
// than a regex — the FX pair must be resolved, not guessed, so the paywall
// refuses exactly what the answer cannot serve.
type Match = RegExp | ((q: string) => boolean);
const test = (m: Match, q: string) => (typeof m === "function" ? m(q) : m.test(q));

const TOPICS: Array<{ match: Match; run: (q: string) => Promise<string> }> = [
  {
    match: /\b(remit\w*|send(ing)? (money|\$?\d+)|transfer fee|western union|moneygram|wire|abroad|back home|diaspora|cash out)\b/i,
    run: remittanceAnswer,
  },
  {
    // A currency name alone is not enough: the oracle carries five, and
    // matching "rate" or "convert" on its own answered a Nigerian naira
    // question with a Kenyan shilling rate. Require a currency we actually
    // carry, so anything else is refused for free instead of invented.
    match: (q: string) => fxPair(q) !== null,
    run: fxAnswer,
  },
  // Before the gas match: "how much are you charging me" is about this
  // service, not the chain.
  {
    match: /\b(charg\w+|your (price|fee|cost)|cost .*(ask|question)|per question|how much (is|does) (this|it)|subscription|free)\b/i,
    run: priceAnswer,
  },
  // Before the gas match: "price of celo" is the asset, not a transaction.
  { match: /\b(price|worth|value) of (a )?celo\b|\bcelo (price|worth)\b/i, run: celoPriceAnswer },
  // "price" alone matched "stock price of apple" and answered with Celo gas.
  // Anchor the fee questions to a transaction, or to the chain itself.
  {
    match:
      /\b(gas|fees?|cheap|expensive)\b|\b(cost|price)\b.*\b(tx|transaction|transfer|send|celo|chain|network|question)\b|\b(transaction|transfer)\b.*\b(cost|price|fee)\b/i,
    run: gasAnswer,
  },
  { match: /\bstablecoin|mento|cusd|ckes|creal|ceur|ccop|local currency/i, run: stablecoinAnswer },
  { match: /\bx402|facilitator|micropayment|pay per|402/i, run: x402Answer },
  { match: /\bblock|height|latency|fast|finality|tps|how long|slow|confirm/i, run: blockAnswer },
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
  return TOPICS.some((t) => test(t.match, q));
}

/**
 * One example per topic, for /api/health.
 *
 * An agent reading the service needs to know what it can ask before paying.
 * These are asserted answerable, so the list cannot drift from what the topic
 * table actually serves.
 */
export const TOPIC_EXAMPLES = [
  "what is a dollar worth in kenyan shillings",
  "how much does it cost to send money to india",
  "what does a transfer cost",
  "what is cUSD",
  "what is x402",
  "how long does a transaction take",
  "how much are you charging me",
] as const;

export async function answer(q: string): Promise<string> {
  const topic = TOPICS.find((t) => test(t.match, q));
  if (topic) return topic.run(q);

  // Unreachable via /api/ask, which refuses unanswerable questions for free
  // before charging. Kept so a direct caller of answer() still gets guidance
  // rather than an empty string.
  return SUGGESTIONS;
}
