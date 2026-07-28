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

/**
 * Turn the two auth failures into instructions.
 *
 * The organisers' own error guide says 401/403 means reconnect. A connection
 * token sitting in .celobuilders.json from an earlier session is the normal
 * way to hit that, and a stack trace does not say "run start again".
 */
function explainAuth(err) {
  const why = String(err.message ?? err);
  if (/^40[13]\b/.test(why)) {
    console.error(`Your connection is no longer valid: ${why}\n`);
    console.error("Reconnect (the sign-in link is fresh each time):");
    console.error("  TELEGRAM_HANDLE=@yourhandle npm run register");
    console.error("\nThe stale token is in .celobuilders.json; delete it if this repeats.");
    process.exit(1);
  }
  throw err;
}

/** api(), with the two auth failures turned into instructions. */
const apiOrExplain = (path, opts) => api(path, opts).catch(explainAuth);

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
    const telegram = process.env.TELEGRAM_HANDLE || state.telegram;
    if (!telegram) {
      console.log("Set TELEGRAM_HANDLE first — it is required at registration.");
      console.log("  TELEGRAM_HANDLE=@yourhandle node scripts/register.mjs start\n");
    }
    const out = await api("/auth/google/start", {
      method: "POST",
      body: {
        hackathonId: HACKATHON,
        human: {
          name: process.env.BUILDER_NAME || "Kamal",
          email: process.env.BUILDER_EMAIL || "geniusamansingh@gmail.com",
          social: process.env.BUILDER_SOCIAL || "@kamalbuilds",
          teamName: "Ask",
        },
        agent: { name: "Jcode", harness: "jcode", model: "claude-opus" },
      },
    });
    console.log("Sign in, then copy the short code it shows:\n");
    console.log(out.authorizeUrl);

    // Open it. The link expires in minutes and the next step is blocked on a
    // human reading it, so saving a copy-paste is worth more here than
    // anywhere else in the flow. Failing to open is not an error: the URL is
    // already printed above.
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(opener, [out.authorizeUrl], { stdio: "ignore", timeout: 5000 });
      console.log("\n(opened in your browser)");
    } catch {
      // Headless, or no opener. The link above still works.
    }

    console.log(`\nExpires ${out.expiresAt}. Then run:`);
    console.log("  npm run register -- claim CELO-XXXX-0000");
    break;
  }

  case "claim": {
    if (!arg) throw new Error("usage: register.mjs claim CELO-XXXX-0000");

    // Check this BEFORE spending the claim code. A claim code is single-use, so
    // failing after redeeming it would mean signing in through Google again for
    // a value we could have demanded up front.
    const telegram = process.env.TELEGRAM_HANDLE || state.telegram;
    if (!telegram) {
      throw new Error(
        "TELEGRAM_HANDLE not set. Re-run as:\n" +
          "  TELEGRAM_HANDLE=@yourhandle npm run register -- claim " + arg,
      );
    }
    if (!/^@?[a-zA-Z0-9_]{5,32}$/.test(telegram)) {
      throw new Error(`"${telegram}" is not a valid Telegram handle (5-32 chars, letters/digits/_)`);
    }

    const out = await api("/auth/google/claim", {
      method: "POST",
      body: { claimCode: arg },
    }).catch((err) => {
      // The likeliest failure in the whole flow: a mistyped or stale code.
      // Codes are single-use and short-lived, so the fix is always the same
      // and a stack trace does not say it.
      const why = String(err.message ?? err);
      if (/not found|expired|invalid/i.test(why)) {
        console.error(`That claim code did not work: ${why}\n`);
        console.error("Codes are single-use and expire in about 15 minutes. Start again:");
        console.error(`  TELEGRAM_HANDLE=${telegram} npm run register`);
        process.exit(1);
      }
      throw err;
    });
    const connection = out.connection ?? out.token ?? out.accessToken;
    if (!connection) throw new Error(`no connection token in response: ${JSON.stringify(out).slice(0, 200)}`);

    writeFileSync(AUTH_FILE, JSON.stringify({ connection }, null, 2));
    chmodSync(AUTH_FILE, 0o600);
    console.log(`connected, token saved to ${AUTH_FILE}`);

    // Save the registration draft immediately. The response carries the
    // attribution tag, and that is the whole reason to register early.
    const saved = await apiOrExplain("/submissions/me", {
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
    if (!tag) {
      // The token is already saved, so the single-use OAuth code is not
      // wasted: the draft can be retried without signing in again. Say that,
      // because the natural response to a failure here is to start over and
      // burn another code.
      console.error("Connected, but no attributionTag came back.\n");
      console.error("The connection is saved, so do NOT sign in again. Retry with:");
      console.error("  node scripts/register.mjs draft\n");
      console.error(`Response was: ${JSON.stringify(saved).slice(0, 200)}`);
      process.exit(1);
    }

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
    const fields = await api(`/hackathons/${HACKATHON}/submission-fields`).catch(explainAuth);
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

    const saved = await api("/submissions/me", { method: "PUT", token, body }).catch(explainAuth);
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

    const out = await apiOrExplain("/submissions/me/publish", {
      method: "POST",
      token,
      body: { confirm: true },
    });
    console.log(`\npublished: ${JSON.stringify(out).slice(0, 200)}`);
    break;
  }

  case "status": {
    const me = await api("/submissions/me", { token: auth() }).catch(explainAuth);
    console.log(JSON.stringify(me, null, 2));
    break;
  }

  default:
    // `npm run register` is what STATUS.md tells the user to run. Printing
    // help there means the documented command does nothing, so an absent
    // subcommand starts the flow. An unrecognised one still shows usage.
    if (!cmd) {
      console.log("Starting registration. This is `register.mjs start`.\n");
      process.argv[2] = "start";
      await import(import.meta.url + `?again=${Date.now()}`);
      break;
    }
    console.log(`unknown command: ${cmd}\n`);
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 19).join("\n"));
}
