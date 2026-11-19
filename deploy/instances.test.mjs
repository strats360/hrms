import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInstances, instanceFor, loadInstances, planWaves } from "./instances.mjs";

const site = (o) => ({ key: "a", name: "A", environment: "a", stage: "production", worker: "w-a", domain: "a.saralix.com", region: "R", bucketLocation: "apac", countries: ["IN"], timeZone: "Asia/Kolkata", currency: "INR", wave: 1, status: "live", ...o });

test("the committed list is valid and India is live in wave 1", () => {
  const list = loadInstances();
  assert.deepEqual(checkInstances(list), []);
  assert.equal(instanceFor(list, "production").key, "india");
  assert.deepEqual(planWaves(list)[0].map((x) => x.key), ["india"]);
});

test("catches duplicates, bad values and a missing live site", () => {
  const errors = checkInstances([site({}), site({ key: "b", environment: "a", worker: "w-b", domain: "b.saralix.com", countries: ["XX"], timeZone: "Mars/Base", status: "maybe" })]);
  assert.ok(errors.some((e) => e.includes('environment "a" is used twice')));
  assert.ok(errors.some((e) => e.includes("countries")));
  assert.ok(errors.some((e) => e.includes("time zone")));
  assert.ok(errors.some((e) => e.includes("status")));
  assert.ok(checkInstances([site({ status: "planned" })]).some((e) => e.includes("live production site")));
});

test("plans live sites by wave, leaves out planned and held ones", () => {
  const list = [
    site({ key: "india", environment: "production", worker: "w1", domain: "in.saralix.com", wave: 1 }),
    site({ key: "gulf", environment: "gulf", worker: "w2", domain: "gulf.saralix.com", wave: 2 }),
    site({ key: "uk", environment: "uk", worker: "w3", domain: "uk.saralix.com", wave: 2 }),
    site({ key: "us", environment: "us", worker: "w4", domain: "us.saralix.com", wave: 3, status: "planned" }),
  ];
  assert.deepEqual(planWaves(list).map((w) => w.map((x) => x.key)), [["india"], ["gulf", "uk"]]);
  assert.deepEqual(planWaves(list, ["uk"]).map((w) => w.map((x) => x.key)), [["india"], ["gulf"]]);
  assert.throws(() => planWaves(list, ["nowhere"]), /Unknown site/);
});
