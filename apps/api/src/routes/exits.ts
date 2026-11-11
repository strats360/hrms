import { heldAssets } from "./assets";
import { Hono, type Context } from "hono";
import { sendNotification } from "../services/notifications";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { departments, designations, employeeExits, employees, memberships, paymentBatches, payments, roles, tenants, user } from "@hrms/db";
import {
  can,
  defaultNoticeDays,
  EXIT_STATUS_LABELS,
  EXIT_TYPE_LABELS,
  exitCreateSchema,
  exitUpdateSchema,
  inr,
  isoDate,
  resignationSchema,
  settlementSchema,
  todayIST,
  type ExitStatus,
  type ExitType,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { monthLabel } from "../lib/months";
import { defaultClearance, markSettled, nextExitCode, noticeSettings, settlementFor, type Exit, type SettlementInputs, type SettlementSnapshot } from "../services/exits";
import { bankInfo, loadAccount, missingBank, nextBatchCode, referenceAllocator } from "../services/payments";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const OPEN: ExitStatus[] = ["requested", "notice", "settlement"];
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

async function load(c: Context<AppEnv>, id: string) {
  const db = c.get("db");
  const [row] = await db.select({ x: employeeExits, e: employees }).from(employeeExits).innerJoin(employees, eq(employees.id, employeeExits.employeeId)).where(and(eq(employeeExits.id, id), eq(employeeExits.tenantId, tid(c))));
  if (!row) throw notFound("Exit");
  return row;
}

async function view(c: Context<AppEnv>, x: Exit, e: typeof employees.$inferSelect) {
  const db = c.get("db");
  const [meta] = await db
    .select({ department: departments.name, designation: designations.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(eq(employees.id, e.id));
  const live = x.status === "settled" || x.status === "cancelled" ? null : await settlementFor(db, x, e);
  const [payment] = x.paymentId ? await db.select({ p: payments, code: paymentBatches.code, batchId: paymentBatches.id }).from(payments).innerJoin(paymentBatches, eq(paymentBatches.id, payments.batchId)).where(eq(payments.id, x.paymentId)) : [];
  return {
    ...x,
    typeLabel: EXIT_TYPE_LABELS[x.type as ExitType] ?? x.type,
    statusLabel: EXIT_STATUS_LABELS[x.status as ExitStatus] ?? x.status,
    employee: { id: e.id, code: e.employeeCode, name: e.fullName, status: e.status, dateOfJoining: e.dateOfJoining, department: meta?.department ?? null, designation: meta?.designation ?? null, pan: e.pan, uan: e.uan, workEmail: e.workEmail },
    /** The current figures. `settlement` is what was saved (and approved). */
    preview: live,
    payment: payment ? { id: payment.p.id, reference: payment.p.reference, status: payment.p.status, amount: Number(payment.p.amount), utr: payment.p.utr, batchId: payment.batchId, batchCode: payment.code } : null,
  };
}

/** Put the exit dates on the employee record, where payroll and attendance read them. */
async function syncEmployee(c: Context<AppEnv>, x: Exit) {
  await c.get("db").update(employees).set({ status: "notice", resignationDate: x.resignationDate, lastWorkingDay: x.lastWorkingDay }).where(eq(employees.id, x.employeeId));
}

function checkDates(resignationDate: string, lastWorkingDay: string) {
  if (lastWorkingDay < resignationDate) throw badRequest("The last working day can't be before the resignation date");
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const exitRoutes = new Hono<AppEnv>();

/** Exits are HR and payroll business: viewing employees alone (managers, viewers) isn't enough. */
exitRoutes.use("*", requirePerm("employees", "view"));
exitRoutes.use("*", async (c, next) => {
  const p = c.get("tenant").permissions;
  if (!can(p, "employees", "edit") && !can(p, "payroll", "view")) throw forbidden("Exits are handled by HR and payroll");
  await next();
});

exitRoutes.get("/", requirePerm("employees", "view"), async (c) => {
  const status = c.req.query("status");
  const db = c.get("db");
  const rows = await db
    .select({ x: employeeExits, code: employees.employeeCode, name: employees.fullName, department: departments.name })
    .from(employeeExits)
    .innerJoin(employees, eq(employees.id, employeeExits.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employeeExits.tenantId, tid(c)), status === "open" ? sql`${employeeExits.status} not in ('settled','cancelled')` : status ? eq(employeeExits.status, status) : undefined))
    .orderBy(desc(employeeExits.lastWorkingDay))
    .limit(500);
  const [counts] = await db
    .select({
      requested: sql<number>`count(*) filter (where ${employeeExits.status} = 'requested')::int`,
      notice: sql<number>`count(*) filter (where ${employeeExits.status} = 'notice')::int`,
      pendingSettlement: sql<number>`count(*) filter (where ${employeeExits.status} in ('settlement','approved'))::int`,
      leavingThisMonth: sql<number>`count(*) filter (where ${employeeExits.status} not in ('settled','cancelled') and to_char(${employeeExits.lastWorkingDay}, 'YYYY-MM') = ${todayIST().slice(0, 7)})::int`,
    })
    .from(employeeExits)
    .where(eq(employeeExits.tenantId, tid(c)));
  return c.json({
    counts,
    rows: rows.map((r) => ({
      id: r.x.id,
      code: r.x.code,
      employeeId: r.x.employeeId,
      employeeCode: r.code,
      employeeName: r.name,
      department: r.department,
      type: r.x.type,
      typeLabel: EXIT_TYPE_LABELS[r.x.type as ExitType] ?? r.x.type,
      status: r.x.status,
      statusLabel: EXIT_STATUS_LABELS[r.x.status as ExitStatus] ?? r.x.status,
      resignationDate: r.x.resignationDate,
      lastWorkingDay: r.x.lastWorkingDay,
      clearanceDone: r.x.clearance.filter((i) => i.done).length,
      clearanceTotal: r.x.clearance.length,
      netAmount: r.x.netAmount === null ? null : Number(r.x.netAmount),
    })),
  });
});

exitRoutes.get("/:id", requirePerm("employees", "view"), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  const full = can(c.get("tenant").permissions, "payroll", "view");
  // money is for people with payroll access; others see the process only
  if (!full) return c.json({ ...x, settlement: null, netAmount: null, inputs: {}, preview: null, payment: null, typeLabel: EXIT_TYPE_LABELS[x.type as ExitType] ?? x.type, statusLabel: EXIT_STATUS_LABELS[x.status as ExitStatus] ?? x.status, employee: { id: e.id, code: e.employeeCode, name: e.fullName, status: e.status, dateOfJoining: e.dateOfJoining } });
  return c.json({ ...(await view(c, x, e)), heldAssets: await heldAssets(c.get("db"), tid(c), e.id) });
});

/** Start an exit (HR): resignation received, termination, retirement... */
exitRoutes.post("/", requirePerm("employees", "edit"), v("json", exitCreateSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  if (e.status === "exited" || e.status === "inactive") throw badRequest(`${e.fullName} has already left`);
  checkDates(b.resignationDate, b.lastWorkingDay);
  if (b.lastWorkingDay < e.dateOfJoining) throw badRequest("The last working day can't be before the date of joining");
  const [open] = await db.select({ code: employeeExits.code }).from(employeeExits).where(and(eq(employeeExits.employeeId, e.id), sql`${employeeExits.status} not in ('settled','cancelled')`));
  if (open) throw conflict(`${e.fullName} already has an open exit (${open.code})`);
  const noticeDays = b.noticeDays ?? defaultNoticeDays(e.status, await noticeSettings(db, tid(c)));
  const [x] = await db
    .insert(employeeExits)
    .values({ tenantId: tid(c), code: await nextExitCode(db, tid(c)), employeeId: e.id, type: b.type, status: "notice", previousStatus: e.status, reason: b.reason ?? null, resignationDate: b.resignationDate, lastWorkingDay: b.lastWorkingDay, noticeDays, noticeWaived: b.noticeWaived, payInLieu: b.payInLieu, clearance: defaultClearance(), createdBy: uid(c) })
    .returning();
  await syncEmployee(c, x!);
  await audit(c, { action: "exit.create", entity: "employee_exit", entityId: x!.id, summary: `Started ${EXIT_TYPE_LABELS[b.type].toLowerCase()} for ${e.fullName} (${e.employeeCode}), last working day ${b.lastWorkingDay}` });
  return c.json(x, 201);
});

/** Accept a resignation an employee submitted, fixing the last working day. */
exitRoutes.post("/:id/accept", requirePerm("employees", "edit"), v("json", z.object({ lastWorkingDay: isoDate, noticeWaived: z.boolean().default(false), noticeDays: z.coerce.number().int().min(0).max(180).optional() })), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "requested") throw badRequest("Only a requested resignation can be accepted");
  const b = c.req.valid("json");
  checkDates(x.resignationDate, b.lastWorkingDay);
  const [row] = await c.get("db").update(employeeExits).set({ status: "notice", lastWorkingDay: b.lastWorkingDay, noticeWaived: b.noticeWaived, noticeDays: b.noticeDays ?? x.noticeDays }).where(and(eq(employeeExits.id, x.id), eq(employeeExits.status, "requested"))).returning();
  if (!row) throw badRequest("This resignation changed. Reload and try again.");
  await syncEmployee(c, row);
  await audit(c, { action: "exit.accept", entity: "employee_exit", entityId: x.id, summary: `Accepted ${e.fullName}'s resignation, last working day ${b.lastWorkingDay}` });
  await mailEmployee(c, e, `Your resignation has been accepted`, [`Your last working day is ${fmt(b.lastWorkingDay)}.${b.noticeWaived ? " The remaining notice period has been waived." : ""}`, "HR will take you through the exit checklist and your full and final settlement."]);
  return c.json(row);
});

