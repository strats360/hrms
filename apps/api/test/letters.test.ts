import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PDFDocument } from "pdf-lib";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, priya: Client;
let priyaId = "";

beforeAll(async () => {
  [kunal, priya] = await Promise.all([login("kunal.shah@strats360.com"), login("priya.vaghela@strats360.com")]);
  [{ id: priyaId }] = (await sql`select id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
});
afterAll(async () => {
  await sql`delete from employee_documents where employee_id = ${priyaId} and type = 'company_letter'`;
  await sql`update tenants set settings = settings - 'letterTemplates' - 'letterSettings' where code = 'TN-0142'`;
  await sql.end();
});

describe("Letter generator", () => {
  it("ships the common letters", async () => {
    const r = await kunal.get("/admin/letters/templates");
    expect(r.status).toBe(200);
    expect(r.body.templates.map((t: any) => t.name)).toEqual(expect.arrayContaining(["Offer letter", "Appointment letter", "Experience letter", "Relieving letter", "Salary certificate", "Employment and address proof"]));
  });

  it("fills a letter in for an employee, with the salary breakdown", async () => {
    await kunal.req("PUT", "/admin/letters/settings", { signatoryName: "Kunal Shah", signatoryTitle: "Director" });
    const r = await kunal.post("/admin/letters/preview", { employeeId: priyaId, templateId: "builtin:salary_certificate" });
    expect(r.status).toBe(200);
    expect(r.body.text).toMatch(/This is to certify that Ms\. Priya Vaghela \(Employee ID STL-0042\)/);
    expect(r.body.text).toMatch(/since 2 January 2022/);
    expect(r.body.text).toMatch(/Her current annual cost to company is Rs\. 14,40,000 \(Fourteen lakh forty thousand/);
    expect(r.body.text).toContain("{{salary_table}}");
    const rows = r.body.salaryTable.map((x: any) => x.label);
    expect(rows[0]).toBe("Basic");
    expect(rows.at(-1)).toBe("Cost to company");
    expect(r.body.salaryTable.at(-1).monthly).toBe(120000);
    expect(r.body.missing).toEqual([]);
    // edited text is filled in again, and gaps are flagged
    const edited = await kunal.post("/admin/letters/preview", { employeeId: priyaId, templateId: "builtin:experience", text: "Signed by {{signatory.name}}, {{signatory.title}}. Left on {{employee.last_working_day}}." });
    expect(edited.body.text).toBe("Signed by Kunal Shah, Director. Left on [Last working day].");
    expect(edited.body.missing).toEqual(["employee.last_working_day"]);
  });

  it("lets HR edit, reset and add templates", async () => {
    expect((await kunal.req("PUT", "/admin/letters/templates/builtin:experience", { name: "Experience letter", body: "# Experience\n\n{{employee.name}} worked here." })).status).toBe(200);
    let list = (await kunal.get("/admin/letters/templates")).body.templates;
    expect(list.find((t: any) => t.id === "builtin:experience")).toMatchObject({ edited: true, body: "# Experience\n\n{{employee.name}} worked here." });
    expect((await kunal.req("DELETE", "/admin/letters/templates/builtin:experience")).status).toBe(200);
    list = (await kunal.get("/admin/letters/templates")).body.templates;
    expect(list.find((t: any) => t.id === "builtin:experience").edited).toBe(false);

    const own = await kunal.post("/admin/letters/templates", { name: "Bonus letter", body: "Dear {{employee.first_name}}, well done this year." });
    expect(own.status).toBe(201);
    expect((await kunal.post("/admin/letters/preview", { employeeId: priyaId, templateId: own.body.id })).body.text).toBe("Dear Priya, well done this year.");
    expect((await kunal.req("DELETE", `/admin/letters/templates/${own.body.id}`)).status).toBe(200);
    expect((await kunal.post("/admin/letters/templates", { name: "x", body: "too short" })).status).toBe(422);
  });

  it("makes a PDF on letterhead and can save it to the employee's documents", async () => {
    const f = await kunal.req("POST", "/admin/letters/pdf", { employeeId: priyaId, templateId: "builtin:offer", save: true });
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("application/pdf");
    expect(f.headers.get("content-disposition")).toMatch(/Offer letter - Priya Vaghela\.pdf/);
    expect(f.headers.get("x-document-id")).toBeTruthy();
    const [doc] = await sql`select type, name, status from employee_documents where id = ${f.headers.get("x-document-id")}`;
    expect(doc).toMatchObject({ type: "company_letter", status: "verified" });
    // the employee sees it in self-service
    const mine = (await priya.get("/ess/profile")).body.documents;
    expect(mine.some((d: any) => d.type === "company_letter" && d.name.startsWith("Offer letter"))).toBe(true);
    const [{ summary }] = (await sql`select summary from audit_logs where action = 'letters.generate' order by created_at desc limit 1`) as any;
    expect(summary).toBe("Generated Offer letter for Priya Vaghela and saved it to their documents");
  });

  it("produces a readable multi-page PDF", async () => {
    const raw = await fetchPdf();
    const pdf = await PDFDocument.load(raw);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toBe("Appointment letter · Priya Vaghela");
  });

  it("is for HR only", async () => {
    expect((await priya.post("/admin/letters/preview", { employeeId: priyaId, templateId: "builtin:offer" })).status).toBe(403);
    expect((await kunal.post("/admin/letters/preview", { employeeId: "nope", templateId: "builtin:offer" })).status).toBe(404);
  });
});

/** POST that returns the raw PDF (the test client reads bodies as text). */
async function fetchPdf() {
  const headers: Record<string, string> = { Origin: env.APP_URL, Cookie: kunal.cookie, "Content-Type": "application/json" };
  const { buildApp } = await import("../src/app");
  const res = await buildApp().fetch(new Request(env.APP_URL + "/api/admin/letters/pdf", { method: "POST", headers, body: JSON.stringify({ employeeId: priyaId, templateId: "builtin:appointment" }) }), env);
  return new Uint8Array(await res.arrayBuffer());
}
