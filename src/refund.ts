import { getAddress } from "viem";
import { CFG } from "./config.js";

/**
 * Settles a user's refund authorization through the facilitator.
 *
 * The session key holds USDC and never CELO, so it cannot send an ordinary
 * transfer — that reverts with "gas required exceeds allowance (0)". The only
 * way funds leave is the same EIP-3009 path the payments use, where the
 * facilitator submits the transaction and pays the gas.
 *
 * This must live on the server because settlement needs the metering API key,
 * which must never reach a browser.
 */
export async function settleRefund(signature: string, authorization: Record<string, string>) {
  // The user signed "move MY balance to THIS address". We never choose either,
  // so this cannot be turned into a way to move somebody else's money.
  const requirements = {
    scheme: "exact",
    network: CFG.caip,
    asset: getAddress(CFG.usdc),
    amount: authorization.value,
    payTo: getAddress(authorization.to),
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  };

  const res = await fetch(`${CFG.facilitator}/settle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": process.env.X402_API_KEY!,
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: {
        x402Version: 2,
        accepted: requirements,
        payload: { signature, authorization },
      },
      paymentRequirements: requirements,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.errorReason ?? body.invalidReason ?? `settle failed (${res.status})`);
  }
  return body.transaction ?? body.txHash ?? null;
}
