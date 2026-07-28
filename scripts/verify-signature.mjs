#!/usr/bin/env node
/**
 * verify-signature.mjs — the thesis test, without needing funds.
 *
 * The product rests on one claim: a **session key** can produce an EIP-3009
 * authorization the Celo facilitator accepts. This matters because MiniPay
 * implements neither personal_sign nor eth_signTypedData, so the session key is
 * the only thing that can sign at all.
 *
 * Settling that authorization needs a funded wallet. But *validating* it does
 * not: the facilitator's /verify endpoint checks the signature and simulates the
 * transfer, is free, and needs no API key. So this isolates the real risk.
 *
 * Read the outcome like this:
 *   - "invalid signature" / recovery failure  → THESIS DEAD. A session key
 *     cannot pay, and no amount of funding fixes it.
 *   - "insufficient funds" or similar balance complaint → THESIS PROVEN. The
 *     signature was accepted and verification got all the way to the balance
 *     check. Only money is missing, which is a funding problem, not a design one.
 *
 *   node scripts/verify-signature.mjs
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";

// Imported, not restated: a private copy of this table is how gates.mjs came
// to check the wrong chain for a day.
const { CFG, NETWORK } = await import("../src/config.ts");

// A session key exactly as the Mini App generates one: created locally, never
// funded by anything but a transfer, holding no special status.
//
// It is persisted. An earlier version generated a throwaway key inline, which
// was fine for a signature check but meant that funding the printed address
// stranded the money: the key was gone the moment the process exited.
const KEY_FILE = ".session-test.json";
let sessionKey = process.env.SESSION_TEST_KEY;
if (!sessionKey && existsSync(KEY_FILE)) {
  sessionKey = JSON.parse(readFileSync(KEY_FILE, "utf8")).privateKey;
}
const generated = !sessionKey;
if (generated) sessionKey = generatePrivateKey();

const account = privateKeyToAccount(sessionKey);
if (generated) {
  writeFileSync(KEY_FILE, JSON.stringify({ address: account.address, privateKey: sessionKey }, null, 2));
  chmodSync(KEY_FILE, 0o600);
}
const payTo = getAddress(process.env.SELLER_PAY_TO || "0x000000000000000000000000000000000000dEaD");

console.log(`network:     ${NETWORK} (${CFG.caip})`);
console.log(`session key: ${account.address}${generated ? ` (new, saved to ${KEY_FILE})` : ""}`);
console.log(`payTo:       ${payTo}\n`);

const now = Math.floor(Date.now() / 1000);
const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;

const authorization = {
  from: account.address,
  to: payTo,
  value: "10000", // $0.01, 6 decimals
  validAfter: String(now - 60),
  validBefore: String(now + 3600),
  nonce,
};

// EIP-3009 transferWithAuthorization, the exact typed data x402's `exact`
// scheme signs. Celo USDC's EIP-712 domain is name "USDC", version "2".
const signature = await account.signTypedData({
  domain: {
    name: "USDC",
    version: "2",
    chainId: Number(CFG.caip.split(":")[1]),
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
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

console.log(`signed EIP-3009 authorization (${signature.slice(0, 20)}…)\n`);

// The v2 wire shape, taken from @x402/core's own types rather than guessed:
// PaymentRequirements is { scheme, network, asset, amount, payTo,
// maxTimeoutSeconds, extra } — note `amount`, not `maxAmountRequired`, which is
// the v1 field — and PaymentPayload carries the requirements again as `accepted`.
const requirements = {
  scheme: "exact",
  network: CFG.caip,
  asset: getAddress(CFG.usdc),
  amount: "10000",
  payTo,
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};

const payload = {
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    accepted: requirements,
    payload: { signature, authorization },
  },
  paymentRequirements: requirements,
};

const res = await fetch(`${CFG.facilitator}/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log(`/verify → HTTP ${res.status}`);
console.log(text.slice(0, 600));

const lower = text.toLowerCase();
const signatureRejected =
  lower.includes("invalid_signature") ||
  lower.includes("invalid signature") ||
  lower.includes("recover") ||
  lower.includes("invalid_scheme") ||
  lower.includes("malformed");
const balanceComplaint =
  lower.includes("insufficient") || lower.includes("funds") || lower.includes("balance");

console.log("\n" + "=".repeat(60));
if (signatureRejected) {
  console.log("THESIS DEAD: the facilitator rejected a session-key signature.");
  console.log("A device-generated key cannot pay, so the MiniPay bridge cannot work.");
  process.exit(1);
} else if (balanceComplaint) {
  console.log("THESIS PROVEN: the signature was accepted.");
  console.log("Verification reached the balance check, so the only thing missing");
  console.log("is funding. That is a top-up problem, not a design problem.");
} else if (lower.includes('"isvalid":true') || lower.includes('"valid":true')) {
  console.log("THESIS PROVEN: the facilitator validated the session-key payment outright.");
} else {
  console.log("INCONCLUSIVE — read the response above before trusting the design.");
  process.exit(2);
}
