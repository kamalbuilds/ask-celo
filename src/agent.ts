/**
 * The ERC-8004 agent document.
 *
 * Two copies of this existed: one built by scripts/register-8004.mjs for the
 * mint, one served at /agent.json as the fallback URI. They agreed, and
 * nothing kept them agreeing — which is the same shape as the price in seven
 * places and the network table in four files.
 *
 * They must be identical: the registry points at the served URI, so a drift
 * means the on-chain identity describes something the service does not.
 */
export function agentDocument(domain: string) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Ask",
    description:
      "Answers questions for a cent each, paid over x402 on Celo. Brings MiniPay " +
      "wallets onto x402 with a device-local session key, since MiniPay implements " +
      "neither personal_sign nor eth_signTypedData and cannot sign EIP-3009 directly.",
    services: [
      { name: "web", endpoint: domain },
      { name: "x402", endpoint: `${domain}/api/ask`, version: "2" },
    ],
    supportedTrust: ["reputation"],
  };
}
