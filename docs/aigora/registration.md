# Aigora registration: every field, pre-validated

Registration needs your wallet (two signatures, Celo Sepolia, chainId `11142220`)
so it is yours to do. Everything else is prepared here and checked against
Aigora's validation rules, so it should be paste, sign, done.

Register at **<https://aigora.org>**, network toggle set to **Celo Sepolia**.
You need a little Sepolia CELO for gas: registration is two transactions.

## Fields

**Name**

```
Ask
```

**Description** (rule: 50 to 1024 characters, checked below)

```
Ask answers questions about money on Celo from live chain reads, and charges a
cent a question over x402. MiniPay implements neither personal_sign nor
eth_signTypedData, so its wallets cannot produce the EIP-3009 signature x402
settlement requires. Ask bridges that with a device-local session key: the user
makes one ordinary transfer they can read, and that key signs every payment
afterwards, with no seed phrase and no CELO needed for gas. Questions it cannot
answer are refused before payment, and questions about the service itself are
answered free, so nobody is ever charged for a non-answer. Answers come from the
Mento oracle and live gas reads: exchange rates, what a transfer really costs,
and how that compares with traditional remittance rails.
```

**Services** (rule: 1 to 7, public https, no private hosts)

| Type | Endpoint |
|---|---|
| Web | `https://ask-celo.vercel.app` |
| A2A | `https://ask-celo.vercel.app/api/ask` |

Both are public HTTPS on Vercel, so they pass the SSRF host gate. No MCP
endpoint, so the advisory MCP handshake does not apply.

**Image** (optional, https or ipfs)

```
https://ask-celo.vercel.app/icon.svg
```

Verified: the file exists at `web/public/icon.svg`, is copied into the build,
and is served once the pending deploy lands. It 404'd when this doc was first
written, which is how the missing favicon was found.

**Categories:** payments, DeFi, data/oracles (pick whichever Aigora actually offers).

**Skills** (rule: up to 16, unique names, name ≤32 chars, description ≤1000)

| Name | Description |
|---|---|
| `fx-rates` | Live exchange rates from Mento's on-chain SortedOracles median, the same source Celo settles stablecoin trades against. Covers USD, EUR, KES, COP and BRL. |
| `remittance-cost` | What sending a given amount actually costs on Celo, measured against the World Bank's Remittance Prices Worldwide average, including the cash-out cost most comparisons omit. |
| `x402-payments` | Answers paid per request over x402 on Celo mainnet, settled in USDC via EIP-3009. |
| `minipay-session-keys` | Explains and demonstrates the session-key pattern that lets a MiniPay wallet pay over x402 despite implementing no signing method. |

**External links** (up to 8)

| Platform | URL |
|---|---|
| GitHub | `https://github.com/kamalbuilds/ask-celo` |

## After registering

The profile URL is `https://aigora.org/services/<id>`. Put it in
`.submission.json` as `aigoraProfileUrl`, then:

```bash
node scripts/register.mjs draft   # picks it up and re-checks what is missing
```

It is an optional submission field, but it is also the Track 4 "allowlisted"
proof, and it costs one paste.
