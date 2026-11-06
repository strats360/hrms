import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, lastEmailTo, login } from "./helpers";

let krupa: Client, nisha: Client, priya: Client, kunal: Client;
const fy = (() => {
  const [y, m] = todayIST().split("-").map(Number) as [number, number];
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
})();
const idOf = async (code: string) => (await krupa.get(`/admin/employees?q=${code}`)).body.rows[0].id as string;

beforeAll(async () => {
  [krupa, nisha, priya, kunal] = await Promise.all([login("krupa.joshi@strats360.com"), login("nisha.trivedi@strats360.com"), login("priya.vaghela@strats360.com"), login("kunal.shah@strats360.com")]);
});

describe("TDS admin", () => {
  it("summary shows regimes and declarations; HR admin is read-only", async () => {
    const r = await nisha.get(`/admin/tds/summary?fy=${fy}`);
    expect(r.status).toBe(200);
    expect(r.body.totals.oldRegime).toBeGreaterThanOrEqual(4);
    const p = r.body.rows.find((x: any) => x.code === "STL-0042");
    expect(p.regime).toBe("old");
    expect(p.declared80C).toBe(130000);
    expect(p.declarationStatus).toBe("verified");
    expect((await nisha.patch(`/admin/tds/employees/${p.employeeId}/regime`, { regime: "new" })).status).toBe(403);
  });

  it("computation statement uses declarations, caps and HRA", async () => {
    const r = await krupa.get(`/admin/tds/employees/${await idOf("STL-0171")}?fy=${fy}`);
    const st = r.body.statement;
    expect(st.regime).toBe("old");
    expect(st.deductions.find((d: any) => d.key === "80C").amount).toBe(150000);
    expect(st.deductions.find((d: any) => d.key === "80CCD1B").amount).toBe(50000);
    expect(st.deductions.find((d: any) => d.key === "80D").amount).toBe(25000);
    expect(r.body.months.length).toBe(12);
    expect(r.body.deducted).toBeGreaterThan(0);
    expect(r.body.excess).toBe(Math.max(0, r.body.deducted + st.previousEmployerTds - st.tax.total));
    const priyaTax = (await krupa.get(`/admin/tds/employees/${await idOf("STL-0042")}?fy=${fy}`)).body;
    expect(priyaTax.statement.exemptions[0].key).toBe("hra");
  });

  it("HR switches a regime on request", async () => {
    const id = await idOf("STL-0152");
    expect((await krupa.patch(`/admin/tds/employees/${id}/regime`, { regime: "new", fy })).status).toBe(200);
    const r = await krupa.get(`/admin/tds/employees/${id}?fy=${fy}`);
    expect(r.body.statement.regime).toBe("new");
    expect(r.body.statement.deductions).toHaveLength(0);
    await krupa.patch(`/admin/tds/employees/${id}/regime`, { regime: "old", fy });
  });

  it("tracks 24Q returns and exports the annexure", async () => {
    const r = await krupa.get(`/admin/tds/returns?fy=${fy}`);
    const q1 = r.body.quarters.find((q: any) => q.quarter === "Q1");
    expect(q1.filed).not.toBeNull();
    expect(q1.tdsDeducted).toBeGreaterThan(0);
    expect((await krupa.req("PUT", `/admin/tds/returns/${fy}/Q4`, { filedOn: "2099-01-01" })).status).toBe(400);
    const csv = await krupa.get(`/admin/tds/returns/${fy}/Q1/annexure.csv`);
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("BNQPV7712C");
    expect(csv.body).toContain(",192,");
  });

  it("builds Form 16 data (provisional mid-year)", async () => {
    const list = await krupa.get(`/admin/tds/form16?fy=${fy}`);
    expect(list.body.employees.length).toBeGreaterThan(200);
    const f = await krupa.get(`/admin/tds/form16/${await idOf("STL-0042")}?fy=${fy}`);
    expect(f.body.employer.tan).toBe("AHMS12345B");
    expect(f.body.employee.pan).toBe("BNQPV7712C");
    expect(f.body.quarters.find((q: any) => q.quarter === "Q1").tdsDeducted).toBeGreaterThan(0);
    expect(f.body.quarters.find((q: any) => q.quarter === "Q1").tdsDeposited).toBeGreaterThan(0);
    expect(f.body.statement.taxableIncome).toBeGreaterThan(0);
    // mid-year: Part B is the projected full year, so tax payable covers what's been deducted
    expect(f.body.provisional).toBe(true);
    expect(f.body.projectedMonths).toBeGreaterThan(0);
    expect(f.body.statement.tax.total).toBeGreaterThan(f.body.tdsDeducted);
  });

  it("emails reminders to employees without a submitted declaration", async () => {
    const r = await krupa.post("/admin/tds/declarations/remind", { fy });
    expect(r.body.sent).toBeGreaterThan(100);
    expect(lastEmailTo("ravi.gohil@strats360.com")?.subject).toContain("Tax declaration");
  });
});

