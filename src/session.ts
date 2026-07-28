import { createWalletClient, http, createPublicClient, erc20Abi, encodeFunctionData, concat, parseUnits, formatUnits, getAddress, type Hex, type Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { toDataSuffix } from "@celo/attribution-tags";
import { CFG } from "./config.js";

const KEY_STORAGE = "x402.session.key";

/**
 * The session key is what makes MiniPay usable with x402 at all.
 *
 * MiniPay does not implement personal_sign or eth_signTypedData, and x402
 * settlement requires an EIP-3009 typed-data signature. So MiniPay's wallet
 * can never sign a payment directly. What it *can* do is eth_sendTransaction.
 *
 * So: generate a key in the browser, have MiniPay make one ordinary transfer
 * into it, and let that key sign every payment afterwards. The user signs
 * nothing; they approve a single transfer they can read.
 *
 * The key stays on the device. It is a spending allowance, not an identity,
 * and it should hold about as much as a banknote in a pocket.
 */
export function loadSessionKey(): { address: Address; privateKey: Hex } {
  let pk = localStorage.getItem(KEY_STORAGE) as Hex | null;
  if (!pk) {
    pk = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, pk);
  }
  return { address: privateKeyToAccount(pk).address, privateKey: pk };
}

// Retry: every balance read in the browser goes through this, including the
// one that decides whether the sweep button appears at all. A throttled RPC
// showing $0.00 tells a user their money is gone.
const publicClient = createPublicClient({
  chain: CFG.chain,
  transport: http(CFG.rpc, { retryCount: 3, retryDelay: 300 }),
});

export async function usdcBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({
    address: getAddress(CFG.usdc),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export const toUsd = (v: bigint) => Number(formatUnits(v, 6));

export function isMiniPay(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).ethereum?.isMiniPay);
}

/**
 * Auto-connect is mandatory inside MiniPay: never render a Connect Wallet
 * button when isMiniPay is true.
 */
export async function connect(): Promise<Address | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  return account ? getAddress(account) : null;
}

/**
 * The single on-chain action the user ever takes: move USDC from MiniPay into
 * the session key, carrying our ERC-8021 attribution tag.
 *
 * Deliberately eth_sendTransaction and nothing else — no signature prompt, so
 * it works inside MiniPay. Legacy tx shape (no EIP-1559 fields) because
 * MiniPay ignores them. Gas is paid in USDC via the adapter, so the user never
 * needs CELO and never sees it.
 */
/**
 * Build the top-up calldata, tag included.
 *
 * Exported so a test can exercise the shipped builder. This is the user's only
 * on-chain transaction, so it is the one that carries attribution — an
 * untagged top-up is real volume credited to nobody.
 */
export function buildTopUpData(to: Address, amountUsd: number, tag?: string): Hex {
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, parseUnits(String(amountUsd), 6)],
  });
  // ERC-8021: trailing bytes the EVM discards, so execution is unchanged.
  // Only the assigned tag is credited, so it must be present, but our own
  // code can ride alongside it.
  return tag ? concat([transfer, toDataSuffix([tag])]) : transfer;
}

export async function topUp(from: Address, amountUsd: number, tag?: string): Promise<Hex> {
  const session = loadSessionKey();
  const data = buildTopUpData(session.address, amountUsd, tag);

  return (window as any).ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: getAddress(CFG.usdc),
        data,
        feeCurrency: getAddress(CFG.usdcAdapter), // pay gas in USDC, never CELO
      },
    ],
  });
}

/**
 * Return whatever is left to the user's own wallet.
 *
 * This cannot be an ordinary ERC-20 transfer. The session key is funded with
 * USDC and never with CELO, so a normal transfer reverts with "gas required
 * exceeds allowance (0)" — verified against a real key holding 19.68 USDC and
 * no gas. The USDC fee-currency adapter does not rescue it either, because the
 * adapter still needs the account to be able to pay.
 *
 * So the refund uses the same mechanism the payments use: an EIP-3009
 * authorization settled by the facilitator, which submits the transaction and
 * pays the gas. The user needs nothing, and this works even when the session
 * key holds no gas at all — which is always.
 */
export async function sweepBack(to: Address): Promise<Hex | null> {
  const session = loadSessionKey();
  const balance = await usdcBalance(session.address);
  if (balance === 0n) return null;

  const account = privateKeyToAccount(session.privateKey);
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const authorization = {
    from: account.address,
    to,
    value: balance.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + 3600),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: "USDC",
      version: "2",
      chainId: CFG.chain.id,
      verifyingContract: getAddress(CFG.usdc),
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to,
      value: balance,
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce,
    },
  });

  // Our own server relays this to the facilitator, because settlement needs the
  // metering key and that must never reach the browser.
  const res = await fetch("/api/refund", {
    // Same reasoning as the ask path: the button is disabled while this runs,
    // so an unbounded wait is a stuck UI with no explanation.
    signal: AbortSignal.timeout(60_000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature, authorization }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `refund failed (${res.status})`);

  // A 200 with no hash means the settlement did not happen. Returning null here
  // would surface as "Nothing to return" while the money is still sitting there.
  if (!body.transaction) throw new Error("refund did not settle");
  return body.transaction;
}
