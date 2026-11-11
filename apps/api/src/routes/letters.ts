import { Hono, type Context } from "hono";
import { eq, sql } from "drizzle-orm";
import { employeeDocuments, tenants } from "@hrms/db";
import { can, letterGenerateSchema, letterSettingsSchema, letterTemplateSchema, renderLetter, SALARY_TABLE, todayIST, type LetterTemplate } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { putFile, safeName } from "../lib/storage";
import { letterPdf, letterTemplates, letterValues } from "../services/letters";

export const letterRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

async function saveTemplates(c: Context<AppEnv>, list: LetterTemplate[]) {
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ letterTemplates: list.map(({ id, name, body }) => ({ id, name, body })) })}::jsonb` }).where(eq(tenants.id, tid(c)));
}

letterRoutes.get("/templates", requirePerm("employees", "view"), async (c) => {
  const { templates, settings } = await letterTemplates(c.get("db"), tid(c));
  return c.json({ templates, settings });
});

letterRoutes.post("/templates", requirePerm("settings", "edit"), v("json", letterTemplateSchema), async (c) => {
  const b = c.req.valid("json");
  const { saved } = await letterTemplates(c.get("db"), tid(c));
  if (saved.filter((x) => !x.id.startsWith("builtin:")).length >= 50) throw badRequest("You can keep up to 50 templates of your own");
  const t = { id: `custom:${crypto.randomUUID()}`, ...b };
  await saveTemplates(c, [...saved, t]);
  await audit(c, { action: "letters.template_create", entity: "tenant", entityId: tid(c), summary: `Added letter template ${b.name}` });
  return c.json(t, 201);
});

letterRoutes.put("/templates/:id", requirePerm("settings", "edit"), v("json", letterTemplateSchema), async (c) => {
  const id = c.req.param("id");
  const b = c.req.valid("json");
  const { templates, saved } = await letterTemplates(c.get("db"), tid(c));
  if (!templates.some((x) => x.id === id)) throw notFound("Template");
  await saveTemplates(c, [...saved.filter((x) => x.id !== id), { id, ...b }]);
  await audit(c, { action: "letters.template_update", entity: "tenant", entityId: tid(c), summary: `Edited letter template ${b.name}` });
  return c.json({ id, ...b });
});

/** Deletes a company template, or puts a built-in one back to how it shipped. */
letterRoutes.delete("/templates/:id", requirePerm("settings", "edit"), async (c) => {
  const id = c.req.param("id");
  const { templates, saved } = await letterTemplates(c.get("db"), tid(c));
  const t = templates.find((x) => x.id === id);
  if (!t) throw notFound("Template");
  await saveTemplates(c, saved.filter((x) => x.id !== id));
  await audit(c, { action: id.startsWith("builtin:") ? "letters.template_reset" : "letters.template_delete", entity: "tenant", entityId: tid(c), summary: `${id.startsWith("builtin:") ? "Reset" : "Deleted"} letter template ${t.name}` });
  return c.json({ ok: true });
});

letterRoutes.put("/settings", requirePerm("settings", "edit"), v("json", letterSettingsSchema), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ letterSettings: b })}::jsonb` }).where(eq(tenants.id, tid(c)));
  return c.json(b);
});

/** Fill a template in for one employee; salary needs payroll access. */
async function prepare(c: Context<AppEnv>, employeeId: string, templateId: string, text?: string) {
  const db = c.get("db");
  const { templates, settings } = await letterTemplates(db, tid(c));
  const t = templates.find((x) => x.id === templateId);
  if (!t) throw notFound("Template");
  const withSalary = can(c.get("tenant").permissions, "payroll", "view");
  const data = await letterValues(db, tid(c), employeeId, withSalary, settings);
  if (!data) throw notFound("Employee");
  const r = renderLetter(text ?? t.body, data.values);
  const usesSalary = /\{\{\s*salary[._]/.test(text ?? t.body);
  return { t, data, settings, ...r, salaryHidden: usesSalary && !withSalary, salaryMissing: usesSalary && withSalary && !data.salary };
}

letterRoutes.post("/preview", requirePerm("employees", "edit"), v("json", letterGenerateSchema), async (c) => {
  const b = c.req.valid("json");
  const p = await prepare(c, b.employeeId, b.templateId, b.text);
  return c.json({ title: p.t.name, text: p.text, missing: p.missing, unknown: p.unknown, salaryTable: p.text.includes(SALARY_TABLE) ? p.data.salary : null, salaryHidden: p.salaryHidden, salaryMissing: p.salaryMissing });
});

letterRoutes.post("/pdf", requirePerm("employees", "edit"), v("json", letterGenerateSchema), async (c) => {
  const b = c.req.valid("json");
  const p = await prepare(c, b.employeeId, b.templateId, b.text);
  const title = b.title ?? p.t.name;
  const today = todayIST();
  const reference = `${p.data.employee.code}/${(title.split(/\s+/)[0] ?? "").replace(/[^A-Za-z]/g, "").slice(0, 8).toUpperCase() || "LTR"}/${today.replace(/-/g, "")}`;
  const pdf = await letterPdf({ title: `${title} · ${p.data.employee.name}`, text: p.text, reference, company: p.data.company, salary: p.data.salary, signatory: p.settings });
  let documentId: string | null = null;
  if (b.save) {
    const key = `tenants/${tid(c)}/employees/${p.data.employee.id}/${crypto.randomUUID()}-${safeName(title)}.pdf`;
    await putFile(c.env, key, pdf.buffer as ArrayBuffer, "application/pdf");
    const [doc] = await c
      .get("db")
      .insert(employeeDocuments)
      .values({ tenantId: tid(c), employeeId: p.data.employee.id, type: "company_letter", name: `${title} (${today})`, fileKey: key, mimeType: "application/pdf", sizeBytes: pdf.byteLength, status: "verified", uploadedBy: c.get("session")!.userId, verifiedBy: c.get("session")!.userId, verifiedAt: new Date() })
      .returning();
    documentId = doc!.id;
  }
  await audit(c, { action: "letters.generate", entity: "employee", entityId: p.data.employee.id, summary: `Generated ${title} for ${p.data.employee.name}${b.save ? " and saved it to their documents" : ""}` });
  return c.body(pdf as never, 200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName(`${title} - ${p.data.employee.name}`)}.pdf"`, ...(documentId ? { "X-Document-Id": documentId } : {}) });
});
