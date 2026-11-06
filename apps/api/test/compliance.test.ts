import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, login } from "./helpers";

let krupa: Client, nisha: Client, priya: Client;
beforeAll(async () => {
  [krupa, nisha, priya] = await Promise.all([login("krupa.joshi@strats360.com"), login("nisha.trivedi@strats360.com"), login("priya.vaghela@strats360.com")]);
});

describe("compliance", () => {
  it("is admin only, and HR admin is read-only", async () => {
    expect((await priya.get("/admin/compliance/overview")).status).toBe(403);
    expect((await nisha.get("/admin/compliance/overview")).status).toBe(200);
    expect((await nisha.post("/admin/compliance/challans", { statute: "epf", period: "2026-10", amountPaid: 1, paidOn: todayIST() })).status).toBe(403);
  });

  it("derives obligations for the latest locked month with due dates", async () => {
    const r = await krupa.get("/admin/compliance/overview");
    expect(r.status).toBe(200);
    const statutes = r.body.cards.map((c: any) => c.statute);
    expect(statutes).toEqual(expect.arrayContaining(["epf", "tds", "pt"]));
    const epf = r.body.cards.find((c: any) => c.statute === "epf");
    expect(epf.dueDate).toBe(`${nextMonth(r.body.latestMonth)}-15`);
    expect(epf.amount).toBe(epf.breakup.reduce((s: number, b: any) => s + b.amount, 0));
    expect(r.body.tracked.gratuityEligible).toBeGreaterThan(0);
  });

  it("history from seed is marked paid", async () => {
    const r = await krupa.get("/admin/compliance/obligations?fy=2026-27");
    const april = r.body.rows.filter((o: any) => o.period === "2026-04");
    expect(april.length).toBeGreaterThan(0);
    expect(april.every((o: any) => o.status === "paid")).toBe(true);
  });

  it("records a payment, refuses duplicates, stores a receipt", async () => {
    const ob = (await krupa.get("/admin/compliance/overview")).body.cards.find((c: any) => c.statute === "epf" && c.status !== "paid");
    expect(ob).toBeTruthy();
    const r = await krupa.post("/admin/compliance/challans", { statute: "epf", period: ob.period, amountPaid: ob.amount, reference: "TRRN-TEST-1", paidOn: todayIST() });
    expect(r.status).toBe(201);
    expect(r.body.amountDue).toBe(ob.amount);
    expect((await krupa.post("/admin/compliance/challans", { statute: "epf", period: ob.period, amountPaid: ob.amount, paidOn: todayIST() })).status).toBe(400);
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array([37, 80, 68, 70])], "trrn.pdf", { type: "application/pdf" }));
    expect((await krupa.req("POST", `/admin/compliance/challans/${r.body.id}/receipt`, fd)).status).toBe(200);
    const dl = await krupa.get(`/admin/compliance/challans/${r.body.id}/receipt`);
    expect(dl.status).toBe(200);
    const after = (await krupa.get("/admin/compliance/overview")).body.cards.find((c: any) => c.statute === "epf");
    expect(after.status).toBe("paid");
  });

  it("refuses payments for months without locked payroll", async () => {
    expect((await krupa.post("/admin/compliance/challans", { statute: "epf", period: "2030-01", amountPaid: 1, paidOn: todayIST() })).status).toBe(400);
  });

  it("produces employee-wise contributions and an ECR file", async () => {
    const r = await krupa.get("/admin/compliance/employee");
    const priyaRow = r.body.rows.find((x: any) => x.code === "STL-0042");
    expect(priyaRow.pfWage).toBe(15000);
    expect(priyaRow.epfEe).toBe(1800);
    expect(priyaRow.eps + priyaRow.epfEr).toBe(1800);
    const ecr = await krupa.get(`/admin/compliance/files/ecr.txt?month=${r.body.month}`);
    expect(ecr.status).toBe(200);
    const lines = (ecr.body as string).trim().split("\n");
    expect(lines.length).toBeGreaterThan(200);
    expect(lines.find((l) => l.startsWith("100887654321#~#PRIYA VAGHELA#~#"))?.split("#~#")).toHaveLength(11);
    expect((await nisha.get(`/admin/compliance/files/ecr.txt`)).status).toBe(403);
  });

  it("produces PT and TDS files and lists rules", async () => {
    const pt = await krupa.get("/admin/compliance/files/pt.csv");
    expect(pt.body).toContain("Gujarat");
    expect((await krupa.get("/admin/compliance/files/tds.csv")).body).toContain("TDS deducted");
    const rules = await krupa.get("/admin/compliance/rules");
    expect(rules.body.rules.some((r: any) => r.scope === "Gujarat" && r.rule.startsWith("Professional Tax"))).toBe(true);
  });
});

function nextMonth(m: string) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
