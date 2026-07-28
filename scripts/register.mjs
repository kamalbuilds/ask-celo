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
 *   node scripts/register.mjs draft                 # fills every field, says what is missing
 *   node scripts/register.mjs submit                # publishes the entry
 *   node scripts/register.mjs status                # shows the current draft
 *
 * Registering is not entering. Registration saves a draft and returns the
 * attribution tag; publishing is a separate call, and without it the project
 * is not in the hackathon at all.
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
  if (!existsSync(AUTH_FILE)) {
    console.error("Not connected yet. Run this first:\n");
    console.error("  TELEGRAM_HANDLE=@yourhandle node scripts/register.mjs start\n");
    console.error("It prints a Google sign-in link; paste the short code back with:");
    console.error("  node scripts/register.mjs claim CELO-XXXX-0000");
    process.exit(1);
  }
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

    // Check this BEFORE spending the claim code. A claim code is single-use, so
    // failing after redeeming it would mean signing in through Google again for
    // a value we could have demanded up front.
    const telegram = process.env.TELEGRAM_HANDLE ?? state.telegram;
    if (!telegram) {
      throw new Error(
        "TELEGRAM_HANDLE not set. Re-run as:\n" +
          "  TELEGRAM_HANDLE=@yourhandle npm run register -- claim " + arg,
      );
    }
    if (!/^@?[a-zA-Z0-9_]{5,32}$/.test(telegram)) {
      throw new Error(`"${telegram}" is not a valid Telegram handle (5-32 chars, letters/digits/_)`);
    }

    const out = await api("/auth/google/claim", { method: "POST", body: { claimCode: arg } });
    const connection = out.connection ?? out.token ?? out.accessToken;
    if (!connection) throw new Error(`no connection token in response: ${JSON.stringify(out).slice(0, 200)}`);

    writeFileSync(AUTH_FILE, JSON.stringify({ connection }, null, 2));
    chmodSync(AUTH_FILE, 0o600);
    console.log(`connected, token saved to ${AUTH_FILE}`);

    // Save the registration draft immediately. The response carries the
    // attribution tag, and that is the whole reason to register early.
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

  // Fill every field the organizers configure, from .submission.json, then
  // publish. Registration alone does not enter the hackathon: publishing does,
  // and it is a separate call that nothing here could make until now.
  case "draft":
  case "submit": {
    const token = auth();
    const fields = await api(`/hackathons/${HACKATHON}/submission-fields`);
    const spec = Array.isArray(fields) ? fields : (fields.submissionFields ?? fields.fields ?? []);

    // Only send keys the hackathon configures. Anything else is a 400.
    const customFields = {};
    const missing = [];
    for (const f of spec) {
      const value = state[f.key];
      if (value) customFields[f.key] = value;
      else if (f.required) missing.push(`${f.key} (${f.label})`);
    }
    // socialLink is the documented exception: it goes top-level, not in
    // customFields.
    delete customFields.socialLink;

    const body = {
      projectName: "Ask",
      tagline: "Pay a cent a question, settled over x402 on Celo.",
      description:
        "MiniPay implements neither personal_sign nor eth_signTypedData, so its wallets " +
        "cannot produce the EIP-3009 signature x402 settlement requires. Ask bridges that " +
        "with a device-local session key: the user makes one ordinary transfer they can " +
        "read, and that key signs every payment afterwards. Questions are answered from " +
        "live Celo chain reads, and a question we cannot answer is refused before payment.",
      trackIds: ["most-x402-payments", "most-revenue-generated"],
      githubUrl: "https://github.com/kamalbuilds/ask-celo",
      demoUrl: state.liveUrl,
      celoNetwork: state.celoNetwork,
      agentContributionNotes:
        "Written end to end by a coding agent: research, implementation, tests, " +
        "on-chain verification and this submission.",
      customFields,
      ...(state.socialLink ? { socialLink: state.socialLink } : {}),
      ...(state.contractAddress ? { contractAddresses: [state.contractAddress] } : {}),
    };

    const saved = await api("/submissions/me", { method: "PUT", token, body });
    console.log(`draft saved: ${saved.projectName ?? "Ask"}`);
    if (saved.attributionTag && saved.attributionTag !== state.attributionTag) {
      state.attributionTag = saved.attributionTag;
      saveState();
      console.log(`attributionTag: ${saved.attributionTag}`);
    }

    if (missing.length) {
      console.log("\nnot publishable yet, still required:");
      missing.forEach((m) => console.log(`  - ${m}`));
      console.log("\nFill them in .submission.json and re-run.");
      break;
    }
    if (cmd === "draft") {
      console.log("\nAll required fields present. Publish with:");
      console.log("  node scripts/register.mjs submit");
      break;
    }

    const out = await api("/submissions/me/publish", {
      method: "POST",
      token,
      body: { confirm: true },
    });
    console.log(`\npublished: ${JSON.stringify(out).slice(0, 200)}`);
    break;
  }

  case "status": {
    console.log(JSON.stringify(await api("/submissions/me", { token: auth() }), null, 2));
    break;
  }

  default:
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 19).join("\n"));
}
