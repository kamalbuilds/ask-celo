import { celo, celoSepolia } from "viem/chains";

/**
 * Shared by the seller (Node) and the Mini App (browser), so it must not touch
 * `process` directly: `process` is undefined in a browser and referencing it
 * throws at module load, which silently blanks the whole page.
 *
 * Note the asymmetry, which has caused two production bugs so far: in the
 * browser this reads `VITE_<key>`, because Vite only exposes prefixed
 * variables to the bundle. Setting `X402_NETWORK` alone left the frontend on
 * Sepolia while the API charged mainnet; setting `ATTRIBUTION_TAG` alone would
 * have shipped every top-up untagged. Any deployment must set BOTH forms.
 *
 * BROWSER_KEYS names the ones that matter, so a deploy script can assert it
 * rather than rediscovering this the hard way.
 */
const env = (key: string): string | undefined => {
  const viteEnv = (import.meta as any).env;
  if (viteEnv) return viteEnv[`VITE_${key}`];
  return typeof process === "undefined" ? undefined : process.env[key];
};

/** Env vars the browser bundle needs, which therefore need a VITE_ twin. */
export const BROWSER_KEYS = ["X402_NETWORK", "ATTRIBUTION_TAG"] as const;

export const NETWORK = env("X402_NETWORK") === "mainnet" ? "mainnet" : "testnet";

// Verified against https://x402.celo.org/api/config and the Celo docs.
// USDC/USDT only: the facilitator settles via EIP-3009 transferWithAuthorization,
// and Mento's StableTokenV2 (USDm/cUSD and every local stablecoin) implements
// EIP-2612 permit instead, so it cannot settle here.
/**
 * Mento's oracle and stablecoins live on mainnet only, so answers about them
 * read mainnet regardless of which network this server sells on. Exported so
 * inference.ts does not restate the URL: it had its own copy, which is the
 * shape that has produced most of the bugs in this codebase.
 */
export const MAINNET_RPC = env("CELO_RPC_MAINNET") ?? "https://forno.celo.org";

export const NETWORKS = {
  mainnet: {
    caip: "eip155:42220" as const,
    chain: celo,
    rpc: env("CELO_RPC") ?? MAINNET_RPC,
    facilitator: "https://api.x402.celo.org",
    usdc: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    usdcAdapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B", // feeCurrency, NOT the token
    // ERC-8004 identity registry, used by scripts/register-8004.mjs.
    registry8004: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    explorer: "https://celo.blockscout.com",
  },
  testnet: {
    caip: "eip155:11142220" as const,
    chain: celoSepolia,
    rpc: env("CELO_RPC") ?? "https://forno.celo-sepolia.celo-testnet.org",
    facilitator: "https://api.x402.sepolia.celo.org",
    usdc: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    usdcAdapter: "0x4822e58de6f5e485eF90df51C41CE01721331dC0",
    registry8004: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    explorer: "https://celo-sepolia.blockscout.com",
  },
} as const;

/**
 * The network this server sells on, chosen at import.
 *
 * gates.mjs needs a different network than the environment (it asks the
 * deployed service which chain it is on, at runtime), so it takes NETWORKS
 * instead. It used to keep a private copy of this table, which is how it
 * spent a day checking testnet while production sold on mainnet.
 */
export const CFG = NETWORKS[NETWORK];

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

/**
 * The smallest top-up offered on the page. Derived into prose by the answer
 * that states our own price, so the number a user is quoted cannot drift from
 * the number the button charges. The page is the source of truth for the
 * choices; this must stay equal to the smallest data-amount in web/index.html,
 * which app.test.mjs asserts.
 */
export const TOPUP_MIN_USD = 0.25;
export const TOPUP_MIN = "25c";
export const TOPUP_MIN_QUESTIONS = Math.floor(TOPUP_MIN_USD / PRICE.usd);
