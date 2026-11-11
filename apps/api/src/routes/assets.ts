import { Hono, type Context } from "hono";
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { assetAssignments, assets, branches, employeeExits, employees, memberships, roles, tenants, user, type Database } from "@hrms/db";
import {
  ASSET_CATEGORY_LABEL,
  ASSET_STATUS_LABEL,
  assetSchema,
  assetStatusSchema,
  assignSchema,
  CONDITION_LABEL,
  fmtDate,
  ISSUE_LABEL,
  reportIssueSchema,
  returnSchema,
  todayIST,
  warrantyState,
  type AssetCategory,
  type AssetStatus,
  type Condition,
} from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, conflict, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { toXlsx, XLSX_MIME } from "../lib/xlsx";
import { sendNotification } from "../services/notifications";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
type Asset = typeof assets.$inferSelect;

async function nextTag(db: Database, tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(eq(assets.tenantId, tenantId));
  for (let n = (r?.n ?? 0) + 1; ; n++) {
    const tag = `AST-${String(n).padStart(4, "0")}`;
    const [x] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tenantId), eq(assets.tag, tag)));
    if (!x) return tag;
  }
}
async function load(c: Context<AppEnv>, id: string) {
  const [a] = await c.get("db").select().from(assets).where(and(eq(assets.id, id), eq(assets.tenantId, tid(c))));
  if (!a) throw notFound("Asset");
  return a;
}
const openAssignment = async (db: Database, assetId: string) => (await db.select().from(assetAssignments).where(and(eq(assetAssignments.assetId, assetId), isNull(assetAssignments.returnedOn))))[0] ?? null;

async function tell(c: Context<AppEnv>, employeeId: string, subject: string, paragraphs: (first: string) => string[]) {
  try {
    const db = c.get("db");
    const [e] = await db.select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, employeeId));
    const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    if (!e) return;
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: subject, paragraphs: paragraphs(e.first), cta: { label: "See my assets", url: `${c.env.APP_URL}/me/profile?tab=assets` } });
    await sendNotification(c, "asset_updates", { to: e.email, subject, html, text });
  } catch (err) {
    console.error("asset email failed", err);
  }
}

/** The person's open exit has "assets returned" on its checklist: keep it in step. */
async function syncExitChecklist(c: Context<AppEnv>, employeeId: string) {
  const db = c.get("db");
  const [x] = await db.select().from(employeeExits).where(and(eq(employeeExits.employeeId, employeeId), notInArray(employeeExits.status, ["settled", "cancelled"])));
  if (!x || !x.clearance.some((i) => i.key === "assets")) return;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(and(eq(assets.tenantId, tid(c)), eq(assets.holderId, employeeId)))) as [{ n: number }];
  const done = n === 0;
  const item = x.clearance.find((i) => i.key === "assets")!;
  if (item.done === done) return;
  const clearance = x.clearance.map((i) => (i.key === "assets" ? { ...i, done, doneBy: done ? `${c.get("session")!.name} (all assets returned)` : null, doneAt: done ? new Date().toISOString() : null } : i));
  await db.update(employeeExits).set({ clearance }).where(eq(employeeExits.id, x.id));
}

/** Assets someone still holds, for the exit checklist. */
export async function heldAssets(db: Database, tenantId: string, employeeId: string) {
  return db.select({ id: assets.id, tag: assets.tag, name: assets.name, category: assets.category }).from(assets).where(and(eq(assets.tenantId, tenantId), eq(assets.holderId, employeeId))).orderBy(asc(assets.tag));
}

export const assetRoutes = new Hono<AppEnv>();
assetRoutes.use("*", requirePerm("assets", "view"));

function listWhere(c: Context<AppEnv>) {
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status");
  const category = c.req.query("category");
  const employeeId = c.req.query("employeeId");
  const like = `%${q}%`;
  return and(
    eq(assets.tenantId, tid(c)),
    status ? eq(assets.status, status) : undefined,
    category ? eq(assets.category, category) : undefined,
    employeeId ? eq(assets.holderId, employeeId) : undefined,
    q ? or(ilike(assets.tag, like), ilike(assets.name, like), ilike(assets.serialNumber, like), ilike(employees.fullName, like)) : undefined,
  );
}
const listQuery = (c: Context<AppEnv>) =>
  c
    .get("db")
    .select({ a: assets, holder: employees.fullName, holderCode: employees.employeeCode, holderStatus: employees.status, branch: branches.name })
    .from(assets)
    .leftJoin(employees, eq(employees.id, assets.holderId))
    .leftJoin(branches, eq(branches.id, assets.branchId))
    .where(listWhere(c))
    .orderBy(asc(assets.tag));

assetRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await listQuery(c);
  const today = todayIST();
  const since = rows.length
    ? new Map((await db.select({ assetId: assetAssignments.assetId, on: assetAssignments.assignedOn, ack: assetAssignments.acknowledgedAt, issue: assetAssignments.issue }).from(assetAssignments).where(and(inArray(assetAssignments.assetId, rows.map((r) => r.a.id)), isNull(assetAssignments.returnedOn)))).map((x) => [x.assetId, x]))
    : new Map();
  const [summary] = await db
    .select({
      total: sql<number>`count(*)::int`,
      assigned: sql<number>`count(*) filter (where ${assets.status} = 'assigned')::int`,
      available: sql<number>`count(*) filter (where ${assets.status} = 'available')::int`,
      repair: sql<number>`count(*) filter (where ${assets.status} = 'in_repair')::int`,
      value: sql<number>`coalesce(sum(${assets.purchaseCost}) filter (where ${assets.status} not in ('retired','lost')), 0)::float`,
    })
    .from(assets)
    .where(eq(assets.tenantId, tid(c)));
  // assets with people who've left or are leaving
  const [{ withLeavers }] = (await db.select({ withLeavers: sql<number>`count(*)::int` }).from(assets).innerJoin(employees, eq(employees.id, assets.holderId)).where(and(eq(assets.tenantId, tid(c)), inArray(employees.status, ["notice", "exited", "inactive"])))) as [{ withLeavers: number }];
  return c.json({
    rows: rows.map((r) => ({ ...r.a, holder: r.a.holderId ? { id: r.a.holderId, name: r.holder, code: r.holderCode, status: r.holderStatus } : null, branch: r.branch, assignedOn: since.get(r.a.id)?.on ?? null, acknowledged: !!since.get(r.a.id)?.ack, issue: since.get(r.a.id)?.issue ?? null, warranty: warrantyState(r.a.warrantyUntil, today) })),
    summary: { ...summary, withLeavers },
  });
});

