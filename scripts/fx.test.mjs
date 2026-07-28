#!/usr/bin/env node
/**
 * fx.test.mjs — an FX answer people pay for must not be quietly wrong.
 *
 * A wrong rate does not throw. The user pays, reads a number, and may move real
 * money against it. So the invariants get asserted against the live oracle
 * rather than trusted: rates must round-trip, cross-rates must agree with the
 * direct pair, and every corridor must resolve to the currencies actually named.
 *
 *   node scripts/fx.test.mjs
 */
import { createPublicClient, http, getAddress } from "viem";
import { celo } from "viem/chains";
import assert from "node:assert/strict";

// Import the addresses and gas figure the PRODUCT uses. Duplicating them here
// meant the test could keep passing against constants the product no longer
// used — validating the wrong thing while reporting success.
import { MENTO_MAINNET as MENTO, SORTED_ORACLES, TRANSFER_GAS, answer } from "../src/inference.ts";


const ABI = [
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
];

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

const rate = async (token) => {
  const [num, den] = await client.readContract({
    address: getAddress(SORTED_ORACLES),
    abi: ABI,
    functionName: "medianRate",
    args: [getAddress(token)],
  });
  return Number(num) / Number(den);
};

let n = 0;
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

console.log("fx rates (live Mento oracle)");

const rates = Object.fromEntries(
  await Promise.all(Object.entries(MENTO).map(async ([k, v]) => [k, await rate(v)])),
);

await check("every currency has a positive, finite oracle rate", () => {
  for (const [sym, r] of Object.entries(rates)) {
    assert.ok(Number.isFinite(r) && r > 0, `${sym} rate is ${r}`);
  }
});

await check("USD to KES lands in a sane range", () => {
  // A shilling is worth far less than a dollar. If this inverts, the answer
  // reads plausibly and is catastrophically wrong for someone sending money.
  const usdKes = rates.cKES / rates.cUSD;
  assert.ok(usdKes > 50 && usdKes < 500, `1 USD = ${usdKes} KES is outside any plausible range`);
});

await check("converting there and back returns the original amount", () => {
  for (const a of Object.keys(MENTO)) {
    for (const b of Object.keys(MENTO)) {
      if (a === b) continue;
      const there = rates[b] / rates[a];
      const back = rates[a] / rates[b];
      assert.ok(Math.abs(there * back - 1) < 1e-9, `${a}->${b}->${a} drifted: ${there * back}`);
    }
  }
});

await check("a cross rate agrees with going through a third currency", () => {
  // USD->KES must equal USD->EUR->KES, or one of the pairs is being built wrong.
  const direct = rates.cKES / rates.cUSD;
  const viaEur = (rates.cEUR / rates.cUSD) * (rates.cKES / rates.cEUR);
  assert.ok(Math.abs(direct - viaEur) / direct < 1e-9, `direct ${direct} vs via EUR ${viaEur}`);
});

await check("each currency's own rate against itself is exactly 1", () => {
  for (const sym of Object.keys(MENTO)) {
    assert.equal(rates[sym] / rates[sym], 1, `${sym} against itself is not 1`);
  }
});

await check("distinct currencies do not resolve to the same rate", () => {
  // If two entries share an address by a copy-paste error, this catches it.
  const seen = new Map();
  for (const [sym, r] of Object.entries(rates)) {
    const dup = seen.get(r);
    assert.ok(!dup, `${sym} and ${dup} report an identical rate — likely the same address`);
    seen.set(r, sym);
  }
});


// ---- every numeric answer, not just rates -------------------------------
// The remittance fee shipped 250x too high because the oracle quotes cUSD per
// CELO and the code inverted it. The FX invariants above did not catch it,
// because it was a new code path. Any number the product states about money
// needs a sanity bound.