exitRoutes.patch("/:id", requirePerm("employees", "edit"), vPatch(exitUpdateSchema), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (!OPEN.includes(x.status as ExitStatus)) throw badRequest("An approved or closed exit can't be changed. Reopen the settlement first.");
  const b = c.req.valid("json");
  const next = { ...x, ...Object.fromEntries(Object.entries(b).filter(([, val]) => val !== undefined)) } as Exit;
  checkDates(next.resignationDate, next.lastWorkingDay);
  // the figures depend on these, so a drafted settlement has to be redone
  const redo = x.status === "settlement" && ["type", "resignationDate", "lastWorkingDay", "noticeDays", "noticeWaived", "payInLieu"].some((k) => k in b && (b as Record<string, unknown>)[k] !== (x as Record<string, unknown>)[k]);
  const [row] = await c
    .get("db")
    .update(employeeExits)
    .set({ type: next.type, reason: next.reason, resignationDate: next.resignationDate, lastWorkingDay: next.lastWorkingDay, noticeDays: next.noticeDays, noticeWaived: next.noticeWaived, payInLieu: next.payInLieu, ...(redo ? { status: "notice", settlement: null, netAmount: null, preparedBy: null, preparedAt: null } : {}) })
    .where(eq(employeeExits.id, x.id))
    .returning();
  if (x.status !== "requested") await syncEmployee(c, row!);
  await audit(c, { action: "exit.update", entity: "employee_exit", entityId: x.id, summary: `Updated ${e.fullName}'s exit${redo ? "; the settlement needs to be drafted again" : ""}`, data: b });
  return c.json(row);
});

