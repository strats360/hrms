#!/usr/bin/env node
/**
 * The list of Saralix sites (deploy/instances.json): load, check and plan rollouts.
 *
 *   node deploy/instances.mjs check                 validate the file (CI runs this)
 *   node deploy/instances.mjs plan [--hold a,b]     rollout waves as JSON, for the Rollout workflow
 *   node deploy/instances.mjs live                  live sites as JSON, for monitoring and drills
 *   node deploy/instances.mjs get <environment>     one site as JSON
 *
 * See docs/MULTI_COUNTRY.md.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTRIES = ["IN", "AE", "SA", "QA", "KW", "OM", "BH", "GB", "US", "CA"];
const BUCKET_LOCATIONS = ["apac", "eeur", "enam", "weur", "wnam", "oc"];
const KEYS = ["key", "name", "environment", "stage", "worker", "domain", "region", "bucketLocation", "countries", "timeZone", "currency", "wave", "status"];

export function loadInstances(file = join(here, "instances.json")) {
  return JSON.parse(readFileSync(file, "utf8")).instances;
}

/** Problems with the list, as readable sentences. Empty means it's fine. */
export function checkInstances(list) {
  const errors = [];
  const seen = { key: new Set(), environment: new Set(), worker: new Set(), domain: new Set() };
  for (const [i, x] of list.entries()) {
    const at = x.key ? `"${x.key}"` : `entry ${i + 1}`;
    for (const k of KEYS) if (!(k in x)) errors.push(`${at} is missing ${k}`);
    for (const k of ["key", "environment", "worker", "domain"]) {
      if (x[k] == null) continue;
      if (seen[k].has(x[k])) errors.push(`${at}: ${k} "${x[k]}" is used twice`);
      seen[k].add(x[k]);
    }
    if (x.key && !/^[a-z][a-z0-9-]*$/.test(x.key)) errors.push(`${at}: key must be lowercase letters, digits and dashes`);
    if (!["production", "staging"].includes(x.stage)) errors.push(`${at}: stage must be production or staging`);
    if (!["live", "planned"].includes(x.status)) errors.push(`${at}: status must be live or planned`);
    if (!Number.isInteger(x.wave) || x.wave < 0 || x.wave > 9) errors.push(`${at}: wave must be a whole number from 0 to 9`);
    if (!Array.isArray(x.countries) || !x.countries.length || x.countries.some((c) => !COUNTRIES.includes(c))) errors.push(`${at}: countries must list codes from ${COUNTRIES.join(", ")}`);
    if (!BUCKET_LOCATIONS.includes(x.bucketLocation)) errors.push(`${at}: bucketLocation must be one of ${BUCKET_LOCATIONS.join(", ")}`);
    if (!/^[A-Z]{3}$/.test(x.currency ?? "")) errors.push(`${at}: currency must be a 3 letter code`);
    try {
      new Intl.DateTimeFormat("en", { timeZone: x.timeZone });
    } catch {
      errors.push(`${at}: time zone "${x.timeZone}" isn't valid`);
    }
    if (x.domain != null && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x.domain)) errors.push(`${at}: domain "${x.domain}" isn't a host name`);
  }
  if (!list.some((x) => x.status === "live" && x.stage === "production")) errors.push("At least one live production site is needed");
  return errors;
}

export const instanceFor = (list, environment) => list.find((x) => x.environment === environment) ?? null;

/** Live sites grouped into waves, lowest first, leaving out held ones. */
export function planWaves(list, hold = []) {
  const held = new Set(hold.map((h) => h.trim()).filter(Boolean));
  const unknown = [...held].filter((h) => !list.some((x) => x.key === h));
  if (unknown.length) throw new Error(`Unknown site in hold: ${unknown.join(", ")}`);
  const live = list.filter((x) => x.status === "live" && !held.has(x.key));
  const waves = [...new Set(live.map((x) => x.wave))].sort((a, b) => a - b);
  return waves.map((w) => live.filter((x) => x.wave === w).map((x) => ({ key: x.key, name: x.name, environment: x.environment })));
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  const list = loadInstances();
  const errors = checkInstances(list);
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  if (cmd === "check") {
    console.log(`✓ ${list.length} sites, ${list.filter((x) => x.status === "live").length} live`);
  } else if (cmd === "plan") {
    const i = process.argv.indexOf("--hold");
    const hold = i > 0 ? (process.argv[i + 1] ?? "").split(",") : [];
    // the Rollout workflow has three wave jobs: everything after wave two goes in the third
    let waves;
    try {
      waves = planWaves(list, hold);
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
    const three = [waves[0] ?? [], waves[1] ?? [], waves.slice(2).flat()];
    const out = { wave1: JSON.stringify(three[0]), wave2: JSON.stringify(three[1]), wave3: JSON.stringify(three[2]) };
    console.log(JSON.stringify(three, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  } else if (cmd === "live") {
    const live = list.filter((x) => x.status === "live").map((x) => ({ key: x.key, name: x.name, environment: x.environment, url: x.domain ? `https://${x.domain}` : null }));
    console.log(JSON.stringify(live));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sites=${JSON.stringify(live)}\n`);
  } else if (cmd === "get") {
    const x = instanceFor(list, arg);
    if (!x) {
      console.error(`✗ No site uses the GitHub environment "${arg}". Add it to deploy/instances.json.`);
      process.exit(1);
    }
    console.log(JSON.stringify(x));
  } else {
    console.error("Use: check | plan [--hold a,b] | live | get <environment>");
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