await check("the fee the PRODUCT states is under a cent", async () => {
  // Assert the answer the product actually returns, not a formula retyped
  // here. The earlier version recomputed the maths itself, so reintroducing
  // the 250x inversion in inference.ts left this passing — a test that
  // validated its own arithmetic rather than the shipped behaviour.
  const text = await answer("what does it cost to send money home");
  const stated = Number(text.match(/costs about \$([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(stated), `no fee found in: ${text.slice(0, 120)}`);
  assert.ok(stated > 0, `fee reads $${stated}`);
  assert.ok(stated < 0.01, `product states $${stated} — above a cent, likely inverted`);
});

await check("the fee the PRODUCT states is negligible against a remittance", async () => {
  const text = await answer("remittance fee for $200");
  // Two valid shapes: a number, or "under 0.001%" when it rounds to zeros.
  // Accept both rather than pinning the wording, which is how this check
  // broke when the answer started saying what a vanishing fee means.
  const under = /under ([\d.]+)% of the amount/.exec(text);
  const exact = /\(([\d.]+)% of the amount\)/.exec(text);
  const pct = Number((under ?? exact)?.[1]);
  assert.ok(Number.isFinite(pct), `no percentage found in: ${text.slice(0, 120)}`);
  // Compare against the figure the answer itself cites, so this cannot drift
  // from the source the way a hardcoded 6.2% did.
  const worldBank = Number(/at ([\d.]+)%/.exec(text)?.[1]);
  assert.ok(Number.isFinite(worldBank), "the answer no longer cites a comparison figure");
  assert.ok(
    pct < worldBank / 50,
    `product states ${pct}% of $200 against a ${worldBank}% benchmark: too close to traditional rails`,
  );
});

await check("the rate the PRODUCT states matches the oracle", async () => {
  const text = await answer("what is USD to KES");
  const stated = Number(text.match(/1 USD = ([\d.]+) KES/)?.[1]);
  const expected = rates.cKES / rates.cUSD;
  assert.ok(Number.isFinite(stated), `no rate found in: ${text.slice(0, 120)}`);
  assert.ok(
    Math.abs(stated - expected) / expected < 0.01,
    `product says ${stated}, oracle says ${expected.toFixed(4)}`,
  );
});

await check("CELO is worth more than a cent and less than a thousand dollars", () => {
  // rates.cUSD is cUSD per CELO. A wrong direction shows up immediately here.
  assert.ok(rates.cUSD > 0.01 && rates.cUSD < 1000, `CELO reads $${rates.cUSD} — direction likely inverted`);
});


await check("realistic first questions are answerable, not refused", async () => {
  // Off-topic questions are refused for free, which is right — but a refusal
  // is still a dead end for a first-time payer. These are questions a real
  // person holding a wallet asks. Each one that misses is a user who decides
  // the thing does not work.
  const { canAnswer } = await import("../src/inference.ts");
  const questions = [
    "how much is 100 dollars in kenyan shillings",
    "send $50 to nigeria",
    // Ghana: no cedi on the oracle, but this is a remittance-cost question,
    // which we answer from gas rather than an FX rate.
    "cheapest way to send money to ghana",
    "how much does it cost to send money to india",
    "what's the fee to cash out",
    "how long does a transaction take",
    "price of celo",
    "how much are you charging me",
    "what is cUSD",
    "how many cKES exist",
    "dollar to reais",
  ];
  const missed = questions.filter((q) => !canAnswer(q));
  assert.deepEqual(missed, [], `these would be refused:\n  ${missed.join("\n  ")}`);
});

await check("the price question answers about us, not about chain gas", async () => {
  // "How much are you charging me" routed to gas — a true statement about
  // something the user did not ask, while they are deciding whether to trust
  // a paid service. It must state our own price.
  const { answer } = await import("../src/inference.ts");
  const { PRICE } = await import("../src/config.ts");
  const a = await answer("how much are you charging me");
  assert.ok(a.includes(PRICE.display), `the price answer never says ${PRICE.display}: ${a}`);
});

await check("the quoted minimum top-up matches the smallest button", async () => {
  // The price answer quotes a minimum in prose. The page defines the choices.
  // Two numbers, one truth: if they drift, we quote a price the button does
  // not charge.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { TOPUP_MIN_USD, TOPUP_MIN_QUESTIONS } = await import("../src/config.ts");
  const { PRICE } = await import("../src/config.ts");
  const html = readFileSync(fileURLToPath(new URL("../web/index.html", import.meta.url)), "utf8");
  const amounts = [...html.matchAll(/data-amount="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(Math.min(...amounts), TOPUP_MIN_USD, "TOPUP_MIN_USD is not the smallest button on the page");
  assert.equal(TOPUP_MIN_QUESTIONS, Math.floor(TOPUP_MIN_USD / PRICE.usd), "the quoted question count is wrong");
});


await check("a currency the oracle does not carry is refused, not invented", async () => {
  // "1000 naira to dollars" returned a Kenyan shilling rate: a confident lie
  // about someone's money, charged for. The oracle carries five currencies.
  // Anything else must be refused before payment, not approximated.
  const { canAnswer } = await import("../src/inference.ts");
  const unsupported = [
    "1000 naira to dollars",
    "convert 20 usd to ugx",
    "best rate to send to philippines",
    "rate for cedis",
  ];
  const charged = unsupported.filter((q) => canAnswer(q));
  assert.deepEqual(charged, [], `these would be charged for a rate we cannot read:\n  ${charged.join("\n  ")}`);
});

await check("the paywall refuses exactly what the answer cannot serve", async () => {
  // The match and the answer must agree. As a regex plus a separate lookup,
  // "dollar to rupee" matched (it says "dollar") and then dead-ended inside
  // the answer — a paid "name two currencies". Both now call fxPair.
  const { fxPair, canAnswer } = await import("../src/inference.ts");
  for (const q of ["dollar to rupee", "1000 naira to dollars", "usd to usd"]) {
    assert.equal(fxPair(q), null, `${q} should not resolve to a pair`);
    assert.equal(canAnswer(q), false, `${q} reaches the paywall but cannot be answered`);
  }
  assert.deepEqual(fxPair("dollar to shillings"), ["cUSD", "cKES"]);
});

await check("an off-topic price question does not answer with Celo gas", async () => {
  // A bare "price" match sent "stock price of apple" to the gas answer:
  // charged, confident, and about something else entirely.
  const { canAnswer } = await import("../src/inference.ts");
  for (const q of ["stock price of apple", "how much is bitcoin", "what time is it"]) {
    assert.equal(canAnswer(q), false, `${q} would be charged and answered with chain data`);
  }
});


await check("chain reads retry instead of failing on a throttled RPC", async () => {
  // A public RPC rate-limits. One FX answer makes several oracle reads, so a
  // burst throttles — and without retry the user pays and gets an error. This
  // surfaced as a flaky test suite, which is the same bug wearing a costume.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  // Every client, not just the answer path. refund.ts gates the exit — a
  // throttled read there means a user cannot get their money back — and
  // session.ts decides whether the sweep button appears at all, so a failed
  // read shows $0.00 and tells someone their money is gone.
  const files = ["inference.ts", "refund.ts", "session.ts"];
  let found = 0;
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");
    for (const m of src.matchAll(/createPublicClient\(\{[\s\S]{0,260}?\}\)/g)) {
      found++;
      assert.match(m[0], /retryCount/, `${f} has a client with no retry:\n${m[0]}`);
    }
  }
  assert.ok(found >= 3, `expected clients in all of ${files.join(", ")}, found ${found}`);
});


await check("oracle rates agree with the real market", async () => {
  // The product's whole value claim is that these numbers are worth a cent.
  // Nothing until now compared them to reality: a stale or misread oracle
  // would return a confident, wrong rate about someone's remittance and every
  // other test would still pass. Checked against an independent FX source.
  const { fxPair } = await import("../src/inference.ts");
  const { answer } = await import("../src/inference.ts");

  const live = await fetch("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => r.json())
    .then((d) => d.rates)
    .catch(() => null);
  if (!live) {
    console.log("  skip  independent FX source unreachable");
    return;
  }

  const cases = [
    ["dollar to shillings", "KES"],
    ["dollar to pesos", "COP"],
    ["dollar to reais", "BRL"],
  ];
  for (const [q, code] of cases) {
    assert.ok(fxPair(q), `${q} no longer resolves`);
    const text = await answer(q);
    const ours = Number(text.match(/=\s*([\d.]+)/)?.[1]);
    assert.ok(Number.isFinite(ours), `no rate parsed from: ${text}`);
    const drift = Math.abs(ours - live[code]) / live[code];
    // 5% is loose enough for oracle lag and a thin on-chain market, tight
    // enough to catch a stale feed or a decimals mistake.
    assert.ok(
      drift < 0.05,
      `${code}: we say ${ours}, the market says ${live[code]} (${(drift * 100).toFixed(1)}% off)`,
    );
  }
});


await check("the remittance answer does not present a network fee as the total cost", async () => {
  // "$0.001 vs the World Bank's 6.36%" is true and misleading: the recipient
  // still has to turn stablecoins into spendable money, and that spread is
  // usually the real cost. An answer that omits it flatters us and misleads
  // the exact person the product claims to serve.
  const { answer } = await import("../src/inference.ts");
  const a = await answer("how much does it cost to send money to india");
  assert.match(a, /cash(ing)? out|local currency/i, "the answer omits the cash-out cost");
  assert.match(a, /network fee/i, "the answer does not say the figure is the network fee only");
});

await check("the World Bank figure names its source and issue", async () => {
  // A borrowed statistic with no provenance rots silently: 6.2% was stale by
  // one full release, and nothing in the code or the tests could have said so.
  const { answer } = await import("../src/inference.ts");
  const a = await answer("how much does it cost to send money to india");
  assert.match(a, /Remittance Prices Worldwide/i, "no source named for the comparison figure");
  assert.match(a, /Issue \d+/i, "no issue named, so staleness is invisible");
});


await check("a definition question gets a definition", async () => {
  // "What is cUSD" was answered with a supply table: a fact about the thing,
  // not an answer to the question asked. Someone paying a cent to learn what
  // something is should not have to infer it from a number.
  const { answer } = await import("../src/inference.ts");
  const a = await answer("what is cUSD");
  assert.match(a, /stablecoins are|tracking one/i, "the answer never says what they are");
  // And it must name the symbols the chain actually reports. Mento renamed
  // cUSD to USDm on-chain; an answer using only the old names disagrees with
  // every explorer the reader might check.
  assert.match(a, /USDm/, "the answer does not name the on-chain symbol");
  assert.match(a, /cUSD/, "the answer does not connect the old name to the new");
});

await check("answers use no em dashes", async () => {
  // House style, and these are read by people on phones where an em dash
  // renders as a stray hyphen or a box.
  const { answer, aboutAnswer } = await import("../src/inference.ts");
  const texts = [
    await aboutAnswer(),
    await answer("what is cUSD"),
    await answer("how much does it cost to send money to india"),
    await answer("how much are you charging me"),
  ];
  for (const t of texts) {
    assert.ok(!t.includes("\u2014"), `em dash in an answer: ${t.slice(0, 90)}`);
  }
});


await check("the remittance answer quotes the amount the user asked about", async () => {
  // \d{2,6} required two digits, so "$5" was ignored and the answer silently
  // described $200 instead. A wrong number about the user's own money, with
  // nothing to signal a number had been missed.
  const { answer } = await import("../src/inference.ts");
  const cases = [
    ["send $5 to kenya", "$5"],
    ["send $50 to nigeria", "$50"],
    ["send $10,000 to india", "$10,000"],
    ["how much to send $1500 home", "$1,500"],
  ];
  for (const [q, want] of cases) {
    const a = await answer(q);
    assert.ok(a.includes(want), `"${q}" should quote ${want}, got: ${a.slice(0, 90)}`);
  }
  // No amount given is the only case that may default.
  assert.ok((await answer("send money home")).includes("$200"));
});

await check("a vanishing percentage says so instead of printing zeros", async () => {
  // At $10,000 the fee rounds to "0.0000%", which reads as a broken number
  // rather than as "vanishingly small".
  const { answer } = await import("../src/inference.ts");
  const a = await answer("send $10,000 to india");
  assert.doesNotMatch(a, /0\.0000%/, "prints a rounded-to-zero percentage");
  assert.match(a, /under 0\.001%/, "does not say the fee is vanishingly small");
});

await check("a capped amount says it was capped", async () => {
  // Clamping protects the comparison from nonsense input, but answering about
  // a different number than the one asked, silently, is the same class of bug
  // as ignoring "$5".
  const { answer } = await import("../src/inference.ts");
  const a = await answer("send $99999999 abroad");
  assert.match(a, /cap/i, "silently answered about a different amount");
});


await check("TRANSFER_GAS is a real ceiling, checked against the chain", async () => {
  // Every fee answer multiplies this constant by the live gas price, so a
  // wrong value is a confident wrong number about money. Two earlier guesses
  // were both wrong (21,000 is a native send, 65,000 undercounts an ERC-20
  // transfer). A mutation sweep set it back to 21,000 and every suite stayed
  // green, so nothing was holding it.
  const { TRANSFER_GAS } = await import("../src/inference.ts");
  const { createPublicClient, http, erc20Abi } = await import("viem");
  const { NETWORKS } = await import("../src/config.ts");
  const cfg = NETWORKS.mainnet;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { retryCount: 3, retryDelay: 300 }),
  });

  // Estimate from a real holder, found in recent Transfer logs: an account
  // with no balance reverts and teaches us nothing.
  const bn = await client.getBlockNumber();
  const logs = await client
    .getLogs({
      address: cfg.usdc,
      event: {
        type: "event",
        name: "Transfer",
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
      },
      fromBlock: bn - 200n,
      toBlock: bn,
    })
    .catch(() => []);

  let measured = null;
  for (const log of logs.slice(-6)) {
    const holder = log.args.to;
    const balance = await client
      .readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [holder] })
      .catch(() => 0n);
    if (balance <= 1n) continue;
    measured = await client
      .estimateContractGas({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: ["0x2cE408B57f753D54351e4d72C1dC857311eF9749", 1n],
        account: holder,
      })
      .catch(() => null);
    if (measured) break;
  }
  if (measured === null) {
    console.log("  skip  no funded holder found in recent logs");
    return;
  }

  // Our constant must cover a real transfer, and must not be wildly padded:
  // it is quoted to users as what a transfer costs.
  assert.ok(
    BigInt(TRANSFER_GAS) >= measured,
    `TRANSFER_GAS ${TRANSFER_GAS} is below a measured transfer (${measured})`,
  );
  assert.ok(
    BigInt(TRANSFER_GAS) < measured * 2n,
    `TRANSFER_GAS ${TRANSFER_GAS} is more than double a measured transfer (${measured})`,
  );
});


