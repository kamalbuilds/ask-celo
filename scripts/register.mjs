#!/usr/bin/env node
/**
 * register.mjs — finish celobuilders registration and lock the attribution tag.
 *
 * The sign-in is Google OAuth, which only the human can complete. Everything
 * either side of it is automated here, so the manual part is: open a link,
 * sign in, paste back a short code.
 *
 *   node scripts/register.mjs start                 # prints the sign-in link
 *   node scripts/register.mjs claim CELO-ABCD-2345  # finishes, saves the tag
 *   node scripts/register.mjs status                # shows the current draft
 *
 * The claim step saves the connection token to .celobuilders.json and writes
 * the returned attributionTag into .submission.json, because that tag is the
 * one thing that cannot be backfilled: Track 1 credits only tagged
 * transactions, so every untagged hour is volume lost for good.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

const HOST = "https://celobuilders.xyz";
const HACKATHON = "agentic-payments-defai";
const AUTH_FILE = ".celobuilders.json";
const STATE_FILE = ".submission.json";

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

const auth = () => {
  if (!existsSync(AUTH_FILE)) throw new Error("not connected — run: register.mjs start");
  return JSON.parse(readFileSync(AUTH_FILE, "utf8")).connection;
};

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? json.message ?? text.slice(0, 200)}`);
  return json;
}

const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case "start": {
    const telegram = process.env.TELEGRAM_HANDLE ?? state.telegram;
    if (!telegram) {
      console.log("Set TELEGRAM_HANDLE first — it is required at registration.");
      console.log("  TELEGRAM_HANDLE=@yourhandle node scripts/register.mjs start\n");
    }
    const out = await api("/auth/google/start", {
      method: "POST",
      body: {
        hackathonId: HACKATHON,
        human: {
          name: process.env.BUILDER_NAME ?? "Kamal",
          email: process.env.BUILDER_EMAIL ?? "geniusamansingh@gmail.com",
          social: process.env.BUILDER_SOCIAL ?? "@kamalbuilds",
          teamName: "Ask",
        },
        agent: { name: "Jcode", harness: "jcode", model: "claude-opus" },
      },
    });
    console.log("Open this, sign in, then copy the short code it shows:\n");
    console.log(out.authorizeUrl);
    console.log(`\nExpires ${out.expiresAt}. Then run:`);
    console.log("  node scripts/register.mjs claim CELO-XXXX-0000");
    break;
  }

  case "claim": {
    if (!arg) throw new Error("usage: register.mjs claim CELO-XXXX-0000");
    const out = await api("/auth/google/claim", { method: "POST", body: { claimCode: arg } });
    const connection = out.connection ?? out.token ?? out.accessToken;
    if (!connection) throw new Error(`no connection token in response: ${JSON.stringify(out).slice(0, 200)}`);

    writeFileSync(AUTH_FILE, JSON.stringify({ connection }, null, 2));
    chmodSync(AUTH_FILE, 0o600);
    console.log(`connected, token saved to ${AUTH_FILE}`);

    // Save the registration draft immediately. The response carries the
    // attribution tag, and that is the whole reason to register early.
    const telegram = process.env.TELEGRAM_HANDLE ?? state.telegram;
    if (!telegram) throw new Error("TELEGRAM_HANDLE not set — required to register");

    const saved = await api("/submissions/me", {
      method: "PUT",
      token: connection,
      body: {
        projectName: "Ask",
        githubUrl: "https://github.com/kamalbuilds/ask-celo",
        trackIds: ["most-x402-payments", "most-revenue-generated"],
        customFields: {
          telegram,
          agentWalletAddress: state.agentWalletAddress,
        },
      },
    });

    const tag = saved.attributionTag;
    if (!tag) throw new Error(`no attributionTag returned: ${JSON.stringify(saved).slice(0, 300)}`);

    state.attributionTag = tag;
    state.telegram = telegram;
    saveState();

    console.log(`\nattributionTag: ${tag}`);
    console.log("Written to .submission.json. Add it to the deployment as ATTRIBUTION_TAG");
    console.log("so every receipt carries it — only this exact code is credited.");
    break;
  }

  case "status": {
    console.log(JSON.stringify(await api("/submissions/me", { token: auth() }), null, 2));
    break;
  }

  default:
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 19).join("\n"));
}
