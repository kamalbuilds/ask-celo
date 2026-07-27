import { createWalletClient, http, getAddress, concat, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toDataSuffix } from "@celo/attribution-tags";
import { CFG } from "./config.js";

/**
 * Writes one on-chain receipt per paid answer.
 *
 * x402 settlements move funds inside the token contract, so from outside they
 * are indistinguishable from any other transfer and carry no record of what was
 * bought. This makes usage publicly auditable rather than something we assert.
 *
 * It also carries the ERC-8021 attribution tag, which is what credits the
 * activity to this project. The settlement itself cannot carry a tag — the
 * facilitator sends that transaction, not us — so this is the transaction that
 * makes the work countable.
 */
const ABI = [
  {
    type: "function",
    name: "record",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "micros", type: "uint128" },
      { name: "settlement", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const address = process.env.RECEIPTS_CONTRACT;
const key = process.env.RECORDER_PRIVATE_KEY as Hex | undefined;
const tag = process.env.ATTRIBUTION_TAG;

const wallet =
  address && key
    ? createWalletClient({
        account: privateKeyToAccount(key),
        chain: CFG.chain,
        transport: http(CFG.rpc),
      })
    : null;

export const receiptsEnabled = Boolean(wallet);

/**
 * Receipts are fire-and-forget, so a persistent failure is invisible: sales
 * keep succeeding while the attribution that credits them silently stops.
 * These counters make that observable through /api/health.
 */
export const receiptStats = { attempted: 0, recorded: 0, failed: 0, lastError: "" as string };

/**
 * Fire-and-forget by design: the buyer already has their answer, and a receipt
 * failing must never turn a successful paid call into an error. Failures are
 * logged, not raised.
 */
/**
 * Build the receipt calldata, tag included.
 *
 * Exported so a test can exercise the shipped builder rather than retyping the
 * same concatenation. Only the assigned tag is credited, so a receipt that
 * loses it is on-chain activity attributed to nobody.
 */
export function buildReceiptData(
  user: string,
  micros: bigint,
  settlementTx: string,
  attributionTag = tag,
): Hex {
  const data = encodeFunctionData({
    abi: ABI,
    functionName: "record",
    args: [getAddress(user), micros, settlementTx as Hex],
  });
  return attributionTag ? concat([data, toDataSuffix(attributionTag)]) : data;
}

export function recordReceipt(user: string, micros: bigint, settlementTx: string): void {
  if (!wallet || !address) return;

  const tx = {
    to: getAddress(address),
    data: buildReceiptData(user, micros, settlementTx),
  };

  // Prefer paying gas in USDC so the recorder needs no CELO. Not every adapter
  // is registered on every network — Sepolia reverts with "Currency not in the
  // directory" — so fall back to native gas rather than dropping the receipt,
  // which would lose the attribution that makes the work countable.
  receiptStats.attempted += 1;
  wallet
    .sendTransaction({ ...tx, feeCurrency: getAddress(CFG.usdcAdapter) } as never)
    .catch(() => wallet.sendTransaction(tx as never))
    .then(() => {
      receiptStats.recorded += 1;
    })
    .catch((err: unknown) => {
      receiptStats.failed += 1;
      receiptStats.lastError = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      console.error("receipt not recorded:", receiptStats.lastError);
    });
}
