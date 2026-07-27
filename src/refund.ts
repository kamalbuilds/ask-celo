import { getAddress, createPublicClient, http, erc20Abi } from "viem";
import { CFG } from "./config.js";

/** Refunds are small by construction: a session key is a coin purse. */
const MAX_REFUND_MICROS = 50_000_000n; // $50

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
 *
 * Note what this endpoint is: we spend our own prepaid facilitator credits to
 * move somebody else's money. That is correct for our users and wrong for
 * anyone else, so it is bounded rather than open. It cannot steal — the payer
 * signed the authorization themselves — but without limits it is a free
 * settlement service that drains our credits.
 */
export async function settleRefund(signature: string, authorization: Record<string, string>) {
  const from = getAddress(authorization.from);
  const to = getAddress(authorization.to);
  const value = BigInt(authorization.value);

  if (from === to) throw new Error("refund to the same address is a no-op");
  if (value <= 0n) throw new Error("refund amount must be positive");
  if (value > MAX_REFUND_MICROS) throw new Error("refund exceeds the session limit");

  // Refund exactly what the key holds. Anything else is either a partial
  // sweep that strands the rest, or somebody using us to settle unrelated
  // transfers at our expense.
  const pub = createPublicClient({ chain: CFG.chain, transport: http(CFG.rpc) });
  const balance = await pub.readContract({
    address: getAddress(CFG.usdc),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [from],
  });
  if (value !== balance) throw new Error("refund must move the full balance");

  // The user signed "move MY balance to THIS address". We never choose either,
  // so this cannot be turned into a way to move somebody else's money.
  const requirements = {
    scheme: "exact",
    network: CFG.caip,
    asset: getAddress(CFG.usdc),
    amount: authorization.value,
    payTo: to,
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
