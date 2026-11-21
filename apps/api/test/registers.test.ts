import { beforeAll, describe, expect, it } from "vitest";
import { Client, login } from "./helpers";

let kunal: Client;
beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
});

describe("statutory registers", () => {
  it("builds Forms A to E", async () => {
    const month = "2026-10";
    for (const [form, head] of [["A", /^Sl,Employee ID,Name,Gender/], ["B", /^Sl,Employee ID,Name,Designation,Monthly CTC,Days paid/], ["C", /^Sl,Employee ID,Name,Kind/], ["D", /^Employee ID,Name,01,02/], ["E", /^Employee ID,Name,Leave type,Opening/]] as const) {
      const r = await kunal.file(`/admin/compliance/registers/${form}?month=${month}&format=csv`);
      expect(r.status, form).toBe(200);
      const text = await r.raw.text();
      expect(text.split("\n")[0], form).toMatch(head);
      if (form !== "C") expect(text.split("\n").length, form).toBeGreaterThan(5);
    }
    const x = await kunal.file(`/admin/compliance/registers/B?month=${month}`);
    expect(x.raw.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect((await kunal.file(`/admin/compliance/registers/Z?month=${month}`)).status).toBe(400);
  });

  it("works out the annual return figures", async () => {
    const r = (await kunal.get("/admin/compliance/registers/annual-return?year=2026")).body;
    expect(r.employees.atYearEnd).toBeGreaterThan(0);
    expect(r.employees.women + r.employees.men + r.employees.other).toBe(r.employees.atYearEnd);
    expect(r.wagesPaid).toBeGreaterThan(0);
    expect(r.manDaysPaid).toBeGreaterThan(0);
  });
});
