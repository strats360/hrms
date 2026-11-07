import { and, eq, inArray, like, ne, notInArray, sql } from "drizzle-orm";
import { employees, invoices, platformSettings, plans, tenants, type Database, type InvoiceParty } from "@hrms/db";
import { billableSeats, invoiceTax, invoicingEntitySchema, stateCodeOf, todayIST } from "@hrms/shared";
import type { z } from "zod";

export type InvoicingEntity = z.infer<typeof invoicingEntitySchema>;
export type Invoice = typeof invoices.$inferSelect;

export const DEFAULT_ENTITY: InvoicingEntity = {
  legalName: "Strats360 People Technologies Pvt Ltd",
  gstin: "24AAICS7781M1ZK",
  pan: "AAICS7781M",
  address: "4th Floor, Iscon Elegance, SG Highway, Ahmedabad 380015",
  state: "Gujarat",
  sac: "998314",
  invoicePrefix: "INV-P-",
  dueDays: 7,
  bankDetails: "HDFC Bank · A/c 50200098765432 · IFSC HDFC0000123",
  upiId: "strats360people@hdfcbank",
  email: "billing@strats360people.in",
};

export async function getEntity(db: Database): Promise<InvoicingEntity> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, "invoicing"));
  return { ...DEFAULT_ENTITY, ...((row?.value ?? {}) as Partial<InvoicingEntity>) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

/** Active employees per tenant (the billable count). */
export async function activeEmployeeCounts(db: Database, tenantIds?: string[]) {
  const rows = await db
    .select({ t: employees.tenantId, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(notInArray(employees.status, ["exited", "inactive", "onboarding"]), tenantIds ? inArray(employees.tenantId, tenantIds.length ? tenantIds : ["-"]) : undefined))
    .groupBy(employees.tenantId);
  return new Map(rows.map((r) => [r.t, r.n]));
}

export interface DraftInvoice {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  planKey: string;
  planName: string;
  seats: number;
  activeEmployees: number;
  rate: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  skip: string | null;
}

/** What a billing run for a period would invoice (one line per tenant). */
export async function draftInvoices(db: Database, period: string, tenantIds?: string[]): Promise<DraftInvoice[]> {
  const entity = await getEntity(db);
  const sellerCode = stateCodeOf(entity.gstin, entity.state);
  const ts = await db.select().from(tenants).where(tenantIds ? inArray(tenants.id, tenantIds.length ? tenantIds : ["-"]) : undefined).orderBy(tenants.name);
  const ps = new Map((await db.select().from(plans)).map((p) => [p.key, p]));
  const counts = await activeEmployeeCounts(db, ts.map((t) => t.id));
  const existing = new Set((await db.select({ t: invoices.tenantId }).from(invoices).where(and(eq(invoices.period, period), ne(invoices.status, "void")))).map((r) => r.t));
  const periodEnd = `${period}-28`;
  return ts.map((t) => {
    const plan = ps.get(t.plan);
    const active = counts.get(t.id) ?? 0;
    const seats = billableSeats(active, plan?.minSeats ?? 0);
    const rate = Number(t.customPrice ?? plan?.pricePerEmployee ?? 0);
    const subtotal = Math.round(seats * rate * 100) / 100;
    const tax = invoiceTax(subtotal, sellerCode, stateCodeOf(t.gstin, t.state));
    let skip: string | null = null;
    if (existing.has(t.id)) skip = "Already invoiced for this period";
    else if (t.status === "cancelled") skip = "Cancelled";
    else if (t.status === "trial" || t.plan === "trial") skip = t.trialEndsAt ? `On trial until ${t.trialEndsAt.toISOString().slice(0, 10)}` : "On trial";
    else if (!plan) skip = `Unknown plan "${t.plan}"`;
    else if (!rate) skip = "No price: set a custom rate for this tenant";
    else if (t.createdAt.toISOString().slice(0, 10) > periodEnd) skip = "Joined after this period";
    else if (!seats) skip = "No active employees";
    return { tenantId: t.id, tenantName: t.name, tenantCode: t.code, planKey: t.plan, planName: plan?.name ?? t.plan, seats, activeEmployees: active, rate, subtotal, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, total: tax.total, skip };
  });
}

/** INV-P-2611-0001: prefix + year/month of the period + running number for that month. */
export async function nextInvoiceNumber(db: Database, prefix: string, period: string) {
  const base = `${prefix}${period.slice(2, 4)}${period.slice(5, 7)}-`;
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(substring(${invoices.number} from ${sql.raw(String(base.length + 1))})::int), 0)::int` })
    .from(invoices)
    .where(like(invoices.number, `${base}%`));
  let n = r?.n ?? 0;
  return () => `${base}${String(++n).padStart(4, "0")}`;
}

/** Issue invoices for every tenant that should be billed. */
export async function issueInvoices(db: Database, period: string, userId: string | null, opts: { tenantIds?: string[]; issuedOn?: string; status?: "issued" | "paid"; paidOn?: string } = {}) {
  const entity = await getEntity(db);
  const drafts = (await draftInvoices(db, period, opts.tenantIds)).filter((d) => !d.skip);
  if (!drafts.length) return [];
  const ts = new Map((await db.select().from(tenants).where(inArray(tenants.id, drafts.map((d) => d.tenantId)))).map((t) => [t.id, t]));
  const next = await nextInvoiceNumber(db, entity.invoicePrefix, period);
  const issuedOn = opts.issuedOn ?? todayIST();
  const seller: InvoiceParty = { name: entity.legalName, legalName: entity.legalName, gstin: entity.gstin ?? null, address: entity.address ?? null, state: entity.state ?? null, stateCode: stateCodeOf(entity.gstin, entity.state) };
  const created: Invoice[] = [];
  for (const d of drafts) {
    const t = ts.get(d.tenantId)!;
    const buyer: InvoiceParty = { name: t.name, legalName: t.legalName, gstin: t.gstin, address: t.registeredAddress, state: t.state, stateCode: stateCodeOf(t.gstin, t.state) };
    const [row] = await db
      .insert(invoices)
      .values({
        tenantId: d.tenantId,
        number: next(),
        period,
        issuedOn,
        dueOn: addDays(issuedOn, entity.dueDays),
        planKey: d.planKey,
        planName: d.planName,
        seats: d.seats,
        rate: d.rate,
        lines: [{ description: `${d.planName} plan · ${periodLabel(period)} · ${d.seats} employees${d.seats > d.activeEmployees ? ` (plan minimum, ${d.activeEmployees} active)` : ""}`, sac: entity.sac, quantity: d.seats, rate: d.rate, amount: d.subtotal }],
        subtotal: d.subtotal,
        cgst: d.cgst,
        sgst: d.sgst,
        igst: d.igst,
        total: d.total,
        seller,
        buyer,
        status: opts.status ?? "issued",
        paidOn: opts.status === "paid" ? (opts.paidOn ?? issuedOn) : null,
        paymentMethod: opts.status === "paid" ? "upi" : null,
        createdBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) created.push(row);
  }
  return created;
}

/** Invoices still unpaid after their due date. */
export async function overdueInvoices(db: Database, today = todayIST()) {
  return db
    .select({ inv: invoices, tenantName: tenants.name, tenantStatus: tenants.status, email: sql<string | null>`coalesce(${tenants.billingEmail}, ${tenants.contactEmail})` })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(and(eq(invoices.status, "issued"), sql`${invoices.dueOn} < ${today}`));
}

/** After a payment: a past-due tenant with nothing else overdue goes back to active. */
export async function restoreIfClear(db: Database, tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t || t.status !== "past_due") return false;
  const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, "issued"), sql`${invoices.dueOn} < ${todayIST()}`));
  if ((o?.n ?? 0) > 0) return false;
  await db.update(tenants).set({ status: "active" }).where(eq(tenants.id, tenantId));
  return true;
}

export const invoiceStatus = (i: Pick<Invoice, "status" | "dueOn">, today = todayIST()) => (i.status === "issued" && i.dueOn < today ? "overdue" : i.status);
