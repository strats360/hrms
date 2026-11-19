import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, parseCounts } from "./restore-drill.mjs";

const live = parseCounts("40,3,250,8,7301,1200");

test("reads the counts line", () => {
  assert.deepEqual(live, { migrations: 40, tenants: 3, employees: 250, payroll_runs: 8, attendance_records: 7301, audit_logs: 1200 });
});

test("an hour old copy passes", () => {
  assert.deepEqual(compare(parseCounts("40,3,249,8,7290,1190"), live), []);
});

test("an empty or broken copy fails", () => {
  assert.ok(compare(parseCounts("0,0,0,0,0,0"), live).some((p) => p.includes("no migrations")));
  assert.ok(compare(parseCounts("40,3,0,8,7290,1190"), live).some((p) => p.includes("employees is empty")));
  assert.ok(compare(parseCounts("40,3,250,8,1000,1190"), live).some((p) => p.includes("attendance_records has 1000")));
  assert.ok(compare(parseCounts("41,3,250,8,7301,1200"), live).some((p) => p.includes("more migrations")));
});
