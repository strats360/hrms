import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSite, judge, versionDrift } from "./monitor.mjs";

const fakeFetch = (answers) => {
  let i = 0;
  return async (url) => {
    const a = typeof answers === "function" ? answers(url, i++) : answers[url];
    if (a instanceof Error) throw a;
    return { status: a.status, text: async () => (typeof a.body === "string" ? a.body : JSON.stringify(a.body)) };
  };
};
const site = { key: "india", name: "Saralix India", url: "https://app.saralix.com" };
const healthy = { status: 200, body: { ok: true, version: "1.4.0", migrations: 40, checks: { database: true, files: true } } };
const login = { status: 200, body: '<div id="root"></div>' };

test("reads health answers", () => {
  assert.equal(judge(200, healthy.body).up, true);
  assert.match(judge(503, null).why, /503/);
  assert.match(judge(200, { ok: true, checks: { database: false } }).why, /database/);
});

test("a healthy site is up on the first try", async () => {
  const r = await checkSite(site, { fetchImpl: fakeFetch({ "https://app.saralix.com/api/health?deep=1": healthy, "https://app.saralix.com/login": login }), gapMs: 0 });
  assert.equal(r.up, true);
  assert.equal(r.version, "1.4.0");
  assert.equal(r.tries, 1);
});

test("a blip doesn't count as down", async () => {
  const f = fakeFetch((url, i) => (url.endsWith("/login") ? login : i === 0 ? new Error("ECONNRESET") : healthy));
  const r = await checkSite(site, { fetchImpl: f, gapMs: 0 });
  assert.equal(r.up, true);
  assert.equal(r.tries, 2);
});

test("down after every try fails, with the reason", async () => {
  const r = await checkSite(site, { fetchImpl: fakeFetch({ "https://app.saralix.com/api/health?deep=1": { status: 200, body: { ok: true, checks: { database: false } } } }), gapMs: 0 });
  assert.equal(r.up, false);
  assert.match(r.why, /database/);
  assert.equal(r.tries, 3);
  const broken = await checkSite(site, { fetchImpl: fakeFetch({ "https://app.saralix.com/api/health?deep=1": healthy, "https://app.saralix.com/login": { status: 500, body: "oops" } }), gapMs: 0 });
  assert.match(broken.why, /login page answered 500/);
});

test("notices sites on different versions", () => {
  assert.equal(versionDrift([{ up: true, version: "1.4.0" }, { up: true, version: "1.4.0" }]), null);
  assert.deepEqual(versionDrift([{ up: true, version: "1.4.0" }, { up: true, version: "1.5.0" }]), ["1.4.0", "1.5.0"]);
});