describe("TDS self-service", () => {
  it("a verified declaration is locked for the employee", async () => {
    const r = await priya.get(`/ess/tax?fy=${fy}`);
    expect(r.body.editable).toBe(false);
    expect((await priya.req("PUT", "/ess/tax", { fy, regime: "new", data: {} })).status).toBe(400);
  });

  it("declares, previews, uploads proofs, submits; HR verifies and locks", async () => {
    const pre = await krupa.post("/ess/tax/preview", { fy, data: { sec80C: { ppf: 150000 }, rent: { monthlyRent: 12000, months: 12 } } });
    expect(pre.status).toBe(200);
    expect(pre.body.old.deductions.find((d: any) => d.key === "80C").amount).toBe(150000);
    expect((await krupa.req("PUT", "/ess/tax", { fy, regime: "old", data: { sec80C: { ppf: 150000 }, rent: { monthlyRent: 12000, months: 12, metro: false } } })).status).toBe(200);
    const fd = new FormData();
    fd.set("section", "80C");
    fd.set("fy", fy);
    fd.set("file", new File([new Uint8Array([37, 80, 68, 70])], "ppf.pdf", { type: "application/pdf" }));
    const proof = await krupa.req("POST", "/ess/tax/proofs", fd);
    expect(proof.status).toBe(201);
    expect((await krupa.post("/ess/tax/submit", { fy })).body.status).toBe("submitted");
    const decls = (await nisha.get(`/admin/tds/declarations?fy=${fy}&status=submitted`)).body;
    const mine = decls.find((d: any) => d.code === "STL-0091");
    expect(mine.proofs.pending).toBe(1);
    expect((await krupa.patch(`/admin/tds/proofs/${proof.body.id}`, { status: "accepted" })).status).toBe(403);
    expect((await kunal.patch(`/admin/tds/proofs/${proof.body.id}`, { status: "accepted" })).status).toBe(200);
    // can't verify your own declaration
    expect((await krupa.post(`/admin/tds/declarations/${mine.id}/verify`, { verified: { "80C": 100000 }, lock: true })).status).toBe(403);
    const v = await kunal.post(`/admin/tds/declarations/${mine.id}/verify`, { verified: { "80C": 100000 }, lock: true });
    expect(v.body.status).toBe("verified");
    const after = (await krupa.get(`/ess/tax?fy=${fy}`)).body;
    expect(after.editable).toBe(false);
    expect(after.statement.deductions.find((d: any) => d.key === "80C").amount).toBeLessThan(150000);
  });

  it("employees can read their own Form 16 only", async () => {
    const f = await priya.get(`/ess/tax/form16?fy=${fy}`);
    expect(f.status).toBe(200);
    expect(f.body.employee.name).toBe("Priya Vaghela");
    expect((await priya.get(`/admin/tds/form16/${await idOf("STL-0001")}`)).status).toBe(403);
  });
});
