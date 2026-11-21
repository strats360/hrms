import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { toXlsx } from "../lib/xlsx";
import { annualReturnFigures, buildRegister, REGISTER_FORMS, type RegisterForm } from "../services/registers";

/** Statutory registers (Forms A to E) and the unified annual return figures. */
export const registerRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

registerRoutes.get("/", requirePerm("compliance", "view"), (c) => c.json({ forms: REGISTER_FORMS }));

registerRoutes.get("/annual-return", requirePerm("compliance", "view"), v("query", z.object({ year: z.coerce.number().int().min(2000).max(2100) })), async (c) => c.json(await annualReturnFigures(c.get("db"), tid(c), c.req.valid("query").year)));

registerRoutes.get("/:form", requirePerm("compliance", "export"), v("query", z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), format: z.enum(["csv", "xlsx"]).default("xlsx"), entityId: z.string().optional() })), async (c) => {
  const form = c.req.param("form").toUpperCase() as RegisterForm;
  if (!(form in REGISTER_FORMS)) throw badRequest("Pick a register from A to E");
  const q = c.req.valid("query");
  const sheet = await buildRegister(c.get("db"), tid(c), form, q.month, q.entityId);
  await audit(c, { action: "compliance.register_export", entity: "tenant", entityId: tid(c), summary: `Exported Form ${form}, ${REGISTER_FORMS[form]}, for ${q.month} (${sheet.rows.length} rows)` });
  const file = `form-${form.toLowerCase()}-${q.month}`;
  if (q.format === "csv") return c.body(toCsv(sheet.header, sheet.rows as never), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.csv"` });
  return c.body(toXlsx([{ ...sheet, name: `Form ${form}` }]) as unknown as ArrayBuffer, 200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file}.xlsx"` });
});
