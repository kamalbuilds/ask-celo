# Side tracks — status

Two of the four tracks are independent of the main build. Notes from actually
probing them rather than reading their marketing.

## Askbots

**Status: registered, blocked on a payout address.**

- Registered: `agentId kn7731zcr17zcmnhq3ezkwym898bawtq`, key at
  `~/.config/askbots/credentials.json` (mode 600).
- `GET /projects` returns nothing and `GET /bot-profiles/me` returns
  `404 Bot profile not found`. Matching only starts once a bot profile exists,
  and the profile requires a **Celo address to be paid to**:

  ```bash
  npm run askbots -- profile 0xYourCeloAddress
  ```

- Tool is built and verified: `npm run askbots -- probe <projectId>` gathers
  real evidence per property type (page load, API path sweep, MCP
  `initialize` + `tools/list`, skill-file link checking) and prints it next to
  the questions, so no answer is written before the evidence for it exists.

- Rate limits make early quality decisive: a new bot is capped at 3 responses a
  day and 2 unanswered assignments until it earns its first rating. Ratings
  below 0.4 drop the cap to 1 a day. There is no way to grind past a bad start,
  so the first few responses matter more than the next fifty.

**A note on the payout address.** Payouts land at whatever address is in the
profile, so it should be a wallet whose key you hold. This is a good use for a
fresh throwaway rather than a main wallet.

## Aigora

**Status: not yet enterable. Prelaunch.**

The track asks for an Aigora profile URL (`aigora.org/services/<id>`) plus a
GitHub issue filed through an `aigora-feedback` skill. Probing the live site:

- The homepage self-describes as **`PRELAUNCH · CELO · ERC-8004`** and the
  agent catalog renders `0 shown` / `Loading catalog…` with no entries.
- `aigora.org` is a single-page app that returns **HTTP 200 with an HTML shell
  for every path**, including `/skill.md`, `/api/skill` and
  `/.well-known/agent.json`. A naive check reads those 200s as "the endpoint
  exists"; asserting the content type shows they are all just the SPA.
- No `aigora-feedback` skill is published anywhere I can reach, and no
  repository under that name exists on GitHub.

So the entry path for this track is not open yet. The sensible move is to
re-probe closer to the deadline rather than invent a submission against an
endpoint that does not exist.

Re-check with:

```bash
curl -s https://aigora.org/api/services -H 'accept: application/json' | head -c 300
```

If that ever returns JSON rather than an HTML shell, the catalog is live and
the track is enterable.
