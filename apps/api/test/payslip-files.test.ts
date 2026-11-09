import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { unzipSync } from "fflate";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let krupa: Client, kunal: Client, priya: Client, hardik: Client;
let run: { id: string; month: string };
let priyaId = "";

const raw = (client: Client, path: string) => client.file(path);

beforeAll(async () => {
  [krupa, kunal, priya, hardik] = await Promise.all([login("krupa.joshi@strats360.com"), login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com"), login("hardik.mehta@strats360.com")]);
  [run] = (await sql`select r.id, r.month from payroll_runs r join tenants t on t.id = r.tenant_id where t.code = 'TN-0142' and r.status = 'paid' order by r.month desc limit 1`) as any;
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql.end();
});

describe("Payslip PDFs", () => {
  it("downloads one payslip as a PDF", async () => {
    const r = await raw(krupa, `/admin/payroll/runs/${run.id}/payslips/${priyaId}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toMatch(new RegExp(`payslip-${run.month}-STL-0042\\.pdf`));
    const bytes = new Uint8Array(await r.raw.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await raw(hardik, `/admin/payroll/runs/${run.id}/payslips/${priyaId}/pdf`)).status).toBe(403);
  });

  it("lets employees download their own payslip only", async () => {
    const mine = await raw(priya, `/ess/payslips/${run.id}/pdf`);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("application/pdf");
    const [{ id: draft }] = (await sql`insert into payroll_runs (id, tenant_id, month, period_start, period_end, status) select gen_random_uuid()::text, tenant_id, '2019-01', '2019-01-01', '2019-01-31', 'calculated' from employees where id = ${priyaId} returning id`) as any;
    expect((await raw(priya, `/ess/payslips/${draft}/pdf`)).status).toBe(404); // not published
    await sql`delete from payroll_runs where id = ${draft}`;
  });

  it("downloads the whole run as a ZIP of PDFs", async () => {
    const r = await raw(krupa, `/admin/payroll/runs/${run.id}/payslips.zip`);
    expect(r.status).toBe(200);
    const files = unzipSync(new Uint8Array(await r.raw.arrayBuffer()));
    const [{ n }] = await sql`select count(*)::int as n from payroll_items where run_id = ${run.id}`;
    expect(Object.keys(files)).toHaveLength(n);
    expect(Object.keys(files)).toContain(`payslip-${run.month}-STL-0042.pdf`);
  }, 60_000);
});

describe("Emailing payslips", () => {
  it("emails each payslip with the PDF attached, in batches, once", async () => {
    await sql`update payroll_items set payslip_emailed_at = null, on_hold = (employee_id = ${priyaId}) where run_id = ${run.id}`;
    expect((await hardik.post(`/admin/payroll/runs/${run.id}/payslips/email`, {})).status).toBe(403);
    const status = (await kunal.get(`/admin/payroll/runs/${run.id}/payslips/email`)).body;
    expect(status).toMatchObject({ emailed: 0, onHold: 1, published: true });
    const before = mailer.sent.length;
    let r = (await kunal.post(`/admin/payroll/runs/${run.id}/payslips/email`, {})).body;
    expect(r.sent).toBe(40);
    let total = r.sent;
    while (r.remaining > 0) {
      r = (await kunal.post(`/admin/payroll/runs/${run.id}/payslips/email`, {})).body;
      total += r.sent;
    }
    expect(total).toBe(status.total - 1); // the salary on hold isn't sent
    const mails = mailer.sent.slice(before);
    expect(mails.every((m) => m.attachments?.[0]?.filename.endsWith(".pdf"))).toBe(true);
    expect(mails.some((m) => m.to === "priya.vaghela@strats360.com")).toBe(false);
    expect(atob(mails[0]!.attachments![0]!.content).slice(0, 5)).toBe("%PDF-");
    // nothing left to send
    expect((await kunal.post(`/admin/payroll/runs/${run.id}/payslips/email`, {})).body).toMatchObject({ sent: 0, remaining: 0 });
    await sql`update payroll_items set on_hold = false where run_id = ${run.id}`;
  }, 120_000);
});

describe("Form 16 PDFs", () => {
  let fy = "";
  it("downloads one employee's Form 16", async () => {
    const m = run.month;
    const start = Number(m.slice(5, 7)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1;
    fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    const r = await raw(kunal, `/admin/tds/form16/${priyaId}/pdf?fy=${fy}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(new RegExp(`form16-${fy}-STL-0042\\.pdf`));
    const bytes = new Uint8Array(await r.raw.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(`${process.env.PDF_OUT}/form16.pdf`, bytes);
    expect((await raw(hardik, `/admin/tds/form16/${priyaId}/pdf?fy=${fy}`)).status).toBe(403);
    expect((await raw(kunal, `/admin/tds/form16/${priyaId}/pdf?fy=2001-02`)).status).toBe(404);
  });

  it("gives everyone in the year their Form 16 in one ZIP", async () => {
    const r = await raw(kunal, `/admin/tds/form16.zip?fy=${fy}`);
    expect(r.status).toBe(200);
    const files = unzipSync(new Uint8Array(await r.raw.arrayBuffer()));
    expect(Object.keys(files).length).toBeGreaterThan(100);
  }, 120_000);

  it("lets an employee download their own", async () => {
    const r = await raw(priya, `/ess/tax/form16/pdf?fy=${fy}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
  });
});
