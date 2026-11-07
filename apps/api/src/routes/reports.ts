import { Hono, type Context } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { branches, departments } from "@hrms/db";
import { can, todayIST } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { toXlsx, XLSX_MIME } from "../lib/xlsx";
import { REPORTS, reportByKey, resolvePeriod, runReport, type ReportDef } from "../services/reports";

export const reportRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

/** A report needs Reports access plus view rights on the module its data comes from. */
const allowed = (c: Context<AppEnv>, r: ReportDef) => can(c.get("tenant").permissions, r.module, "view");

reportRoutes.get("/", requirePerm("reports", "view"), async (c) => {
  const db = c.get("db");
  const [b, d] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tid(c))).orderBy(asc(branches.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(and(eq(departments.tenantId, tid(c)))).orderBy(asc(departments.name)),
  ]);
  return c.json({
    reports: REPORTS.map((r) => ({ key: r.key, name: r.name, group: r.group, description: r.description, usesPeriod: r.usesPeriod, allowed: allowed(c, r) })),
    branches: b,
    departments: d,
    canExport: can(c.get("tenant").permissions, "reports", "export"),
  });
});

const q = z.object({
  period: z.string().max(20).optional(),
  branchId: z.string().optional(),
  departmentId: z.string().optional(),
  status: z.enum(["all", "active"]).default("all"),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
});

reportRoutes.get("/:key", requirePerm("reports", "view"), v("query", q), async (c) => {
  const def = reportByKey.get(c.req.param("key"));
  if (!def) throw notFound("Report");
  if (!allowed(c, def)) throw forbidden(`You need access to ${def.module} to run this report`);
  const f = c.req.valid("query");
  if (f.format !== "json" && !can(c.get("tenant").permissions, "reports", "export")) throw forbidden("You don't have export rights for reports");
  const period = resolvePeriod(f.period);
  const res = await runReport(c.get("db"), tid(c), def, f);
  if (f.format === "json") {
    return c.json({ key: def.key, name: def.name, period: def.usesPeriod ? period.label : null, header: res.header, rows: res.rows.slice(0, 100), total: res.rows.length, note: res.note ?? null, extraSheets: (res.sheets ?? []).map((s) => s.name) });
  }
  const base = `${def.key}-${def.usesPeriod ? period.label.replace(/\s+/g, "-").toLowerCase() : todayIST()}`;
  await audit(c, { action: "reports.export", entity: "report", entityId: def.key, summary: `Exported ${def.name}${def.usesPeriod ? ` (${period.label})` : ""} as ${f.format.toUpperCase()}: ${res.rows.length} rows` });
  if (f.format === "xlsx") {
    const file = toXlsx([{ name: def.name, header: res.header, rows: res.rows }, ...(res.sheets ?? [])]);
    return c.body(file as unknown as ArrayBuffer, 200, { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${base}.xlsx"` });
  }
  return c.body(toCsv(res.header, res.rows), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` });
});