assetRoutes.get("/export.xlsx", requirePerm("assets", "export"), async (c) => {
  const rows = await listQuery(c);
  const file = toXlsx([
    {
      name: "Assets",
      header: ["Tag", "Name", "Category", "Serial number", "Status", "Condition", "Held by", "Employee ID", "Branch", "Purchase date", "Cost (₹)", "Vendor", "Invoice", "Warranty until"],
      rows: rows.map((r) => [r.a.tag, r.a.name, ASSET_CATEGORY_LABEL[r.a.category as AssetCategory], r.a.serialNumber, ASSET_STATUS_LABEL[r.a.status as AssetStatus], CONDITION_LABEL[r.a.condition as Condition], r.holder ?? "", r.holderCode ?? "", r.branch ?? "", r.a.purchaseDate, r.a.purchaseCost, r.a.vendor, r.a.invoiceNumber, r.a.warrantyUntil]),
    },
  ]);
  await audit(c, { action: "assets.export", entity: "asset", summary: `Exported ${rows.length} assets` });
  return c.body(file as unknown as ArrayBuffer, 200, { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="assets-${todayIST()}.xlsx"` });
});

assetRoutes.post("/", requirePerm("assets", "edit"), v("json", assetSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const tag = b.tag || (await nextTag(db, tid(c)));
  const [dup] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tid(c)), eq(assets.tag, tag)));
  if (dup) throw conflict(`Another asset already has the tag ${tag}`);
  const [a] = await db.insert(assets).values({ ...b, tag, notes: b.notes || null, tenantId: tid(c) }).returning();
  await audit(c, { action: "assets.create", entity: "asset", entityId: a!.id, summary: `Added ${tag} ${b.name}` });
  return c.json(a, 201);
});

assetRoutes.put("/:id", requirePerm("assets", "edit"), v("json", assetSchema), async (c) => {
  const a = await load(c, c.req.param("id"));
  const b = c.req.valid("json");
  const tag = b.tag || a.tag;
  if (tag !== a.tag) {
    const [dup] = await c.get("db").select({ id: assets.id }).from(assets).where(and(eq(assets.tenantId, tid(c)), eq(assets.tag, tag)));
    if (dup) throw conflict(`Another asset already has the tag ${tag}`);
  }
  const [out] = await c.get("db").update(assets).set({ ...b, tag, notes: b.notes || null, updatedAt: new Date() }).where(eq(assets.id, a.id)).returning();
  await audit(c, { action: "assets.update", entity: "asset", entityId: a.id, summary: `Updated ${tag} ${b.name}` });
  return c.json(out);
});

assetRoutes.get("/:id", async (c) => {
  const a = await load(c, c.req.param("id"));
  const history = await c
    .get("db")
    .select({ x: assetAssignments, name: employees.fullName, code: employees.employeeCode })
    .from(assetAssignments)
    .innerJoin(employees, eq(employees.id, assetAssignments.employeeId))
    .where(eq(assetAssignments.assetId, a.id))
    .orderBy(desc(assetAssignments.assignedOn), desc(assetAssignments.createdAt));
  return c.json({ asset: { ...a, warranty: warrantyState(a.warrantyUntil, todayIST()) }, history: history.map((h) => ({ ...h.x, employee: { id: h.x.employeeId, name: h.name, code: h.code } })) });
});

assetRoutes.post("/:id/assign", requirePerm("assets", "edit"), v("json", assignSchema), async (c) => {
  const a = await load(c, c.req.param("id"));
  if (a.status !== "available") throw badRequest(a.status === "assigned" ? "It's already assigned. Take it back first." : `It's ${ASSET_STATUS_LABEL[a.status as AssetStatus].toLowerCase()}. Mark it available first.`);
  const b = c.req.valid("json");
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  if (e.status === "exited" || e.status === "inactive") throw badRequest(`${e.fullName} has left`);
  await db.insert(assetAssignments).values({ tenantId: tid(c), assetId: a.id, employeeId: e.id, assignedOn: b.date, expectedReturn: b.expectedReturn, conditionOut: b.condition, noteOut: b.note || null, assignedBy: c.get("session")!.name });
  await db.update(assets).set({ status: "assigned", holderId: e.id, condition: b.condition, updatedAt: new Date() }).where(eq(assets.id, a.id));
  await syncExitChecklist(c, e.id);
  await tell(c, e.id, `${a.name} (${a.tag}) is assigned to you`, (first) => [`Hi ${first},`, `${a.name}${a.serialNumber ? `, serial ${a.serialNumber},` : ""} has been assigned to you from ${fmtDate(b.date)}.`, "Please confirm you've received it in self-service. If something's wrong with it, report it there."]);
  await audit(c, { action: "assets.assign", entity: "asset", entityId: a.id, summary: `Gave ${a.tag} ${a.name} to ${e.fullName}` });
  return c.json({ ok: true });
});

assetRoutes.post("/:id/return", requirePerm("assets", "edit"), v("json", returnSchema), async (c) => {
  const a = await load(c, c.req.param("id"));
  const db = c.get("db");
  const open = await openAssignment(db, a.id);
  if (!open) throw badRequest("It isn't assigned to anyone");
  const b = c.req.valid("json");
  if (b.date < open.assignedOn) throw badRequest("It can't come back before it was given out");
  await db.update(assetAssignments).set({ returnedOn: b.date, conditionIn: b.condition, noteIn: b.note || null, returnedBy: c.get("session")!.name, updatedAt: new Date() }).where(eq(assetAssignments.id, open.id));
  await db.update(assets).set({ status: b.status, holderId: null, condition: b.condition, updatedAt: new Date() }).where(eq(assets.id, a.id));
  await syncExitChecklist(c, open.employeeId);
  const [e] = await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, open.employeeId));
  await tell(c, open.employeeId, `${a.name} (${a.tag}) returned`, (first) => [`Hi ${first},`, `We've recorded ${a.name} as returned on ${fmtDate(b.date)}, in ${CONDITION_LABEL[b.condition].toLowerCase()} condition. Thanks.`]);
  await audit(c, { action: "assets.return", entity: "asset", entityId: a.id, summary: `${e?.name} returned ${a.tag} ${a.name} (${CONDITION_LABEL[b.condition]})${b.status !== "available" ? `; now ${ASSET_STATUS_LABEL[b.status].toLowerCase()}` : ""}` });
  return c.json({ ok: true });
});

assetRoutes.post("/:id/status", requirePerm("assets", "edit"), v("json", assetStatusSchema), async (c) => {
  const a = await load(c, c.req.param("id"));
  if (a.status === "assigned") throw badRequest("Take it back from the person first");
  const b = c.req.valid("json");
  await c.get("db").update(assets).set({ status: b.status, notes: b.note ? [a.notes, `${fmtDate(todayIST())}: ${b.note}`].filter(Boolean).join("\n") : a.notes, updatedAt: new Date() }).where(eq(assets.id, a.id));
  await audit(c, { action: "assets.status", entity: "asset", entityId: a.id, summary: `${a.tag} ${a.name} is now ${ASSET_STATUS_LABEL[b.status].toLowerCase()}${b.note ? `: ${b.note}` : ""}` });
  return c.json({ ok: true });
});