exitRoutes.post("/:id/clearance", requirePerm("employees", "edit"), v("json", z.object({ key: z.string().min(1), done: z.boolean(), note: z.string().trim().max(300).nullable().optional() })), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status === "settled" || x.status === "cancelled") throw badRequest("This exit is closed");
  const b = c.req.valid("json");
  const items = x.clearance.map((i) => (i.key === b.key ? { ...i, done: b.done, note: b.note ?? i.note ?? null, doneBy: b.done ? c.get("session")!.name : null, doneAt: b.done ? new Date().toISOString() : null } : i));
  if (!x.clearance.some((i) => i.key === b.key)) throw notFound("Checklist item");
  if (b.key === "assets" && b.done) {
    const held = await heldAssets(c.get("db"), tid(c), e.id);
    if (held.length) throw badRequest(`${e.fullName} still has ${held.map((h) => `${h.name} (${h.tag})`).join(", ")}. Record them as returned in Assets first.`);
  }
  const [row] = await c.get("db").update(employeeExits).set({ clearance: items }).where(eq(employeeExits.id, x.id)).returning();
  const label = x.clearance.find((i) => i.key === b.key)!.label;
  await audit(c, { action: "exit.clearance", entity: "employee_exit", entityId: x.id, summary: `${b.done ? "Cleared" : "Reopened"} "${label}" for ${e.fullName}` });
  return c.json(row);
});

