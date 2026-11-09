import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client, nisha: Client;
let emp: { id: string; code: string; ctc: number };
let tplId = "";
let runId = "";
let month = "";

const field = {
  name: "Field sales",
  basicPctOfGross: 40,
  hraPctOfBasic: 40,
  conveyance: 1600,
  medical: 0,
  pfOnFullBasic: false,
  extras: [
    { code: "travel", label: "Travel allowance", mode: "fixed", value: 3000, taxable: true, esiWage: true },
    { code: "meal", label: "Meal coupons", mode: "fixed", value: 2200, taxable: false, esiWage: false },
  ],
};

beforeAll(async () => {
  [krupa, nisha] = await Promise.all([login("krupa.joshi@strats360.com"), login("nisha.trivedi@strats360.com")]);
  const [first] = await sql`select min(r.month) as m from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142'`;
  const base = new Date(`${first!.m}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - 1);
  month = base.toISOString().slice(0, 7);
  // someone on a CTC-based structure (no custom components), employed for the whole month
  [emp] = (await sql`
    select e.id, e.employee_code as code, e.annual_ctc::float as ctc from employees e join tenants t on t.id = e.tenant_id
    where t.code = 'TN-0142' and e.status = 'active' and e.user_id is null and e.date_of_joining < ${`${month}-01`} and e.last_working_day is null
      and not exists (select 1 from salary_structures s where s.employee_id = e.id and s.components is not null)
    order by e.employee_code desc limit 1`) as any;
});
afterAll(async () => {
  if (runId) await sql`delete from payroll_runs where id = ${runId}`;
  await sql`update employees set salary_template_id = null where id = ${emp.id}`;
  await sql.end();
});

describe("Salary templates", () => {
  it("adds a named template with its own allowances", async () => {
    expect((await nisha.post("/admin/payroll/templates", field)).status).toBe(403);
    const bad = await krupa.post("/admin/payroll/templates", { ...field, extras: [{ ...field.extras[0], code: "basic" }] });
    expect(bad.status).toBe(400);
    const r = await krupa.post("/admin/payroll/templates", field);
    expect(r.status).toBe(201);
    tplId = r.body.id;
    expect((await krupa.post("/admin/payroll/templates", field)).status).toBe(409);
    const list = (await krupa.get("/admin/payroll/templates")).body;
    expect(list[0]).toMatchObject({ id: null, name: "Standard", isDefault: true });
    expect(list.find((t: any) => t.id === tplId)).toMatchObject({ name: "Field sales", employees: 0 });
  });

  it("previews a CTC with the template's allowances", async () => {
    const p = (await krupa.post("/admin/payroll/template/preview", { annualCtc: 720000, templateId: tplId })).body;
    expect(p.components.extras.map((x: any) => x.code)).toEqual(["travel", "meal"]);
    expect(p.components.basic).toBe(Math.round(p.gross * 0.4));
  });

  it("puts employees on it, and payroll uses it", async () => {
    expect((await krupa.post("/admin/payroll/templates/assign", { templateId: tplId, employeeIds: [emp.id] })).body.updated).toBe(1);
    const s = (await krupa.get(`/admin/payroll/structures/${emp.id}`)).body;
    expect(s.employee.templateId).toBe(tplId);
    expect(s.current.components.extras).toHaveLength(2);
    const r = await krupa.post("/admin/payroll/runs", { month });
    expect(r.status).toBe(201);
    runId = r.body.id;
    expect((await krupa.post(`/admin/payroll/runs/${runId}/calculate`)).status).toBe(200);
    const [item] = await sql`select earnings, gross::float, taxable_gross::float, paid_days::float, days_in_month::float from payroll_items where run_id = ${runId} and employee_id = ${emp.id}`;
    const meal = (item!.earnings as any[]).find((e) => e.code === "x_meal");
    const travel = (item!.earnings as any[]).find((e) => e.code === "x_travel");
    expect(travel.label).toBe("Travel allowance");
    expect(meal.amount).toBe(Math.round((2200 * item!.paid_days) / item!.days_in_month));
    expect(item!.taxable_gross).toBe(item!.gross - meal.amount); // meal coupons aren't taxable
  });

  it("won't delete a template in use, and edits apply", async () => {
    expect((await krupa.req("DELETE", `/admin/payroll/templates/${tplId}`)).status).toBe(400);
    const r = await krupa.req("PUT", `/admin/payroll/templates/${tplId}`, { ...field, name: "Field sales (revised)", extras: [field.extras[0]] });
    expect(r.status).toBe(200);
    expect((await krupa.get(`/admin/payroll/structures/${emp.id}`)).body.current.components.extras).toHaveLength(1);
    await krupa.post("/admin/payroll/templates/assign", { templateId: null, employeeIds: [emp.id] });
    expect((await krupa.req("DELETE", `/admin/payroll/templates/${tplId}`)).status).toBe(200);
  });

  it("accepts custom components with allowances on one employee's structure", async () => {
    const s = (await krupa.get(`/admin/payroll/structures/${emp.id}`)).body.current;
    const r = await krupa.post(`/admin/payroll/structures/${emp.id}`, {
      effectiveFrom: "2099-01-01",
      annualCtc: 0,
      components: { ...s.components, special: Math.max(0, s.components.special - 1000), extras: [{ code: "shift", label: "Night shift allowance", amount: 1000, taxable: true, esiWage: true }] },
      reason: "Night shift",
    });
    expect(r.status).toBe(201);
    expect(r.body.annualCtc).toBeCloseTo(s.annualCtc, -2);
    await sql`delete from salary_structures where employee_id = ${emp.id} and effective_from = '2099-01-01'`;
  });
});
