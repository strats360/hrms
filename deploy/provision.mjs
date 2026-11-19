#!/usr/bin/env node
/**
 * Provision Cloudflare resources for one environment and write the Worker config
 * used by `wrangler deploy`. Safe to run on every deploy: it creates what's missing
 * and updates what exists.
 *
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   Cloudflare credentials
 *   DATABASE_URL                                  Postgres 14+ *direct* connection string with sslmode=require (Neon, or any provider)
 *   DEPLOY_ENV                                    the GitHub environment, e.g. production, staging, gulf (default production).
 *                                                 The site's settings come from deploy/instances.json for that environment.
 *   WORKER_NAME                                   overrides the site's worker (default saralix, or saralix-staging)
 *   CUSTOM_DOMAIN                                 overrides the site's domain (zone must be on this account)
 *   APP_URL                                       optional; defaults to https://CUSTOM_DOMAIN or the workers.dev URL
 *   EMAIL_FROM                                    optional, e.g. "Saralix <people@strats360.com>"
 *   CASHFREE_ENV                                  sandbox | production (default sandbox)
 *   ALLOWED_COUNTRIES                             entity countries this site allows, e.g. "IN" or "AE,QA,KW,OM" (default IN)
 *   DEFAULT_TIME_ZONE, DEFAULT_CURRENCY           the site's default zone and currency (default Asia/Kolkata, INR)
 *
 *   node deploy/provision.mjs [--dry-run]
 *
 * Writes apps/api/wrangler.deploy.json and, on GitHub Actions, the step outputs
 * app_url, worker_name and hyperdrive_id.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { instanceFor, loadInstances } from "./instances.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dry = process.argv.includes("--dry-run");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const target = env.DEPLOY_ENV || "production";
/** This site's settings (deploy/instances.json). GitHub environment variables override them. */
const site = instanceFor(loadInstances(), target);
const deployEnv = site?.stage ?? (target === "staging" ? "staging" : "production");
const worker = env.WORKER_NAME || site?.worker || (deployEnv === "staging" ? "saralix-staging" : "saralix");
const bucket = env.R2_BUCKET || `${worker}-files`;
const hyperdriveName = `${worker}-db`;
const account = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
const log = (msg) => console.log(`• ${msg}`);

// ---------------------------------------------------------------------------
// Database URL
// ---------------------------------------------------------------------------
export function parseDatabaseUrl(raw) {
  if (!raw) throw new Error("DATABASE_URL is not set (the direct Postgres connection string, e.g. from Neon)");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL isn't a valid URL");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
  if (!u.username || !u.password) throw new Error("DATABASE_URL needs a user and password");
  const neon = u.hostname.endsWith(".neon.tech");
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || (neon ? "neondb" : "postgres");
  const warnings = [];
  if (u.hostname.includes("-pooler.")) warnings.push("This is Neon's pooled endpoint. Hyperdrive pools connections itself, so use the direct endpoint (without -pooler) for best results.");
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (!local && !["require", "verify-full", "verify-ca"].includes(u.searchParams.get("sslmode") ?? "")) warnings.push("Add ?sslmode=require to the connection string, so the database connection is encrypted.");
  return { host: u.hostname, port: Number(u.port || 5432), database, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), warnings };
}