/** Live figures for the settlement editor, without saving. */
exitRoutes.post("/:id/settlement/preview", requirePerm("payroll", "edit"), v("json", settlementSchema), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  const b = c.req.valid("json");
  return c.json(await settlementFor(c.get("db"), { ...x, inputs: b as unknown as Record<string, unknown> }, e));
});

/** Draft (or redraft) the settlement statement. */
exitRoutes.put("/:id/settlement", requirePerm("payroll", "edit"), v("json", settlementSchema), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "notice" && x.status !== "settlement") throw badRequest(x.status === "requested" ? "Accept the resignation first" : "The settlement is already approved. Reopen it to make changes.");
  const b = c.req.valid("json");
  const inputs: SettlementInputs = { manual: b.manual, tds: b.tds, encashDays: b.encashDays, notes: b.notes ?? null };
  const s = await settlementFor(c.get("db"), { ...x, inputs: inputs as Record<string, unknown> }, e);
  const snapshot: SettlementSnapshot = { ...s.result, leave: s.leave.map(({ leaveTypeId, name, days }) => ({ leaveTypeId, name, days })), structure: s.structure, computedAt: new Date().toISOString() };
  const [row] = await c
    .get("db")
    .update(employeeExits)
    .set({ status: "settlement", inputs: inputs as Record<string, unknown>, settlement: snapshot as unknown as Record<string, unknown>, netAmount: s.result.net, preparedBy: uid(c), preparedAt: new Date() })
    .where(and(eq(employeeExits.id, x.id), eq(employeeExits.status, x.status)))
    .returning();
  if (!row) throw badRequest("This exit changed. Reload and try again.");
  await audit(c, { action: "exit.settlement_draft", entity: "employee_exit", entityId: x.id, summary: `Drafted the full and final settlement for ${e.fullName}: net ${inr(s.result.net)}` });
  return c.json({ ...row, warnings: s.warnings });
});

/** Approve. Maker-checker, like payroll: whoever drafted it can't approve, unless they're a super admin. */
exitRoutes.post("/:id/approve", requirePerm("payroll", "approve"), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "settlement") throw badRequest(x.status === "approved" ? "Already approved" : "Draft the settlement first");
  const t = c.get("tenant");
  if (x.preparedBy === uid(c) && !(can(t.permissions, "users", "configure") && can(t.permissions, "payroll", "configure"))) throw forbidden("Someone other than the person who drafted this settlement must approve it");
  if (x.lastWorkingDay > todayIST()) throw badRequest(`Approve the settlement on or after the last working day (${fmt(x.lastWorkingDay)})`);
  const pending = x.clearance.filter((i) => !i.done);
  if (pending.length) throw badRequest(`Finish the exit checklist first: ${pending.map((i) => i.label).join("; ")}`);
  // the figures must still be what was drafted (leave, salary or dates may have moved)
  const live = await settlementFor(c.get("db"), x, e);
  if (Math.abs(live.result.net - Number(x.netAmount)) > 0.5) throw conflict(`The figures have changed since the settlement was drafted (now ${inr(live.result.net)}, drafted ${inr(Number(x.netAmount))}). Save the settlement again, then approve.`);
  const fp = live.finalPayroll;
  if (fp && fp.status !== "approved" && fp.status !== "paid") throw badRequest(`Approve the ${monthLabel(fp.month)} payroll first. It pays the last month's salary.`);
  const [row] = await c.get("db").update(employeeExits).set({ status: "approved", approvedBy: uid(c), approvedAt: new Date() }).where(and(eq(employeeExits.id, x.id), eq(employeeExits.status, "settlement"))).returning();
  if (!row) throw badRequest("This exit changed. Reload and try again.");
  await audit(c, { action: "exit.settlement_approve", entity: "employee_exit", entityId: x.id, summary: `Approved the full and final settlement for ${e.fullName}: net ${inr(Number(x.netAmount))}` });
  return c.json(row);
});

