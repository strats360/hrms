import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let priya: Client, krupa: Client, kunal: Client;
let priyaId = "";

beforeAll(async () => {
  [priya, krupa, kunal] = await Promise.all([login("priya.vaghela@strats360.com"), login("krupa.joshi@strats360.com"), login("kunal.shah@strats360.com")]);
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from salary_structures where employee_id = ${priyaId} and effective_from in ('2025-04-01', '2025-10-01', '2099-04-01')`;
  await sql`update tenants set settings = settings - 'essSalaryView' where code = 'TN-0142'`;
  await sql.end();
});

describe("My salary (self-service)", () => {
  it("shows the CTC breakdown that payroll uses, and an estimated take-home", async () => {
    const r = await priya.get("/ess/salary");
    expect(r.status).toBe(200);
    const admin = (await krupa.get(`/admin/payroll/structures/${priyaId}`)).body.current;
    expect(r.body.annualCtc).toBe(admin.annualCtc);
    expect(r.body.gross).toBe(admin.gross);
    expect(r.body.earnings.find((x: any) => x.code === "basic").amount).toBe(admin.components.basic);
    expect(r.body.gross + r.body.employerTotal).toBe(r.body.monthlyCtc);
    expect(r.body.takeHome).toBe(r.body.gross - r.body.totalDeductions);
    expect(r.body.deductions.map((d: any) => d.code)).toContain("pf");
  });

  it("lists revisions so far, but not future-dated ones", async () => {
    const before = (await priya.get("/ess/salary")).body;
    expect(before.revisions).toEqual([]);
    const cur = before.annualCtc;
    const earlier = Math.round(cur * 0.9);
    await sql`insert into salary_structures (id, tenant_id, employee_id, effective_from, annual_ctc, reason)
      select gen_random_uuid()::text, tenant_id, id, d, a, 'HR note' from employees, (values ('2025-04-01'::date, ${earlier}::numeric), ('2025-10-01'::date, ${cur}::numeric)) v(d, a) where id = ${priyaId}`;
    await krupa.post(`/admin/payroll/structures/${priyaId}`, { effectiveFrom: "2099-04-01", annualCtc: cur + 500000, reason: "Not told yet" });
    const r = (await priya.get("/ess/salary")).body;
    expect(r.annualCtc).toBe(cur);
    expect(r.effectiveFrom).toBe("2025-10-01");
    expect(r.revisions.map((x: any) => x.effectiveFrom)).toEqual(["2025-10-01", "2025-04-01"]);
    expect(r.revisions[0]).toMatchObject({ annualCtc: cur, change: cur - earlier });
    expect(r.revisions[0].changePct).toBeCloseTo(((cur - earlier) / earlier) * 100, 0);
    expect(r.revisions[1].change).toBeNull();
    // HR's reasons aren't shown to the employee
    expect(JSON.stringify(r)).not.toMatch(/HR note|Not told yet/);
  });

  it("can be hidden by HR", async () => {
    expect((await kunal.patch("/admin/org/settings", { essSalaryView: false })).status).toBe(200);
    const r = await priya.get("/ess/salary");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("salary_hidden");
    // payslips stay available
    expect((await priya.get("/ess/payslips")).status).toBe(200);
  });
});