assetRoutes.delete("/:id", requirePerm("assets", "configure"), async (c) => {
  const a = await load(c, c.req.param("id"));
  const [used] = await c.get("db").select({ id: assetAssignments.id }).from(assetAssignments).where(eq(assetAssignments.assetId, a.id)).limit(1);
  if (used) throw badRequest("It has a history of who held it. Mark it retired instead.");
  await c.get("db").delete(assets).where(eq(assets.id, a.id));
  await audit(c, { action: "assets.delete", entity: "asset", entityId: a.id, summary: `Deleted ${a.tag} ${a.name}` });
  return c.json({ ok: true });
});

/* ---------------- self-service ---------------- */

export const essAssetRoutes = new Hono<AppEnv>();
essAssetRoutes.use("*", requireEmployee);

essAssetRoutes.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select({ x: assetAssignments, a: assets })
    .from(assetAssignments)
    .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
    .where(and(eq(assetAssignments.tenantId, tid(c)), eq(assetAssignments.employeeId, c.get("tenant").employeeId!)))
    .orderBy(desc(assetAssignments.assignedOn));
  return c.json(
    rows.map(({ x, a }) => ({
      id: x.id,
      asset: { tag: a.tag, name: a.name, category: a.category, serialNumber: a.serialNumber, warrantyUntil: a.warrantyUntil },
      assignedOn: x.assignedOn,
      expectedReturn: x.expectedReturn,
      conditionOut: x.conditionOut,
      noteOut: x.noteOut,
      acknowledgedAt: x.acknowledgedAt,
      returnedOn: x.returnedOn,
      conditionIn: x.conditionIn,
      issue: x.issue,
      issueNote: x.issueNote,
    })),
  );
});

async function mine(c: Context<AppEnv>, id: string) {
  const [x] = await c.get("db").select().from(assetAssignments).where(and(eq(assetAssignments.id, id), eq(assetAssignments.employeeId, c.get("tenant").employeeId!), isNull(assetAssignments.returnedOn)));
  if (!x) throw notFound("Asset");
  const [a] = await c.get("db").select().from(assets).where(eq(assets.id, x.assetId));
  return { x, a: a! };
}

essAssetRoutes.post("/:id/acknowledge", async (c) => {
  const { x, a } = await mine(c, c.req.param("id"));
  if (x.acknowledgedAt) return c.json({ ok: true });
  await c.get("db").update(assetAssignments).set({ acknowledgedAt: new Date(), updatedAt: new Date() }).where(eq(assetAssignments.id, x.id));
  await audit(c, { action: "assets.acknowledge", entity: "asset", entityId: a.id, summary: `Confirmed receiving ${a.tag} ${a.name}` });
  return c.json({ ok: true });
});

essAssetRoutes.post("/:id/report", v("json", reportIssueSchema), async (c) => {
  const { x, a } = await mine(c, c.req.param("id"));
  const b = c.req.valid("json");
  const db = c.get("db");
  await db.update(assetAssignments).set({ issue: b.kind, issueNote: b.note, issueAt: new Date(), updatedAt: new Date() }).where(eq(assetAssignments.id, x.id));
  await audit(c, { action: "assets.report", entity: "asset", entityId: a.id, summary: `Reported ${a.tag} ${a.name}: ${ISSUE_LABEL[b.kind]}. ${b.note}` });
  // tell the people who look after assets
  try {
    const keepers = await db
      .select({ email: user.email, perms: roles.permissions })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, tid(c)), eq(memberships.status, "active")));
    const [e] = await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, x.employeeId));
    const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
    const to = [...new Set(keepers.filter((k) => (k.perms as Record<string, string[]>)?.assets?.includes("edit")).map((k) => k.email))];
    const subject = `${ISSUE_LABEL[b.kind]}: ${a.tag} ${a.name}`;
    const { html, text } = layout({ company: t?.name ?? "Strats360 People", heading: subject, paragraphs: [`${e?.name} reported a problem with ${a.name} (${a.tag}).`, b.note], cta: { label: "Open the asset", url: `${c.env.APP_URL}/assets/${a.id}` } });
    for (const addr of to) await c.get("mailer").send({ to: addr, subject, html, text });
  } catch (err) {
    console.error("asset report email failed", err);
  }
  return c.json({ ok: true });
});
