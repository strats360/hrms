import { Hono, type Context } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { branches, contractLabourMonths, contractors, contractWorkers, tenants } from "@hrms/db";
import { contractLabourChecks, contractLabourSchema, contractMonthSchema, contractWorkerSchema, todayLocal } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { rulesFor } from "../services/statutory";

/** Contract labour: contractors who supply workers, their workers, and the monthly wage and challan checks. */
export const contractLabourRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const ageOn = (dob: string | null, on: string) => (dob ? Number(on.slice(0, 4)) - Number(dob.slice(0, 4)) - (on.slice(5) < dob.slice(5) ? 1 : 0) : null);

async function loadContractor(c: Context<AppEnv>, id: string) {
  const [k] = await c.get("db").select().from(contractors).where(and(eq(contractors.id, id), eq(contractors.tenantId, tid(c))));
  if (!k) throw notFound("Contractor");
  return k;
}

contractLabourRoutes.get("/", requirePerm("compliance", "view"), async (c) => {
  const db = c.get("db");
  const today = todayLocal();
  const all = await db.select({ id: contractors.id, name: contractors.name, suppliesLabour: contractors.suppliesLabour, labourLicence: contractors.labourLicence, licenceValidUntil: contractors.licenceValidUntil, workNature: contractors.workNature, branchId: contractors.branchId, branch: branches.name, state: branches.state, contractFrom: contractors.contractFrom, contractTo: contractors.contractTo }).from(contractors).leftJoin(branches, eq(branches.id, contractors.branchId)).where(eq(contractors.tenantId, tid(c))).orderBy(asc(contractors.name));
  const labour = all.filter((k) => k.suppliesLabour);
  const ids = labour.map((k) => k.id);
  const [workers, months, [t], rules] = await Promise.all([
    ids.length ? db.select().from(contractWorkers).where(inArray(contractWorkers.contractorId, ids)) : Promise.resolve([]),
    ids.length ? db.select().from(contractLabourMonths).where(inArray(contractLabourMonths.contractorId, ids)) : Promise.resolve([]),
    db.select({ state: tenants.state }).from(tenants).where(eq(tenants.id, tid(c))),
    rulesFor(db, today.slice(0, 7)),
  ]);
  // each contractor's work site decides the minimum wage, as a daily rate on 26 working days
  const rows = labour.map((k) => {
    const mw = rules.minWage[k.state ?? t?.state ?? ""]?.monthly;
    const check = contractLabourChecks([k], workers.map((w) => ({ ...w, dailyWage: Number(w.dailyWage), age: ageOn(w.dateOfBirth, today) })), months, { today, minDailyWage: mw ? Math.round((mw / 26) * 100) / 100 : null }).rows[0]!;
    return { ...k, ...check, months: months.filter((m) => m.contractorId === k.id).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6) };
  });
  const overall = contractLabourChecks(labour, workers.map((w) => ({ ...w, dailyWage: Number(w.dailyWage) })), months, { today });
  return c.json({ rows, others: all.filter((k) => !k.suppliesLabour).map((k) => ({ id: k.id, name: k.name })), total: overall.total, peak: overall.peak, registrationNeeded: overall.registrationNeeded });
});

contractLabourRoutes.put("/contractors/:id", requirePerm("compliance", "edit"), v("json", contractLabourSchema), async (c) => {
  const k = await loadContractor(c, c.req.param("id"));
  const b = c.req.valid("json");
  await c.get("db").update(contractors).set({ ...b, updatedAt: new Date() }).where(eq(contractors.id, k.id));
  await audit(c, { action: "contract_labour.contractor", entity: "contractor", entityId: k.id, summary: b.suppliesLabour ? `${k.name} supplies contract labour${b.labourLicence ? ` (licence ${b.labourLicence})` : ""}` : `${k.name} no longer marked as supplying labour` });
  return c.json({ ok: true });
});

