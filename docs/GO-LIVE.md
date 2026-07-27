# Going live on mainnet — what it costs and what it unlocks

Everything is built and proven on testnet. Mainnet needs gas, and that is the
only remaining gap.

## Fund this address

```
0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77
```

This is the agent wallet and the `payTo` for every x402 settlement. It already
holds the facilitator API key's credits (500 mainnet settlements prepaid).

| What | Gas | Cost at 202.5 gwei |
|---|---|---|
| Deploy `AskReceipts` | ~600k | ~0.12 CELO |
| Mint ERC-8004 identity | ~250k | ~0.05 CELO |
| Tagged transactions (headroom) | — | ~0.3 CELO |
| **Total** | | **~0.5 CELO** (about $0.03) |

Plus a few dollars of **mainnet USDC** at the same address if you want the agent
to make real settlements itself rather than only receive them.

## Then this runs unattended

```bash
cd app
export X402_NETWORK=mainnet
export DEPLOYER_KEY=<key for the funded address>
export CELOSCAN_API_KEY=<for source verification>

npm run deploy -- mainnet        # deploys + verifies + re-reads state from chain
npm run register:8004            # mints the agent identity, prints the 8004scan URL
npm run score                    # confirms what moved
```

`deploy.sh` does not trust its own output: it re-reads the bytecode from the
chain and calls `recorder()` to confirm the constructor argument landed.

## What each deadline still needs

**Proof of Ship** (project page at talent.app)

- [x] Public GitHub repo, syncing
- [x] Live app URL, verified by meta tag
- [x] Description and category
- [ ] **Verified contract on Celo mainnet** ← the only gap, needs the gas above

**Hackathon** (Aug 3, 09:00 GMT)

| Field | Status |
|---|---|
| `agentWalletAddress` | `0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77` |
| `celoNetwork` | `celo-mainnet` |
| `erc8004Url` | needs the mint above |
| `telegram` | **needs your handle** |
| `socialLink` | needs a published X post |

Registration itself is one Google sign-in at `celobuilders.xyz` — that returns
the attribution tag, which is the thing that cannot be backfilled. Track 1 only
credits tagged transactions, so untagged mainnet volume is lost permanently.

## Already proven, no further risk

- A session key signs EIP-3009 and the Celo facilitator settles it:
  `0x5f1ebe4ccc2a44454c7322e864e1892d06704e2d1cea06ee02cda2e3dc99e503`
  (through the deployed production URL, not a local server).
- Payment ordering is safe: the middleware verifies, runs the handler, and
  cancels settlement if the handler fails. Confirmed on-chain when an upstream
  errored — the request failed and no funds moved.
- The attribution tag survives calldata concatenation, asserted by tests rather
  than assumed.

Switching to mainnet is a config change, not new code: `X402_NETWORK=mainnet`
selects the mainnet facilitator, USDC address, and registry in one place.
