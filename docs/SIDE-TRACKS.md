# Side tracks — status

Two of the four tracks are independent of the main build. Notes from actually
probing them rather than reading their marketing.

## Askbots

**Status: fully registered and waiting on supply.**

- Agent `kn7731zcr17zcmnhq3ezkwym898bawtq`, profile
  `jx74xff4p6gehkcargzwc3y9e58bayrw`, rating 0.5, payouts to
  `0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77`. Key at
  `~/.config/askbots/credentials.json` (mode 600).
- `GET /projects` returns `{"projects":[]}`. The platform itself shows 380 bot
  responses and $6 paid out, so it is live, but nothing is open to claim at the
  moment. Poll with `npm run askbots -- list`.
- The profile appears immutable after creation: `POST` returns "profile already
  exists" and `PUT`/`PATCH` return empty without changing the stored skills. So
  the skill set chosen at creation is the one that determines matching.

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

Re-probed later the same day. The catalog still renders `Loading catalog…`
with nothing in it, and `/api/services` still returns the SPA shell rather
than JSON. What did resolve: a **Register your agent** button exists and leads
to "Sign in to continue — registering and managing your agents needs a
connected wallet."

So the track is enterable in principle, gated on a wallet signature. Two things
still block a real entry:

1. **It needs your wallet.** Registration is a signature, not a transaction, but
   it creates an identity under your name, so it is yours to do rather than
   mine.
2. **The `aigora-feedback` skill does not exist.** The track requires feedback
   filed through it, and it is published nowhere reachable — not on aigora.org,
   not on GitHub (`total_count: 0`). Without it there is no defined way to
   submit, whatever the profile says.

**Corrected Jul 28.** That read was wrong, and the cause is instructive: I
searched GitHub for `aigora-feedback` and got `total_count: 0`, so I concluded
the skill did not exist. It does. The repo is **`trionlabs/aigora-skills`**, and
it contains both `skills/aigora-feedback` and `skills/aigora-register`. I had
searched for the skill name instead of reading the hackathon FAQ, which names
the repo directly.

So Track 4 is enterable:

1. `skills/aigora-register` registers an agent on Celo Sepolia and yields the
   `aigora.org/services/<id>` profile URL.
2. `skills/aigora-feedback` opens a PR into `feedback/` on that repo. **The PR
   link is the submission artifact** (`aigoraFeedbackIssueUrl`), and maintainers
   judge the top 10 most valuable for the CELO prize.

A draft report is written and evidence-backed at `docs/aigora/feedback-draft.md`
covering a real, reproducible bug: every path on aigora.org returns HTTP 200 with
the HTML shell, so the catalog never loads and agents cannot detect a real
endpoint. Reproduced twice, hours apart, and confirmed from inside the page.

It needs one thing only I cannot supply: a **contact** (email or Telegram),
which the form requires and which is public in the PR. Add it, then open the PR
with `gh`.

Re-check with:

```bash
curl -s https://aigora.org/api/services -H 'accept: application/json' | head -c 300
```

If that ever returns JSON rather than an HTML shell, the catalog is live and
the track is enterable.
