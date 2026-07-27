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

export const publicClient = createPublicClient({ chain: CFG.chain, transport: http(CFG.rpc) });

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
export async function topUp(from: Address, amountUsd: number, tag?: string): Promise<Hex> {
  const session = loadSessionKey();
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [session.address, parseUnits(String(amountUsd), 6)],
  });

  // ERC-8021: trailing bytes the EVM discards, so execution is unchanged.
  // Only the assigned tag is credited, so it must be present, but our own
  // code can ride alongside it.
  const data = tag ? concat([transfer, toDataSuffix([tag])]) : transfer;

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
 * Return whatever is left to the user's own wallet. The session key is a
 * convenience, so getting money out of it must not depend on our server
 * being up or on us being trustworthy.
 */
export async function sweepBack(to: Address): Promise<Hex | null> {
  const session = loadSessionKey();
  const balance = await usdcBalance(session.address);
  if (balance === 0n) return null;

  const wallet = createWalletClient({
    account: privateKeyToAccount(session.privateKey),
    chain: CFG.chain,
    transport: http(CFG.rpc),
  });

  return wallet.writeContract({
    address: getAddress(CFG.usdc),
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, balance],
    feeCurrency: getAddress(CFG.usdcAdapter),
  } as any);
}
