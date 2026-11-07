import { Hono } from "hono";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { branches, statutoryRules, tenants } from "@hrms/db";
import { builtInValue, describeRule, RULE_CATEGORY_LABEL, ruleKey, statutoryRuleSchema, todayIST, type RuleCategory } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePlatform } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { invalidateRules } from "../services/statutory";

/** Platform console: the statutory master. Staff can draft; super admins publish. */
export const statutoryRoutes = new Hono<AppEnv>();
statutoryRoutes.use("*", requirePlatform());

type Row = typeof statutoryRules.$inferSelect;
const label = (r: Pick<Row, "category" | "scope">) => {
  const cat = r.category as RuleCategory;
  if (cat === "tax") return `Income tax slabs · FY ${r.scope}`;
  if (cat === "pf" || cat === "esi") return `${RULE_CATEGORY_LABEL[cat]} rates and wage ceiling`;
  return `${RULE_CATEGORY_LABEL[cat]} · ${r.scope}`;
};
const shape = (r: Row) => ({ ...r, label: label(r), summary: describeRule(r.category as RuleCategory, r.value) });

/** Tenants a rule reaches: all for national rules, otherwise companies with a branch in that state. */
async function reach(db: AppEnv["Variables"]["db"], r: Pick<Row, "category" | "scope">) {
  if (r.category === "pf" || r.category === "esi" || r.category === "tax") {
    const [x] = await db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(ne(tenants.status, "cancelled"));
    return x?.n ?? 0;
  }
  const [x] = await db.select({ n: sql<number>`count(distinct ${branches.tenantId})::int` }).from(branches).where(eq(branches.state, r.scope));
  return x?.n ?? 0;
}

statutoryRoutes.get("/", async (c) => {
  const rows = await c.get("db").select().from(statutoryRules).orderBy(asc(statutoryRules.category), asc(statutoryRules.scope), desc(statutoryRules.effectiveFrom));
  const today = todayIST();
  // which live version is in force today for each key
  const current = new Map<string, string>();
  for (const r of rows) if (r.status === "live" && r.effectiveFrom <= today && !current.has(r.key)) current.set(r.key, r.id);
  return c.json({
    rows: rows.map((r) => ({ ...shape(r), inForce: current.get(r.key) === r.id, upcoming: r.status === "live" && r.effectiveFrom > today })),
    pending: rows.filter((r) => r.status === "draft").length,
  });
});

/** The value to start a new version from: latest version of the key, or the built-in rule. */
statutoryRoutes.get("/template", v("query", z.object({ category: z.enum(["pf", "esi", "pt", "lwf", "tax", "minwage"]), scope: z.string().optional() })), async (c) => {
  const q = c.req.valid("query");
  const key = ruleKey(q.category, q.scope);
  const [latest] = await c.get("db").select().from(statutoryRules).where(and(eq(statutoryRules.key, key), ne(statutoryRules.status, "retired"))).orderBy(desc(statutoryRules.effectiveFrom)).limit(1);
  return c.json({ key, value: latest?.value ?? builtInValue(q.category, q.scope) ?? null, from: latest ? "latest version" : "built-in" });
});

statutoryRoutes.post("/", v("json", statutoryRuleSchema), async (c) => {
  const b = c.req.valid("json");
  const scope = b.category === "pf" || b.category === "esi" ? "All India" : b.scope!;
  const [row] = await c
    .get("db")
    .insert(statutoryRules)
    .values({ key: ruleKey(b.category, scope), category: b.category, scope, value: b.value, effectiveFrom: b.effectiveFrom, source: b.source ?? null, notes: b.notes ?? null, createdBy: c.get("session")!.userId })
    .returning();
  await audit(c, { tenantId: null, action: "platform.rule_draft", entity: "statutory_rule", entityId: row!.id, summary: `Drafted ${label(row!)}, effective ${b.effectiveFrom}` });
  return c.json(shape(row!), 201);
});

statutoryRoutes.patch("/:id", v("json", statutoryRuleSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [cur] = await db.select().from(statutoryRules).where(eq(statutoryRules.id, c.req.param("id")));
  if (!cur) throw notFound("Rule");
  if (cur.status !== "draft") throw badRequest("Only drafts can be edited. Add a new version instead.");
  const scope = b.category === "pf" || b.category === "esi" ? "All India" : b.scope!;
  const [row] = await db.update(statutoryRules).set({ key: ruleKey(b.category, scope), category: b.category, scope, value: b.value, effectiveFrom: b.effectiveFrom, source: b.source ?? null, notes: b.notes ?? null }).where(eq(statutoryRules.id, cur.id)).returning();
  return c.json(shape(row!));
});

statutoryRoutes.delete("/:id", async (c) => {
  const [row] = await c.get("db").delete(statutoryRules).where(and(eq(statutoryRules.id, c.req.param("id")), eq(statutoryRules.status, "draft"))).returning();
  if (!row) throw badRequest("Only drafts can be deleted");
  return c.json({ ok: true });
});

/** Publish drafts: they apply to payroll months on or after their effective date. */
statutoryRoutes.post("/publish", requirePlatform("super_admin"), v("json", z.object({ ids: z.array(z.string()).min(1).max(50) })), async (c) => {
  const db = c.get("db");
  const out: { id: string; label: string; tenants: number }[] = [];
  for (const id of c.req.valid("json").ids) {
    const [d] = await db.select().from(statutoryRules).where(eq(statutoryRules.id, id));
    if (!d || d.status !== "draft") continue;
    // a live version with the same key and date is replaced
    await db.update(statutoryRules).set({ status: "retired" }).where(and(eq(statutoryRules.key, d.key), eq(statutoryRules.effectiveFrom, d.effectiveFrom), eq(statutoryRules.status, "live")));
    await db.update(statutoryRules).set({ status: "live", publishedBy: c.get("session")!.userId, publishedAt: new Date() }).where(eq(statutoryRules.id, d.id));
    out.push({ id: d.id, label: label(d), tenants: await reach(db, d) });
  }
  invalidateRules();
  if (!out.length) throw badRequest("Nothing to publish");
  const tenantsReached = Math.max(...out.map((o) => o.tenants));
  await audit(c, { tenantId: null, action: "platform.rules_publish", entity: "statutory_rule", summary: `Published ${out.length} rule version${out.length === 1 ? "" : "s"} (${out.map((o) => o.label).join("; ")}) to ${tenantsReached} tenant${tenantsReached === 1 ? "" : "s"}` });
  return c.json({ published: out.length, tenants: tenantsReached, rules: out });
});

statutoryRoutes.post("/:id/retire", requirePlatform("super_admin"), async (c) => {
  const [row] = await c.get("db").update(statutoryRules).set({ status: "retired" }).where(and(eq(statutoryRules.id, c.req.param("id")), eq(statutoryRules.status, "live"))).returning();
  if (!row) throw badRequest("Only a live version can be retired");
  invalidateRules();
  await audit(c, { tenantId: null, action: "platform.rule_retire", entity: "statutory_rule", entityId: row.id, summary: `Retired ${label(row)} effective ${row.effectiveFrom}` });
  return c.json(shape(row));
});