contractLabourRoutes.get("/contractors/:id/workers", requirePerm("compliance", "view"), async (c) => {
  const k = await loadContractor(c, c.req.param("id"));
  return c.json({ rows: await c.get("db").select().from(contractWorkers).where(eq(contractWorkers.contractorId, k.id)).orderBy(asc(contractWorkers.name)) });
});

contractLabourRoutes.post("/contractors/:id/workers", requirePerm("compliance", "edit"), v("json", contractWorkerSchema), async (c) => {
  const k = await loadContractor(c, c.req.param("id"));
  const b = c.req.valid("json");
  const [w] = await c.get("db").insert(contractWorkers).values({ ...b, tenantId: tid(c), contractorId: k.id }).returning();
  await audit(c, { action: "contract_labour.worker_add", entity: "contractor", entityId: k.id, summary: `Added contract worker ${b.name} (${k.name})` });
  return c.json(w, 201);
});

contractLabourRoutes.patch("/workers/:id", requirePerm("compliance", "edit"), v("json", contractWorkerSchema.partial()), async (c) => {
  const [w] = await c.get("db").update(contractWorkers).set({ ...c.req.valid("json"), updatedAt: new Date() }).where(and(eq(contractWorkers.id, c.req.param("id")), eq(contractWorkers.tenantId, tid(c)))).returning();
  if (!w) throw notFound("Worker");
  await audit(c, { action: "contract_labour.worker_update", entity: "contractor", entityId: w.contractorId, summary: `Updated contract worker ${w.name}` });
  return c.json(w);
});

/** The month's check: when wages were paid, and the PF and ESI challans the contractor showed. */
contractLabourRoutes.put("/contractors/:id/months", requirePerm("compliance", "edit"), v("json", contractMonthSchema), async (c) => {
  const k = await loadContractor(c, c.req.param("id"));
  const b = c.req.valid("json");
  const values = { ...b, wagesPaidOn: b.wagesPaidOn ?? null, pfChallan: b.pfChallan ?? null, esiChallan: b.esiChallan ?? null, note: b.note ?? null, checkedBy: c.get("session")!.userId };
  await c.get("db").insert(contractLabourMonths).values({ tenantId: tid(c), contractorId: k.id, ...values }).onConflictDoUpdate({ target: [contractLabourMonths.contractorId, contractLabourMonths.month], set: { ...values, updatedAt: new Date() } });
  await audit(c, { action: "contract_labour.month", entity: "contractor", entityId: k.id, summary: `${k.name} ${b.month}: ${b.workers} workers, wages ${b.wagesPaidOn ? `paid ${b.wagesPaidOn}` : "not yet confirmed"}` });
  return c.json({ ok: true });
});

/** Register of contract workers, one row per worker. */
contractLabourRoutes.get("/register.csv", requirePerm("compliance", "export"), async (c) => {
  const rows = await c
    .get("db")
    .select({ w: contractWorkers, contractor: contractors.name, licence: contractors.labourLicence, work: contractors.workNature })
    .from(contractWorkers)
    .innerJoin(contractors, eq(contractors.id, contractWorkers.contractorId))
    .where(eq(contractWorkers.tenantId, tid(c)))
    .orderBy(asc(contractors.name), asc(contractWorkers.name));
  const csv = toCsv(
    ["Contractor", "Licence", "Nature of work", "Worker", "Gender", "Date of birth", "Aadhaar (last 4)", "UAN", "ESIC IP number", "Joined", "Left", "Daily wage"],
    rows.map((r) => [r.contractor, r.licence, r.work, r.w.name, r.w.gender, r.w.dateOfBirth, r.w.aadhaarLast4, r.w.uan, r.w.esicIpNumber, r.w.joinedOn, r.w.leftOn, Number(r.w.dailyWage).toFixed(2)]),
  );
  await audit(c, { action: "contract_labour.export", entity: "contractor", summary: `Exported the register of contract workers (${rows.length})` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contract-workers.csv"' });
});
