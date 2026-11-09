import { Hono, type Context } from "hono";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { employees, payrollItems, payrollRuns } from "@hrms/db";
import { zipSync } from "fflate";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { payslipView } from "./payroll";
import { monthName, payslipFileName, payslipPdf, type PayslipData } from "../services/payslip-pdf";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const PER_REQUEST = 40;

const pdfResponse = (c: Context<AppEnv>, bytes: Uint8Array, name: string, inline = false) =>
  c.body(bytes as unknown as ArrayBuffer, 200, { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "Cache-Control": "private, no-store" });

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function loadRun(c: Context<AppEnv>) {
  const [run] = await c.get("db").select().from(payrollRuns).where(and(eq(payrollRuns.id, c.req.param("id")!), eq(payrollRuns.tenantId, tid(c))));
  if (!run) throw notFound("Payroll run");
  if (run.status === "draft") throw badRequest("Calculate the payroll first");
  return run;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const payslipFileRoutes = new Hono<AppEnv>();

payslipFileRoutes.get("/runs/:id/payslips/:employeeId/pdf", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c);
  const [item] = await c.get("db").select().from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.employeeId, c.req.param("employeeId"))));
  if (!item) throw notFound("Payslip");
  const view = (await payslipView(c, run, item)) as unknown as PayslipData;
  return pdfResponse(c, await payslipPdf(view), payslipFileName(view), c.req.query("inline") === "1");
});

/** Every payslip in the run as separate PDFs in one ZIP. */
payslipFileRoutes.get("/runs/:id/payslips.zip", requirePerm("payroll", "export"), async (c) => {
  const run = await loadRun(c);
  const items = await c.get("db").select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  if (!items.length) throw badRequest("This payroll has no payslips");
  const files: Record<string, Uint8Array> = {};
  for (const item of items) {
    const view = (await payslipView(c, run, item)) as unknown as PayslipData;
    files[payslipFileName(view)] = await payslipPdf(view);
  }
  // PDFs are already compressed
  const zip = zipSync(files, { level: 0 });
  await audit(c, { action: "payroll.payslips_download", entity: "payroll_run", entityId: run.id, summary: `Downloaded all ${items.length} payslips for ${run.month}` });
  return c.body(zip as unknown as ArrayBuffer, 200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="payslips-${run.month}.zip"`, "Cache-Control": "private, no-store" });
});

payslipFileRoutes.get("/runs/:id/payslips/email", requirePerm("payroll", "view"), async (c) => {
  const run = await loadRun(c);
  const [r] = await c
    .get("db")
    .select({
      total: sql<number>`count(*)::int`,
      emailed: sql<number>`count(*) filter (where ${payrollItems.payslipEmailedAt} is not null)::int`,
      onHold: sql<number>`count(*) filter (where ${payrollItems.onHold})::int`,
    })
    .from(payrollItems)
    .where(eq(payrollItems.runId, run.id));
  return c.json({ ...r, published: !!run.publishedAt && (run.status === "approved" || run.status === "paid") });
});

/**
 * Email payslips (PDF attached) to employees who haven't had theirs yet. Works through
 * the run in batches; call again while `remaining` is above zero. Salaries on hold are
 * left out until they're released.
 */
payslipFileRoutes.post("/runs/:id/payslips/email", requirePerm("payroll", "approve"), v("json", z.object({ resend: z.boolean().default(false) }).default({ resend: false })), async (c) => {
  const run = await loadRun(c);
  if (run.status !== "approved" && run.status !== "paid") throw badRequest("Approve and lock the payroll before emailing payslips");
  const db = c.get("db");
  if (c.req.valid("json").resend) await db.update(payrollItems).set({ payslipEmailedAt: null }).where(eq(payrollItems.runId, run.id));
  const batch = await db
    .select({ item: payrollItems, email: employees.workEmail })
    .from(payrollItems)
    .innerJoin(employees, eq(employees.id, payrollItems.employeeId))
    .where(and(eq(payrollItems.runId, run.id), eq(payrollItems.onHold, false), isNull(payrollItems.payslipEmailedAt)))
    .orderBy(asc(payrollItems.employeeId))
    .limit(PER_REQUEST);
  let sent = 0;
  const failed: string[] = [];
  for (const { item, email } of batch) {
    const view = (await payslipView(c, run, item)) as unknown as PayslipData;
    try {
      const pdf = await payslipPdf(view);
      const company = view.company.legalName ?? view.company.name ?? "Your company";
      const { html, text } = layout({
        company,
        heading: `Your payslip for ${monthName(run.month)}`,
        paragraphs: [`Hi ${view.employee.name.split(" ")[0]}, your payslip for ${monthName(run.month)} is attached. You can also see it any time in self-service.`],
        cta: { label: "Open payslips", url: `${c.env.APP_URL}/me/payslips` },
      });
      await c.get("mailer").send({ to: email, subject: `Payslip · ${monthName(run.month)}`, html, text, attachments: [{ filename: payslipFileName(view), content: toBase64(pdf) }] });
      sent++;
    } catch (e) {
      console.error("payslip email failed", e);
      failed.push(view.employee.code);
    }
    // marked either way, so one bad address can't stall the rest; failures are reported
    await db.update(payrollItems).set({ payslipEmailedAt: new Date() }).where(eq(payrollItems.id, item.id));
  }
  if (!run.publishedAt) await db.update(payrollRuns).set({ publishedAt: new Date() }).where(eq(payrollRuns.id, run.id));
  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(payrollItems).where(and(eq(payrollItems.runId, run.id), eq(payrollItems.onHold, false), isNull(payrollItems.payslipEmailedAt)));
  if (sent) await audit(c, { action: "payroll.payslips_email", entity: "payroll_run", entityId: run.id, summary: `Emailed ${sent} payslips for ${run.month}${failed.length ? `; ${failed.length} failed (${failed.slice(0, 10).join(", ")})` : ""}` });
  return c.json({ sent, failed, remaining: left?.n ?? 0 });
});

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------
export const essPayslipFileRoutes = new Hono<AppEnv>();
essPayslipFileRoutes.use("/payslips/*", requireEmployee);

essPayslipFileRoutes.get("/payslips/:runId/pdf", async (c) => {
  const t = c.get("tenant");
  if (t.readOnly) throw forbidden("Downloads aren't available in a support session");
  const [row] = await c
    .get("db")
    .select({ run: payrollRuns, item: payrollItems })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.tenantId, t.tenantId), eq(payrollItems.employeeId, t.employeeId!), eq(payrollRuns.id, c.req.param("runId")), sql`${payrollRuns.publishedAt} is not null and ${payrollRuns.status} in ('approved','paid')`));
  if (!row) throw notFound("Payslip");
  const view = (await payslipView(c, row.run, row.item)) as unknown as PayslipData;
  return pdfResponse(c, await payslipPdf(view), payslipFileName(view));
});