exitRoutes.post("/:id/reopen", requirePerm("payroll", "approve"), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "approved") throw badRequest("Only an approved settlement can be reopened");
  if (x.paymentId) {
    const [p] = await c.get("db").select({ status: payments.status }).from(payments).where(eq(payments.id, x.paymentId));
    if (p && p.status !== "cancelled") throw badRequest("The settlement is in a payment batch. Cancel that payment first.");
  }
  const [row] = await c.get("db").update(employeeExits).set({ status: "settlement", approvedBy: null, approvedAt: null, paymentId: null }).where(eq(employeeExits.id, x.id)).returning();
  await audit(c, { action: "exit.settlement_reopen", entity: "employee_exit", entityId: x.id, summary: `Reopened the full and final settlement for ${e.fullName}` });
  return c.json(row);
});

/** Pay an approved settlement through a one-line "other" payment batch, so it goes out with the bank file. */
exitRoutes.post("/:id/pay", requirePerm("payments", "edit"), v("json", z.object({ bankAccountId: z.string().min(1, "Pick the debit account"), paymentDate: isoDate })), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "approved") throw badRequest("Approve the settlement first");
  const net = Number(x.netAmount);
  if (!(net > 0)) throw badRequest(net < 0 ? "The employee owes the company. Record the recovery with Mark settled." : "Nothing to pay. Use Mark settled.");
  const db = c.get("db");
  if (x.paymentId) {
    const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, x.paymentId));
    if (p && p.status !== "cancelled") throw conflict("This settlement is already in a payment batch");
  }
  const b = c.req.valid("json");
  const account = await loadAccount(db, tid(c), b.bankAccountId);
  if (!account || !account.active) throw badRequest("Pick an active debit account");
  const info = (await bankInfo(db, tid(c), [e.id])).get(e.id);
  const held = missingBank(info);
  if (held) throw badRequest(`${held} for ${e.fullName}. Fix the bank details, or pay another way and use Mark settled.`);
  const code = await nextBatchCode(db, tid(c), "other", b.paymentDate);
  const [batch] = await db
    .insert(paymentBatches)
    .values({ tenantId: tid(c), code, type: "other", label: `Full & final · ${e.fullName}`.slice(0, 80), bankAccountId: account.id, fileFormat: account.fileFormat, paymentDate: b.paymentDate, notes: `${x.code} full and final settlement`, createdBy: uid(c) })
    .returning();
  const ref = await referenceAllocator(db, tid(c), "other", b.paymentDate);
  const [pay] = await db
    .insert(payments)
    .values({ tenantId: tid(c), batchId: batch!.id, employeeId: e.id, reference: ref(), amount: net, description: "Full and final settlement", beneficiaryName: info!.holder ?? info!.name, bankName: info!.bankName, ifsc: info!.ifsc, accountLast4: info!.last4, status: "pending" })
    .returning();
  await db.update(employeeExits).set({ paymentId: pay!.id }).where(eq(employeeExits.id, x.id));
  await audit(c, { action: "exit.settlement_pay", entity: "employee_exit", entityId: x.id, summary: `Created ${code} to pay ${e.fullName}'s full and final settlement (${inr(net)})` });
  return c.json({ batchId: batch!.id, batchCode: code, paymentId: pay!.id }, 201);
});

