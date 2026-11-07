import { beforeAll, describe, expect, it } from "vitest";
import { todayIST } from "@hrms/shared";
import { Client, login } from "./helpers";

let kunal: Client, nisha: Client, hardik: Client, priya: Client;
const [y, m] = todayIST().split("-").map(Number) as [number, number];
const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
const fy = `${m >= 4 ? y : y - 1}-${String(((m >= 4 ? y : y - 1) + 1) % 100).padStart(2, "0")}`;

beforeAll(async () => {
  [kunal, nisha, hardik, priya] = await Promise.all(["kunal.shah", "nisha.trivedi", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
});

describe("Reports", () => {
  it("lists the 16 reports with filters and access", async () => {
    const r = await kunal.get("/admin/reports");
    expect(r.status).toBe(200);
    expect(r.body.reports).toHaveLength(16);
    expect(r.body.reports.every((x: any) => x.allowed)).toBe(true);
    expect(r.body.branches.length).toBeGreaterThan(0);
    const hr = (await nisha.get("/admin/reports")).body.reports;
    expect(hr.find((x: any) => x.key === "employee-master").allowed).toBe(true);
    expect(hr.find((x: any) => x.key === "bank-payment-report").allowed).toBe(false); // HR has no payments access
    expect((await priya.get("/admin/reports")).status).toBe(403);
  });

  it("runs every report as a preview", async () => {
    const list = (await kunal.get("/admin/reports")).body.reports;
    for (const rep of list) {
      const r = await kunal.get(`/admin/reports/${rep.key}?period=${fy}`);
      expect(r.status, rep.key).toBe(200);
      expect(r.body.header.length, rep.key).toBeGreaterThan(0);
      for (const row of r.body.rows) expect(row.length, rep.key).toBe(r.body.header.length);
    }
  });

  it("has real data for payroll and compliance reports", async () => {
    const sal = (await kunal.get(`/admin/reports/salary-register?period=${lastMonth}`)).body;
    expect(sal.total).toBeGreaterThan(200);
    expect(sal.header).toContain("Net pay");
    const pf = (await kunal.get(`/admin/reports/pf-report?period=${lastMonth}`)).body;
    expect(pf.total).toBeGreaterThan(0);
    const master = (await kunal.get("/admin/reports/employee-master?status=active")).body;
    expect(master.rows.every((r: any[]) => !["exited", "inactive"].includes(r[10]))).toBe(true);
    const fnf = (await kunal.get("/admin/reports/fnf-report")).body;
    expect(fnf.total).toBeGreaterThan(0);
    const dept = (await kunal.get("/admin/reports")).body.departments[0];
    const filtered = (await kunal.get(`/admin/reports/employee-master?departmentId=${dept.id}`)).body;
    expect(filtered.total).toBeLessThan(master.total);
  });

  it("exports CSV and Excel with extra sheets", async () => {
    const csv = await kunal.get(`/admin/reports/payroll-summary?period=${lastMonth}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.body).toContain("Cost to company");
    const x = await kunal.req("GET", `/admin/reports/reimbursement-report?period=${fy}&format=xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    expect(x.headers.get("content-disposition")).toMatch(/\.xlsx/);
  });

  it("blocks data the role can't see", async () => {
    expect((await nisha.get(`/admin/reports/bank-payment-report?period=${fy}`)).status).toBe(403);
    expect((await hardik.get(`/admin/reports/salary-register?period=${lastMonth}`)).status).toBe(403);
    expect((await hardik.get(`/admin/reports/employee-master?format=csv`)).status).toBe(403); // view, no export
    expect((await kunal.get("/admin/reports/nope")).status).toBe(404);
  });
});
