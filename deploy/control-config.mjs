#!/usr/bin/env node
/**
 * Write the control plane's Worker config (apps/control/wrangler.deploy.json).
 *
 *   CONTROL_DOMAIN       where it's served, default login.saralix.com (the zone must be on this Cloudflare account)
 *   CONTROL_WORKER       Worker name, default saralix-control
 *   ACCESS_TEAM_DOMAIN   Cloudflare Access team domain, e.g. saralix.cloudflareaccess.com
 *   ACCESS_AUD           the console's Access application audience tag
 *
 * The list of sites comes from deploy/instances.json (live sites with a domain).
 * See docs/MULTI_COUNTRY.md.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadInstances } from "./instances.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const domain = (env.CONTROL_DOMAIN || "login.saralix.com").trim();
const sites = loadInstances()
  .filter((x) => x.status === "live" && x.stage === "production" && x.domain)
  .map((x) => ({ key: x.key, name: x.name, url: `https://${x.domain}`, region: x.region }));
if (!sites.length) {
  console.error("✗ No live production site with a domain in deploy/instances.json");
  process.exit(1);
}
if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) console.warn("! ACCESS_TEAM_DOMAIN or ACCESS_AUD isn't set, so the console will refuse everyone until they are.");

const config = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: env.CONTROL_WORKER || "saralix-control",
  main: "src/index.ts",
  compatibility_date: "2026-10-01",
  observability: { enabled: true },
  workers_dev: false,
  routes: [{ pattern: domain, custom_domain: true }],
  vars: { ENVIRONMENT: "production", SITES: JSON.stringify(sites), ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN ?? "", ACCESS_AUD: env.ACCESS_AUD ?? "" },
};
writeFileSync(join(root, "apps/control/wrangler.deploy.json"), JSON.stringify(config, null, 2) + "\n");
console.log(`• Control plane at https://${domain}, routing to ${sites.map((s) => s.name).join(", ")}`);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `url=https://${domain}\n`);
