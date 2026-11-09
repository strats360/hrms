#!/usr/bin/env node
/**
 * Provision Cloudflare resources for one environment and write the Worker config
 * used by `wrangler deploy`. Safe to run on every deploy: it creates what's missing
 * and updates what exists.
 *
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   Cloudflare credentials
 *   DATABASE_URL                                  Neon *direct* connection string (sslmode=require)
 *   DEPLOY_ENV                                    production | staging (default production)
 *   WORKER_NAME                                   default strats360-hrms, or strats360-hrms-staging
 *   CUSTOM_DOMAIN                                 optional, e.g. hrms.strats360.com (zone must be on this account)
 *   APP_URL                                       optional; defaults to https://CUSTOM_DOMAIN or the workers.dev URL
 *   EMAIL_FROM                                    optional, e.g. "Strats360 People <people@strats360.com>"
 *   CASHFREE_ENV                                  sandbox | production (default sandbox)
 *
 *   node deploy/provision.mjs [--dry-run]
 *
 * Writes apps/api/wrangler.deploy.json and, on GitHub Actions, the step outputs
 * app_url, worker_name and hyperdrive_id.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dry = process.argv.includes("--dry-run");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const deployEnv = env.DEPLOY_ENV === "staging" ? "staging" : "production";
const worker = env.WORKER_NAME || (deployEnv === "staging" ? "strats360-hrms-staging" : "strats360-hrms");
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
  if (!raw) throw new Error("DATABASE_URL is not set (the Neon direct connection string)");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL isn't a valid URL");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
  if (!u.username || !u.password) throw new Error("DATABASE_URL needs a user and password");
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "neondb";
  const warnings = [];
  if (u.hostname.includes("-pooler.")) warnings.push("This is Neon's pooled endpoint. Hyperdrive pools connections itself, so use the direct endpoint (without -pooler) for best results.");
  if (u.hostname.endsWith(".neon.tech") && u.searchParams.get("sslmode") !== "require") warnings.push("Add ?sslmode=require to the Neon connection string.");
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
    await cf("POST", `/accounts/${account}/r2/buckets`, { name: bucket, locationHint: "apac" });
    log(`Created R2 bucket ${bucket} (Asia-Pacific)`);
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
    triggers: { crons: ["30 4 * * *"] },
    workers_dev: !customDomain,
    ...(customDomain ? { routes: [{ pattern: customDomain, custom_domain: true }] } : {}),
    vars: { APP_URL: appUrl, EMAIL_FROM: emailFrom ?? "", ENVIRONMENT: deployEnv, CASHFREE_ENV: env.CASHFREE_ENV === "production" ? "production" : "sandbox" },
    hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdriveId }],
    r2_buckets: [{ binding: "FILES", bucket_name: bucket }],
  };
}

async function main() {
  console.log(`Provisioning ${deployEnv} (${worker})${dry ? " · dry run" : ""}`);
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
  const customDomain = (env.CUSTOM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
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
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `app_url=${appUrl}\nworker_name=${worker}\nhyperdrive_id=${hyperdriveId}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => fail(e.message));
}
