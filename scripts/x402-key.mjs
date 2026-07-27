#!/usr/bin/env node
/**
 * x402-key.mjs — mint an x402 facilitator API key from a local wallet.
 *
 * The dashboard does this with an injected browser wallet, but the flow is
 * only: GET a nonce, sign a plain message with personal_sign, POST the
 * signature. No gas, no transaction, no funds at risk. So it works with a
 * throwaway key and needs nobody's main wallet.
 *
 *   node scripts/x402-key.mjs                     # generate a fresh key wallet
 *   X402_KEY_WALLET=0x… node scripts/x402-key.mjs # reuse an existing one
 *   node scripts/x402-key.mjs --rotate            # replace the key (old dies)
 *
 * Writes the wallet to .x402-wallet.json and the key to .env.local, both
 * git-ignored. The wallet only ever signs this message and receives top-ups;
 * the account it identifies is what holds facilitator credits.
 */
import { writeFileSync, existsSync, readFileSync, chmodSync, appendFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const HOST = "https://x402.celo.org";
const DOMAIN = "x402.celo.org";
const WALLET_FILE = ".x402-wallet.json";
const rotate = process.argv.includes("--rotate");

// Byte-for-byte the messages the dashboard signs. A single character of drift
// changes the recovered address and the server rejects it.
const createMessage = (address, nonce) =>
  `${DOMAIN} wants you to create an x402 API key.

Address: ${address}
Nonce: ${nonce}

Signing this message proves you control this wallet. It costs no gas and sends no transaction.`;

const rotateMessage = (address, nonce) =>
  `${DOMAIN} wants you to regenerate your x402 API key.

Address: ${address}
Nonce: ${nonce}

This invalidates your previous key. Signing costs no gas and sends no transaction.`;

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body;
}

// Reuse the wallet if we already made one, so rotating does not orphan credits.
let privateKey = process.env.X402_KEY_WALLET;
if (!privateKey && existsSync(WALLET_FILE)) {
  privateKey = JSON.parse(readFileSync(WALLET_FILE, "utf8")).privateKey;
}
const fresh = !privateKey;
if (fresh) privateKey = generatePrivateKey();

const account = privateKeyToAccount(privateKey);
console.log(`wallet: ${account.address}${fresh ? " (newly generated)" : ""}`);

const { nonce } = await json(await fetch(`${HOST}/api/keys/nonce`));
console.log(`nonce:  ${nonce}`);

const message = (rotate ? rotateMessage : createMessage)(account.address, nonce);
const signature = await account.signMessage({ message });

const result = await json(
  await fetch(`${HOST}/api/keys${rotate ? "/rotate" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address, nonce, signature }),
  }),
);

if (fresh) {
  writeFileSync(WALLET_FILE, JSON.stringify({ address: account.address, privateKey }, null, 2));
  chmodSync(WALLET_FILE, 0o600);
  console.log(`saved wallet to ${WALLET_FILE} (mode 600)`);
}

console.log(`\napiKey:  ${result.apiKey}`);
console.log(`credits: ${JSON.stringify(result.balances)}`);

appendFileSync(".env.local", `\nX402_API_KEY=${result.apiKey}\n`);
console.log("\nappended X402_API_KEY to .env.local");
console.log("The key is shown once. Rotate with --rotate if it is ever lost.");