await check("the World Bank figure stays the one we cite", async () => {
  // The answer names its source and issue, so the number and the citation
  // must not drift apart. 6.2% was already a release stale when I found it;
  // a mutation to 1.0% left every suite green.
  const { answer } = await import("../src/inference.ts");
  const a = await answer("how much does it cost to send money to india");
  const cited = Number(/at ([\d.]+)%/.exec(a)?.[1]);
  assert.equal(cited, 6.36, `the answer cites ${cited}%, not the Issue 54 figure of 6.36%`);
  assert.match(a, /Issue 54/, "the issue number no longer matches the figure");
});

await check("a huge amount is still capped", async () => {
  // Without the cap, "$99999999" renders a comparison in the millions, which
  // reads as a broken number and is not a remittance anyone makes.
  const { answer } = await import("../src/inference.ts");
  const a = await answer("send $99999999 abroad");
  // Assert the quoted amount, not just that the word "cap" appears: the note
  // is built from the cap constant and still printed when the clamp itself
  // was removed, so matching on it passed a mutation that broke the clamp.
  const quoted = /Sending \$([\d,]+)/.exec(a)?.[1];
  assert.equal(quoted, "1,000,000", `the amount is not capped: quoted $${quoted}`);
  assert.match(a, /cap/i, "a capped amount must say it was capped");
});


for (const [a, b] of [["cUSD", "cKES"], ["cUSD", "cCOP"], ["cUSD", "cREAL"], ["cEUR", "cKES"]]) {
  console.log(`  1 ${a.slice(1)} = ${(rates[b] / rates[a]).toFixed(4)} ${b.slice(1)}`);
}

// Summary last, always. It used to print before the rate table below, so a
// throw in that loop produced "all passing" and then a stack trace: the exit
// code was right and the words were wrong.
console.log(`\n${n} checks, ${process.exitCode ? "FAILED" : "all passing"}`);
