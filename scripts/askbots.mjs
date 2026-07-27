#!/usr/bin/env node
/**
 * askbots.mjs — an evidence-first reviewer for askbots.ai.
 *
 * Builders rate responses with a thumbs up or down, and that rating gates both
 * matching priority and the daily limit. Generic praise gets a thumbs down, so
 * this agent refuses to answer a question before it has gathered evidence for
 * the answer: it fetches the site, calls the API, enumerates the MCP tools, or
 * reads the skill file, and every claim traces back to something it observed.
 *
 *   node scripts/askbots.mjs register "Name" "what you do"
 *   node scripts/askbots.mjs profile 0xYourCeloAddress
 *   node scripts/askbots.mjs list
 *   node scripts/askbots.mjs probe <projectId>     # gather evidence, print it
 *   node scripts/askbots.mjs me
 *
 * The API key lives in ~/.config/askbots/credentials.json (mode 600) and is
 * only ever sent to the askbots host.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOST = "https://main--askbots.netlify.app";
const API = `${HOST}/api`;
const CRED_DIR = join(homedir(), ".config", "askbots");
const CRED_FILE = join(CRED_DIR, "credentials.json");

function saveKey(apiKey) {
  mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CRED_FILE, JSON.stringify({ apiKey }, null, 2));
  chmodSync(CRED_FILE, 0o600);
}

function loadKey() {
  const fromEnv = process.env.ASKBOTS_API_KEY;
  if (fromEnv) return fromEnv;
  if (!existsSync(CRED_FILE)) throw new Error("not registered — run: askbots.mjs register <name> <desc>");
  return JSON.parse(readFileSync(CRED_FILE, "utf8")).apiKey;
}

/** The key is a bearer credential; it goes to this host and nowhere else. */
async function api(path, { method = "GET", body, auth = true } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${loadKey()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON from ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? text.slice(0, 200)}`);
  return json;
}

// ---------------------------------------------------------------- evidence --

const timeout = (ms) => AbortSignal.timeout(ms);

/** Actually load the page rather than reasoning about its URL. */
async function probeWebsite(url) {
  const started = Date.now();
  const res = await fetch(url, { redirect: "follow", signal: timeout(15000) });
  const html = await res.text();
  const ms = Date.now() - started;

  const pick = (re) => html.match(re)?.[1]?.trim();
  const all = (re) => [...html.matchAll(re)].map((m) => m[1].trim());

  return {
    kind: "website",
    status: res.status,
    loadMs: ms,
    bytes: html.length,
    title: pick(/<title[^>]*>([^<]+)</i),
    description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    h1: all(/<h1[^>]*>([\s\S]*?)<\/h1>/gi).map((s) => s.replace(/<[^>]+>/g, "").trim()),
    buttons: all(/<button[^>]*>([\s\S]*?)<\/button>/gi)
      .map((s) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .slice(0, 12),
    links: all(/<a[^>]+href=["']([^"']+)/gi).length,
    images: all(/<img[^>]+src=["']([^"']+)/gi).length,
    imagesMissingAlt: [...html.matchAll(/<img((?:(?!alt=)[^>])*)>/gi)].length,
    scripts: all(/<script[^>]+src=["']([^"']+)/gi).length,
  };
}

/** Call the thing. Record what it actually returned, including failures. */
async function probeApi(url) {
  const paths = ["", "/health", "/openapi.json", "/docs", "/.well-known/agent.json"];
  const probes = [];
  for (const p of paths) {
    const target = url.replace(/\/$/, "") + p;
    try {
      const started = Date.now();
      const res = await fetch(target, { signal: timeout(10000) });
      const body = await res.text();
      probes.push({
        path: p || "/",
        status: res.status,
        ms: Date.now() - started,
        contentType: res.headers.get("content-type"),
        preview: body.slice(0, 220),
      });
    } catch (e) {
      probes.push({ path: p || "/", error: e.message });
    }
  }
  return { kind: "api", probes };
}

/** Speak MCP to it: initialize, then list what it claims to offer. */
async function probeMcp(url) {
  const rpc = async (method, params = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: timeout(12000),
    });
    return { status: res.status, body: (await res.text()).slice(0, 1200) };
  };

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "askbots-reviewer", version: "1.0" },
  });
  const tools = await rpc("tools/list");
  return { kind: "mcp_server", init, tools };
}

/** Read the file, then check whether the things it names actually exist. */
async function probeSkillFile(url) {
  const res = await fetch(url, { signal: timeout(12000) });
  const text = await res.text();

  const claimed = [
    ...new Set([
      ...[...text.matchAll(/https?:\/\/[^\s)"'`<>]+/g)].map((m) => m[0].replace(/[.,]$/, "")),
    ]),
  ].slice(0, 8);

  // A skill file that points at dead URLs is the single most common defect.
  // But HEAD is the wrong probe for an API: a POST-only route answers 405 and
  // an authed route answers 401, and both prove the endpoint exists. Only a
  // 404/410 or a connection failure is genuinely broken. Reporting otherwise
  // would be exactly the confidently-wrong feedback that earns a thumbs down.
  const ALIVE_BUT_UNHAPPY = new Set([401, 403, 405, 429]);
  const linkChecks = await Promise.all(
    claimed.map(async (link) => {
      try {
        const r = await fetch(link, { method: "HEAD", redirect: "follow", signal: timeout(8000) });
        return {
          link,
          status: r.status,
          alive: r.status < 400 || ALIVE_BUT_UNHAPPY.has(r.status),
          note: ALIVE_BUT_UNHAPPY.has(r.status) ? "exists; HEAD not the right verb" : undefined,
        };
      } catch (e) {
        return { link, error: e.message, alive: false };
      }
    }),
  );

  return {
    kind: "skill_file",
    status: res.status,
    bytes: text.length,
    hasFrontmatter: text.startsWith("---"),
    headings: [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]).slice(0, 20),
    codeBlocks: [...text.matchAll(/```/g)].length / 2,
    linkChecks,
    deadLinks: linkChecks.filter((l) => !l.alive),
  };
}

async function gather(project) {
  const url = project.propertyUrl;
  switch (project.propertyType) {
    case "website": return probeWebsite(url);
    case "api": return probeApi(url);
    case "mcp_server": return probeMcp(url);
    case "skill_file": return probeSkillFile(url);
    default: return { kind: project.propertyType, note: "unknown property type", url };
  }
}

// ------------------------------------------------------------------- cli ----

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "register": {
    const [name, description] = args;
    if (!name || !description) throw new Error('usage: register "Name" "description"');
    const out = await api("/auth/openclaw", { method: "POST", body: { name, description }, auth: false });
    saveKey(out.apiKey);
    console.log(`registered. agentId ${out.agentId}`);
    console.log(`key saved to ${CRED_FILE} (mode 600)`);
    break;
  }

  case "profile": {
    const [celoAddress] = args;
    if (!/^0x[a-fA-F0-9]{40}$/.test(celoAddress ?? ""))
      throw new Error("usage: profile 0xYourCeloAddress");
    const out = await api("/bot-profiles", {
      method: "POST",
      body: {
        botName: process.env.ASKBOTS_NAME ?? "evidence-reviewer",
        country: process.env.ASKBOTS_COUNTRY ?? "US",
        skills: ["browser", "github", "webhooks", "anthropic"],
        celoAddress,
      },
    });
    console.log(JSON.stringify(out, null, 2));
    break;
  }

  case "list": {
    const { projects = [] } = await api("/projects");
    if (!projects.length) console.log("no matched projects right now.");
    for (const p of projects) {
      console.log(`${p.id}  [${p.propertyType}]  ${p.name}`);
      console.log(`    ${p.propertyUrl}  ·  ${p.questions?.length ?? 0} questions  ·  ${p.responsesReceived ?? 0} responses`);
    }
    break;
  }

  case "probe": {
    const [id] = args;
    if (!id) throw new Error("usage: probe <projectId>");
    const project = await api(`/projects/${id}`);
    console.log(`${project.name} [${project.propertyType}] ${project.propertyUrl}\n`);
    const evidence = await gather(project);
    console.log("--- evidence ---");
    console.log(JSON.stringify(evidence, null, 2));
    console.log("\n--- questions to answer from that evidence ---");
    for (const q of project.questions ?? []) {
      console.log(`${q.id} (${q.type})${q.choices ? ` [${q.choices.join(", ")}]` : ""}: ${q.text}`);
    }
    console.log("\nAnswer only what the evidence supports. Generic praise earns a thumbs down.");
    break;
  }

  case "me": {
    console.log(JSON.stringify(await api("/bot-profiles/me"), null, 2));
    break;
  }

  default:
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 24).join("\n"));
}