/** Close an approved settlement paid outside a batch (cheque, recovery from the employee, nothing due). */
exitRoutes.post("/:id/settle", requirePerm("payroll", "approve"), v("json", z.object({ settledOn: isoDate, method: z.enum(["bank_transfer", "cheque", "cash", "recovered", "nothing_due"]), reference: z.string().trim().max(80).nullable().optional() })), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (x.status !== "approved") throw badRequest("Approve the settlement first");
  if (x.paymentId) {
    const [p] = await c.get("db").select({ status: payments.status }).from(payments).where(eq(payments.id, x.paymentId));
    if (p && p.status !== "cancelled") throw badRequest("This settlement is in a payment batch. It closes when that payment is marked paid.");
  }
  const b = c.req.valid("json");
  const row = await markSettled(c.get("db"), x, { on: b.settledOn, method: b.method, reference: b.reference ?? null });
  if (!row) throw badRequest("This exit changed. Reload and try again.");
  await audit(c, { action: "exit.settled", entity: "employee_exit", entityId: x.id, summary: `Closed ${e.fullName}'s full and final settlement (${b.method.replace(/_/g, " ")}${b.reference ? ` ${b.reference}` : ""}, net ${inr(Number(x.netAmount))})` });
  return c.json(row);
});

/** Withdraw an exit (resignation withdrawn, termination reversed). The employee goes back to their earlier status. */
exitRoutes.post("/:id/cancel", requirePerm("employees", "edit"), v("json", z.object({ reason: z.string().trim().min(3).max(300) })), async (c) => {
  const { x, e } = await load(c, c.req.param("id"));
  if (!OPEN.includes(x.status as ExitStatus)) throw badRequest(x.status === "approved" ? "Reopen the settlement before withdrawing the exit" : "This exit is closed");
  const db = c.get("db");
  const [row] = await db.update(employeeExits).set({ status: "cancelled", cancelReason: c.req.valid("json").reason }).where(and(eq(employeeExits.id, x.id), eq(employeeExits.status, x.status))).returning();
  if (!row) throw badRequest("This exit changed. Reload and try again.");
  if (x.status !== "requested") await db.update(employees).set({ status: x.previousStatus && x.previousStatus !== "notice" ? x.previousStatus : "active", resignationDate: null, lastWorkingDay: null }).where(eq(employees.id, e.id));
  await audit(c, { action: "exit.cancel", entity: "employee_exit", entityId: x.id, summary: `Withdrew ${e.fullName}'s exit: ${c.req.valid("json").reason}` });
  if (x.status === "requested") await mailEmployee(c, e, "About your resignation", [`HR has closed your resignation request: ${c.req.valid("json").reason}`]);
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Employee self-service: resign, see progress, withdraw before HR accepts
// ---------------------------------------------------------------------------
export const essExitRoutes = new Hono<AppEnv>();
essExitRoutes.use("/exit", requireEmployee);
essExitRoutes.use("/resignation/*", requireEmployee);
essExitRoutes.use("/resignation", requireEmployee);
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

essExitRoutes.get("/exit", async (c) => {
  const [x] = await c.get("db").select().from(employeeExits).where(and(eq(employeeExits.employeeId, me(c)), ne(employeeExits.status, "cancelled"))).orderBy(desc(employeeExits.createdAt)).limit(1);
  if (!x) return c.json({ exit: null });
  const snap = x.status === "settled" || x.status === "approved" ? (x.settlement as SettlementSnapshot | null) : null;
  return c.json({
    exit: {
      id: x.id,
      code: x.code,
      type: x.type,
      typeLabel: EXIT_TYPE_LABELS[x.type as ExitType] ?? x.type,
      status: x.status,
      statusLabel: EXIT_STATUS_LABELS[x.status as ExitStatus] ?? x.status,
      resignationDate: x.resignationDate,
      lastWorkingDay: x.lastWorkingDay,
      noticeDays: x.noticeDays,
      clearance: x.clearance.map(({ label, done }) => ({ label, done })),
      settlement: snap ? { lines: snap.lines, earnings: snap.earnings, deductions: snap.deductions, net: snap.net } : null,
      settledOn: x.settledOn,
    },
  });
});

essExitRoutes.post("/resignation", v("json", resignationSchema), async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const db = c.get("db");
  const [e] = await db.select().from(employees).where(eq(employees.id, me(c)));
  if (!e) throw notFound("Employee");
  const [open] = await db.select({ code: employeeExits.code }).from(employeeExits).where(and(eq(employeeExits.employeeId, e.id), sql`${employeeExits.status} not in ('settled','cancelled')`));
  if (open) throw conflict("You already have a resignation in progress");
  const today = todayIST();
  const noticeDays = defaultNoticeDays(e.status, await noticeSettings(db, e.tenantId));
  const lwd = c.req.valid("json").proposedLastDay ?? addDays(today, Math.max(0, noticeDays - 1));
  checkDates(today, lwd);
  const [x] = await db
    .insert(employeeExits)
    .values({ tenantId: e.tenantId, code: await nextExitCode(db, e.tenantId), employeeId: e.id, type: "resignation", status: "requested", previousStatus: e.status, reason: c.req.valid("json").reason, resignationDate: today, lastWorkingDay: lwd, noticeDays, clearance: defaultClearance(), createdBy: uid(c) })
    .returning();
  await audit(c, { action: "exit.resign", entity: "employee_exit", entityId: x!.id, summary: `${e.fullName} submitted a resignation (proposed last day ${lwd})` });
  await notifyHr(c, e, lwd);
  return c.json(x, 201);
});

essExitRoutes.post("/resignation/withdraw", async (c) => {
  if (c.get("tenant").readOnly) throw forbidden("Read-only support view");
  const db = c.get("db");
  const [row] = await db.update(employeeExits).set({ status: "cancelled", cancelReason: "Withdrawn by the employee" }).where(and(eq(employeeExits.employeeId, me(c)), eq(employeeExits.status, "requested"))).returning();
  if (!row) throw badRequest("Only a resignation HR hasn't accepted yet can be withdrawn here. Talk to HR.");
  await audit(c, { action: "exit.withdraw", entity: "employee_exit", entityId: row.id, summary: "Resignation withdrawn by the employee" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

async function companyName(c: Context<AppEnv>) {
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  return t?.name ?? "Your company";
}

async function mailEmployee(c: Context<AppEnv>, e: typeof employees.$inferSelect, subject: string, paragraphs: string[]) {
  try {
    const to = e.personalEmail ?? e.workEmail;
    const { html, text } = layout({ company: await companyName(c), heading: subject, paragraphs, cta: { label: "Open self-service", url: `${c.env.APP_URL}/me/profile` } });
    await sendNotification(c, "exit_updates", { to, subject, html, text });
  } catch (err) {
    console.error("exit email failed", err);
  }
}

/** Tell the manager and HR admins that a resignation came in. */
async function notifyHr(c: Context<AppEnv>, e: typeof employees.$inferSelect, lwd: string) {
  try {
    const db = c.get("db");
    const to = new Set<string>();
    if (e.managerId) {
      const [m] = await db.select({ email: employees.workEmail }).from(employees).where(eq(employees.id, e.managerId));
      if (m) to.add(m.email);
    }
    const admins = await db
      .select({ email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, e.tenantId), eq(memberships.status, "active"), inArray(roles.key, ["super_admin", "hr_admin"])))
      .limit(10);
    for (const a of admins) to.add(a.email);
    const { html, text } = layout({ company: await companyName(c), heading: `${e.fullName} has resigned`, paragraphs: [`${e.fullName} (${e.employeeCode}) submitted a resignation today, with a proposed last working day of ${fmt(lwd)}.`, "Review it and confirm the last working day under Employees › Exits."], cta: { label: "Review resignation", url: `${c.env.APP_URL}/employees/exits` } });
    for (const addr of to) await sendNotification(c, "resignation_submitted", { to: addr, subject: `Resignation: ${e.fullName}`, html, text });
  } catch (err) {
    console.error("resignation email failed", err);
  }
}
