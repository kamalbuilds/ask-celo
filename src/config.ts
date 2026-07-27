import { celo, celoSepolia } from "viem/chains";

/**
 * Shared by the seller (Node) and the Mini App (browser), so it must not touch
 * `process` directly: `process` is undefined in a browser and referencing it
 * throws at module load, which silently blanks the whole page.
 */
const env = (key: string): string | undefined => {
  const viteEnv = (import.meta as any).env;
  if (viteEnv) return viteEnv[`VITE_${key}`];
  return typeof process === "undefined" ? undefined : process.env[key];
};

export const NETWORK = env("X402_NETWORK") === "mainnet" ? "mainnet" : "testnet";

// Verified against https://x402.celo.org/api/config and the Celo docs.
// USDC/USDT only: the facilitator settles via EIP-3009 transferWithAuthorization,
// and Mento's StableTokenV2 (USDm/cUSD and every local stablecoin) implements
// EIP-2612 permit instead, so it cannot settle here.
export const CFG = {
  mainnet: {
    caip: "eip155:42220" as const,
    chain: celo,
    rpc: env("CELO_RPC") ?? "https://forno.celo.org",
    facilitator: "https://api.x402.celo.org",
    usdc: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    usdcAdapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B", // feeCurrency, NOT the token
    explorer: "https://celo.blockscout.com",
  },
  testnet: {
    caip: "eip155:11142220" as const,
    chain: celoSepolia,
    rpc: env("CELO_RPC") ?? "https://forno.celo-sepolia.celo-testnet.org",
    facilitator: "https://api.x402.sepolia.celo.org",
    usdc: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    usdcAdapter: "0x4822e58de6f5e485eF90df51C41CE01721331dC0",
    explorer: "https://celo-sepolia.blockscout.com",
  },
}[NETWORK];

/**
 * The price of one answer, in one place.
 *
 * It was previously written out in seven: the 402 challenge, the receipt
 * amount, the health endpoint, the button label, and the client's
 * questions-left maths. Changing it meant changing all of them, and missing
 * one would have the UI quoting a price the server does not charge.
 */
export const PRICE = {
  micros: 10_000n,        // USDC has 6 decimals, so 10000 = $0.01
  amount: "10000",        // the string form the x402 packages expect
  usd: 0.01,
  display: "$0.01",
  short: "1c",            // for a button, where "$0.01" is too wide
} as const;