// ---------------------------------------------------------------------------
// Cloudflare API
// ---------------------------------------------------------------------------
async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(`${method} ${path} failed (${res.status}): ${(json.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ") || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return json.result;
}

async function verifyToken() {
  try {
    await cf("GET", `/accounts/${account}/tokens/verify`);
  } catch {
    await cf("GET", "/user/tokens/verify");
  }
}

async function ensureBucket() {
  try {
    await cf("GET", `/accounts/${account}/r2/buckets/${bucket}`);
    log(`R2 bucket ${bucket} exists`);
  } catch (e) {
    if (e.status !== 404) throw e;
    const locationHint = site?.bucketLocation ?? "apac";
    await cf("POST", `/accounts/${account}/r2/buckets`, { name: bucket, locationHint });
    log(`Created R2 bucket ${bucket} (${locationHint})`);
  }
}

async function ensureHyperdrive(db) {
  // Caching is off: an HRMS reads straight after it writes, and cached reads would show stale data.
  const body = { name: hyperdriveName, origin: { scheme: "postgres", host: db.host, port: db.port, database: db.database, user: db.user, password: db.password }, caching: { disabled: true } };
  const list = await cf("GET", `/accounts/${account}/hyperdrive/configs`);
  const existing = (list ?? []).find((h) => h.name === hyperdriveName);
  if (existing) {
    await cf("PUT", `/accounts/${account}/hyperdrive/configs/${existing.id}`, body);
    log(`Updated Hyperdrive ${hyperdriveName} (${existing.id})`);
    return existing.id;
  }
  const created = await cf("POST", `/accounts/${account}/hyperdrive/configs`, body);
  log(`Created Hyperdrive ${hyperdriveName} (${created.id})`);
  return created.id;
}

async function workersDevUrl() {
  try {
    const r = await cf("GET", `/accounts/${account}/workers/subdomain`);
    return r?.subdomain ? `https://${worker}.${r.subdomain}.workers.dev` : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Worker config
// ---------------------------------------------------------------------------
export function workerConfig({ hyperdriveId, appUrl, emailFrom, customDomain }) {
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: worker,
    main: "src/index.ts",
    compatibility_date: "2026-10-01",
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: "../web/dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
    observability: { enabled: true },
    // daily at 10:00 IST: automatic retries of failed autopay debits
    triggers: { crons: ["30 4 * * *", "0 * * * *"] },
    workers_dev: !customDomain,
    ...(customDomain ? { routes: [{ pattern: customDomain, custom_domain: true }] } : {}),
    vars: { APP_URL: appUrl, EMAIL_FROM: emailFrom ?? "", ENVIRONMENT: deployEnv, CASHFREE_ENV: env.CASHFREE_ENV === "production" ? "production" : "sandbox", ALLOWED_COUNTRIES: env.ALLOWED_COUNTRIES || site?.countries.join(",") || "IN",
      DEFAULT_TIME_ZONE: env.DEFAULT_TIME_ZONE || site?.timeZone || "Asia/Kolkata",
      DEFAULT_CURRENCY: env.DEFAULT_CURRENCY || site?.currency || "INR",
      INSTANCE_KEY: site?.key ?? target,
      INSTANCE_NAME: site?.name ?? `Saralix (${target})`,
      INSTANCE_REGION: site?.region ?? "",
    },
    hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdriveId }],
    r2_buckets: [{ binding: "FILES", bucket_name: bucket }],
  };
}

async function main() {
  if (!site) console.warn(`! No site in deploy/instances.json uses the "${target}" environment. Using defaults; add it to the file.`);
  console.log(`Provisioning ${site?.name ?? target} (${worker}, ${deployEnv})${dry ? " · dry run" : ""}`);
  let db;
  try {
    db = parseDatabaseUrl(env.DATABASE_URL);
  } catch (e) {
    fail(e.message);
  }
  for (const w of db.warnings) console.warn(`! ${w}`);
  if (!dry) {
    if (!token || !account) fail("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
    await verifyToken().catch((e) => fail(`The Cloudflare API token didn't verify: ${e.message}`));
  }
  const customDomain = (env.CUSTOM_DOMAIN || site?.domain || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  let hyperdriveId = "dry-run-hyperdrive-id";
  let devUrl = `https://${worker}.example.workers.dev`;
  if (!dry) {
    await ensureBucket();
    hyperdriveId = await ensureHyperdrive(db);
    devUrl = (await workersDevUrl()) ?? devUrl;
  }
  const appUrl = (env.APP_URL || (customDomain ? `https://${customDomain}` : devUrl)).replace(/\/$/, "");
  if (!appUrl.startsWith("https://")) fail(`APP_URL must use https (got ${appUrl})`);
  const config = workerConfig({ hyperdriveId, appUrl, emailFrom: env.EMAIL_FROM, customDomain });
  const out = join(root, "apps/api/wrangler.deploy.json");
  writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
  log(`Wrote ${out}`);
  log(`App URL: ${appUrl}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `app_url=${appUrl}\nworker_name=${worker}\nhyperdrive_id=${hyperdriveId}\nsite_name=${site?.name ?? target}\nsite_key=${site?.key ?? target}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => fail(e.message));
}
