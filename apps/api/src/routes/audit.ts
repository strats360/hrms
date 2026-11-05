import { Hono } from "hono";
import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import { auditLogs } from "@hrms/db";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get("/", requirePerm("settings", "view"), v("query", z.object({ q: z.string().optional(), before: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const conds = [eq(auditLogs.tenantId, c.get("tenant").tenantId)];
  if (q.q) conds.push(or(ilike(auditLogs.summary, `%${q.q}%`), ilike(auditLogs.actorName, `%${q.q}%`), ilike(auditLogs.action, `%${q.q}%`))!);
  if (q.before) conds.push(lt(auditLogs.createdAt, new Date(q.before)));
  const rows = await c.get("db").select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.createdAt)).limit(100);
  return c.json(rows);
});
