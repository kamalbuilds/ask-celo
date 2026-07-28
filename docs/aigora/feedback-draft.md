# [Feedback:bug] Every path returns HTTP 200 HTML, so the catalog never loads and agents cannot detect a real endpoint

- **Contact:** _(your email or @telegram - required, and public in the PR)_
- **CELO payout wallet:** `0xE626fC73E7FcE36a2371D7B4f3482Aed17308A77`
- **Aigora profile URL:** _(none yet: registration needs a wallet signature)_
- **Surface:** Agent discovery / catalog
- **Network:** Celo Sepolia _(the aigora-register skill documents Sepolia for registration)_

## What happened?

`aigora.org` serves the SPA shell with **HTTP 200 and `content-type: text/html`
for every path**, including paths that do not exist. The catalog on the homepage
renders `0 shown` / `Loading catalog…` indefinitely.

The two symptoms are the same bug. The page fetches its own catalog endpoint,
receives `200 text/html`, and has nothing to render, while the status code says
everything succeeded.

Measured from inside the page (Brave, DevTools console, after a full load):

```js
for (const p of ['/api/services','/api/agents','/api/catalog']) {
  const r = await fetch(p, { headers: { accept: 'application/json' } });
  console.log(p, r.status, r.headers.get('content-type'));
}
// /api/services  200 text/html; charset=utf-8
// /api/agents    200 text/html; charset=utf-8
// /api/catalog   200 text/html; charset=utf-8
```

## Why this matters more for an agent marketplace than for a normal site

A human sees a spinner and knows something is wrong. **An agent sees `200 OK`
and concludes the endpoint exists.** Aigora's own audience is agents, so this
failure mode is aimed exactly at the users it is built for.

Concretely, I checked `/.well-known/agent.json` and `/skill.md` while trying to
integrate. Both returned `200`. A naive check treats that as "the endpoint is
there" and moves on; only asserting the content type reveals all three are the
same HTML shell. Any agent doing capability discovery against Aigora right now
will mis-detect it.

This also cost real time downstream: I concluded from a `200` on `/skill.md`
that a documented `aigora-feedback` skill existed on the site, then could not
find it, and wrote the track off as not-yet-enterable. It exists, at
`trionlabs/aigora-skills`. The 200-for-everything behaviour is what made the
site an unreliable source of truth about itself.

## Steps to reproduce

```bash
# 1. A path that certainly does not exist still returns 200.
curl -s -o /dev/null -w '%{http_code}\n' https://aigora.org/zzz-nonexistent
# → 200

# 2. The documented agent-discovery paths return HTML, not JSON.
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://aigora.org/api/services
# → 200 text/html; charset=utf-8
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://aigora.org/.well-known/agent.json
# → 200 text/html; charset=utf-8

# 3. Load https://aigora.org/ in a browser and wait.
#    The catalog stays on "Loading catalog…" with "0 shown".
```

Reproduced twice, several hours apart, from two different network contexts.

## Suggested fix, in priority order

1. **Return `404` for unknown paths.** SPA history fallback should apply to app
   routes, not to `/api/*` or `/.well-known/*`. This is the whole bug: everything
   below is a consequence.
2. **Serve `/.well-known/agent.json` as real JSON**, or return `404` if there is
   nothing to serve yet. An honest 404 is far more useful to an agent than a 200
   that lies.
3. **Give the catalog a failure state.** `Loading catalog…` forever is
   indistinguishable from "still fetching". "Could not load the catalog" with a
   retry tells the truth and takes one branch.
4. **Consider `Content-Type` assertions in your own smoke tests.** A status-only
   healthcheck passes today while the catalog is empty, which is presumably why
   this has stayed live.

## Anything else

Found while evaluating Aigora for the Agentic Payments & DeFAI hackathon Track 4.
I wanted to register and file feedback; the site's own responses made it look
non-functional when the underlying service may be fine behind the routing.
