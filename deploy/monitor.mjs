#!/usr/bin/env node
/**
 * Checks every live site in deploy/instances.json and raises or clears an alert.
 *
 *   node deploy/monitor.mjs            check, print a report, and on GitHub Actions open or close issues
 *
 * A site is up when /api/health?deep=1 answers ok with the database reachable, and the login
 * page loads. It's retried a few times before it counts as down, so a blip doesn't page anyone.
 *
 * On GitHub Actions (GITHUB_TOKEN and GITHUB_REPOSITORY set) a site going down opens an issue
 * labelled "outage", which emails everyone watching the repo, and recovery comments and closes
 * it. ALERT_WEBHOOK_URL, if set, also gets a JSON { text } post (Slack and Teams accept this).
 * See docs/MULTI_COUNTRY.md.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadInstances } from "./instances.mjs";

const TRIES = 3;
const GAP_MS = Number(process.env.MONITOR_GAP_MS ?? 20_000);
const TIMEOUT_MS = 15_000;

/** What a health answer means: up or not, and why. */
export function judge(status, body) {
  if (status !== 200) return { up: false, why: `health check answered ${status}` };
  if (!body || body.ok !== true) return { up: false, why: "health check didn't say ok" };
  if (body.checks && body.checks.database === false) return { up: false, why: "the database isn't reachable" };
  if (body.checks && body.checks.files === false) return { up: false, why: "file storage isn't connected" };
  return { up: true, why: null };
}

async function get(url, fetchImpl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "user-agent": "saralix-monitor" } });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/** One site: up or down, with the version it runs and how long the health check took. */
export async function checkSite(site, { fetchImpl = fetch, tries = TRIES, gapMs = GAP_MS } = {}) {
  let last = { up: false, why: "not checked" };
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, gapMs));
    try {
      const h = await get(`${site.url}/api/health?deep=1`, fetchImpl);
      let body = null;
      try {
        body = JSON.parse(h.text);
      } catch {
        /* not JSON */
      }
      last = { ...judge(h.status, body), ms: h.ms, version: body?.version ?? null, migrations: body?.migrations ?? null };
      if (last.up) {
        const login = await get(`${site.url}/login`, fetchImpl);
        if (login.status !== 200 || !login.text.includes('id="root"')) last = { ...last, up: false, why: `the login page answered ${login.status}` };
      }
      if (last.up) return { ...site, ...last, tries: i + 1 };
    } catch (e) {
      last = { up: false, why: e.name === "AbortError" ? `no answer in ${TIMEOUT_MS / 1000} seconds` : `couldn't connect (${e.message})` };
    }
  }
  return { ...site, ...last, tries };
}

/** Live sites on different versions, worth knowing after a rollout that stopped part way. */
export function versionDrift(results) {
  const versions = [...new Set(results.filter((r) => r.up && r.version).map((r) => r.version))];
  return versions.length > 1 ? versions : null;
}

// ---- GitHub issues ----
async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "saralix-monitor" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function notify(text) {
  if (!process.env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(process.env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  } catch (e) {
    console.error("alert webhook failed", e.message);
  }
}

async function syncIssues(results) {
  const open = await gh("GET", "/issues?state=open&labels=outage&per_page=100");
  for (const r of results) {
    const label = `site:${r.key}`;
    const issue = open.find((i) => i.labels.some((l) => (l.name ?? l) === label));
    const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    if (!r.up && !issue) {
      const body = [`**${r.name}** (${r.url}) is down: ${r.why}.`, "", `First seen at ${when} after ${r.tries} tries.`, "", "Check the Worker logs (Cloudflare › Workers & Pages › the site's Worker › Logs) and the database provider's status. If a deploy caused it, run **Rollback** for this site.", "", "This issue closes itself when the site is back."].join("\n");
      await gh("POST", "/issues", { title: `Outage: ${r.name} is down`, body, labels: ["outage", label] });
      await notify(`🔴 ${r.name} is down: ${r.why}. ${r.url}`);
      console.log(`opened an outage issue for ${r.key}`);
    } else if (r.up && issue) {
      await gh("POST", `/issues/${issue.number}/comments`, { body: `Back up at ${when}. Health check took ${r.ms} ms, version ${r.version}.` });
      await gh("PATCH", `/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
      await notify(`🟢 ${r.name} is back up. ${r.url}`);
      console.log(`closed outage issue #${issue.number} for ${r.key}`);
    }
  }
}

async function main() {
  const sites = loadInstances()
    .filter((x) => x.status === "live")
    .map((x) => ({ key: x.key, name: x.name, url: x.domain ? `https://${x.domain}` : null }));
  const results = [];
  for (const s of sites) {
    if (!s.url) {
      console.log(`- ${s.name}: no domain in deploy/instances.json, skipped`);
      continue;
    }
    results.push(await checkSite(s));
  }
  const drift = versionDrift(results);
  const lines = ["### Site health", "", "| Site | Status | Version | Health check |", "| --- | --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.name} | ${r.up ? "🟢 Up" : `🔴 Down: ${r.why}`} | ${r.version ?? "?"} | ${r.ms ? `${r.ms} ms` : "?"} |`);
  if (drift) lines.push("", `⚠️ Sites are running different versions: ${drift.join(", ")}. A rollout may have stopped part way.`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (drift && process.env.GITHUB_ACTIONS) console.log(`::warning::Sites are running different versions: ${drift.join(", ")}`);
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) await syncIssues(results);
  if (results.some((r) => !r.up)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
