#!/usr/bin/env node
/**
 * Restore drill for one site: prove the database can be restored, then clean up.
 *
 *   NEON_API_KEY, NEON_PROJECT_ID    the site's Neon project (an API key with access to it)
 *   DATABASE_URL                     the live database, to compare against (read only queries)
 *   RESTORE_HOURS_AGO                how far back to restore (default 1)
 *
 *   node deploy/restore-drill.mjs
 *
 * 1. Asks Neon for a new branch of the database as it was RESTORE_HOURS_AGO hours ago.
 * 2. Connects to it and checks it's a real Saralix database: migrations, companies, employees.
 * 3. Compares row counts with the live database (the restore can't have more than live,
 *    and shouldn't be empty when live isn't).
 * 4. Deletes the branch, whatever happened.
 *
 * Only counts are read, and the copy stays inside Neon in the site's region, so no personal
 * data leaves it. Uses psql (installed on GitHub's Ubuntu runners). See docs/MULTI_COUNTRY.md.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://console.neon.tech/api/v2";
const TABLES = ["tenants", "employees", "payroll_runs", "attendance_records", "audit_logs"];

async function neon(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.NEON_API_KEY}`, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Run one query with psql and return the first column of each row. */
function query(url, sql) {
  const out = execFileSync("psql", [url, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").filter(Boolean);
}

/** Counts that must be there for this to be a usable copy. */
export function countsSql() {
  return `select ${["(select count(*) from drizzle.__drizzle_migrations)", ...TABLES.map((t) => `(select count(*) from public.${t})`)].join(" || ',' || ")}`;
}
export function parseCounts(line) {
  const [migrations, ...rest] = line.split(",").map(Number);
  return { migrations, ...Object.fromEntries(TABLES.map((t, i) => [t, rest[i]])) };
}

/** Problems with a restored copy compared with live. Empty means the drill passed. */
export function compare(restored, live) {
  const problems = [];
  if (!restored.migrations) problems.push("the restored copy has no migrations table");
  if (restored.migrations > live.migrations) problems.push(`the restored copy has more migrations (${restored.migrations}) than live (${live.migrations})`);
  for (const t of TABLES) {
    if (live[t] > 0 && !restored[t]) problems.push(`${t} is empty in the restored copy but has ${live[t]} rows live`);
    // a copy from the past can have fewer rows, but a big gap means something's wrong
    if (live[t] >= 100 && restored[t] < live[t] * 0.5) problems.push(`${t} has ${restored[t]} rows in the restored copy against ${live[t]} live`);
  }
  return problems;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { NEON_API_KEY, NEON_PROJECT_ID, DATABASE_URL } = process.env;
  const site = process.env.SITE_NAME ?? "this site";
  if (!NEON_API_KEY || !NEON_PROJECT_ID) {
    console.log(`::notice::Skipped the restore drill for ${site}: add NEON_API_KEY and NEON_PROJECT_ID to its GitHub environment. For a database that isn't on Neon, follow the manual drill in docs/MULTI_COUNTRY.md.`);
    return;
  }
  if (!DATABASE_URL) throw new Error("DATABASE_URL (the live database) is required to compare against");
  const hours = Number(process.env.RESTORE_HOURS_AGO ?? 1);
  const at = new Date(Date.now() - hours * 3_600_000);
  const started = Date.now();
  const name = `restore-drill-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

  console.log(`Restoring ${site} as it was at ${at.toISOString()} into branch ${name}`);
  const created = await neon("POST", `/projects/${NEON_PROJECT_ID}/branches`, { branch: { name, parent_timestamp: at.toISOString() }, endpoints: [{ type: "read_write" }] });
  const branchId = created.branch.id;
  let problems = [];
  let restored = null;
  let live = null;
  try {
    const uri = created.connection_uris?.[0]?.connection_uri;
    if (!uri) throw new Error("Neon didn't return a connection string for the restored branch");
    // keep the temporary branch's password out of the logs
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${uri}`);
    const url = uri.includes("sslmode=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}sslmode=require`;
    // the new compute takes a few seconds to start
    for (let i = 0; ; i++) {
      try {
        restored = parseCounts(query(url, countsSql())[0]);
        break;
      } catch (e) {
        if (i >= 11) throw new Error(`couldn't read the restored copy: ${e.stderr?.toString().trim() || e.message}`);
        await sleep(5000);
      }
    }
    live = parseCounts(query(DATABASE_URL, countsSql())[0]);
    problems = compare(restored, live);
  } catch (e) {
    problems = [e.message];
  } finally {
    try {
      await neon("DELETE", `/projects/${NEON_PROJECT_ID}/branches/${branchId}`);
      console.log(`Deleted branch ${name}`);
    } catch (e) {
      problems.push(`the drill branch ${name} couldn't be deleted, remove it in the Neon console (${e.message})`);
    }
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  const lines = [`### Restore drill: ${site}`, "", `Restored to ${at.toISOString().slice(0, 16).replace("T", " ")} UTC in ${seconds} seconds.`, ""];
  if (restored && live) {
    lines.push("| | Restored | Live |", "| --- | --- | --- |", `| Migrations | ${restored.migrations} | ${live.migrations} |`);
    for (const t of TABLES) lines.push(`| ${t} | ${restored[t]} | ${live[t]} |`);
    lines.push("");
  }
  lines.push(problems.length ? `🔴 Failed:\n${problems.map((p) => `- ${p}`).join("\n")}` : "🟢 Passed");
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  if (problems.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}
