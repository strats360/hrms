import { Hono, type Context } from "hono";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { invoices, memberships, platformSettings, plans, tenants } from "@hrms/db";
import { billingRunSchema, DEFAULT_DUNNING, dunningStage, inr, invoicePaymentSchema, invoicingEntitySchema, planSchema, STATE_BY_CODE, tenantBillingSchema, todayIST } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm, requirePlatform } from "../lib/context";
import { v, vPatch } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { layout } from "../lib/email";
import { attemptsFor } from "../services/online-payments";
import { activeMandate, AUTOPAY_GATEWAY, clearRetries, methodLabel, scheduleAutopay } from "../services/autopay";
import { cashfreeConfig } from "../services/cashfree";
import { activeEmployeeCounts, daysBetween, draftInvoices, getEntity, invoiceStatus, issueInvoices, overdueInvoices, periodLabel, restoreIfClear, type Invoice } from "../services/billing";

const uid = (c: Context<AppEnv>) => c.get("session")!.userId;
const shape = (i: Invoice, tenantName?: string) => ({ ...i, tenantName: tenantName ?? i.buyer.name, displayStatus: invoiceStatus(i), periodLabel: periodLabel(i.period) });

async function emailInvoice(c: Context<AppEnv>, inv: Invoice, kind: "issued" | "reminder") {
  try {
    const [t] = await c.get("db").select().from(tenants).where(eq(tenants.id, inv.tenantId));
    const to = t?.billingEmail ?? t?.contactEmail;
    if (!t || !to) return false;
    const entity = await getEntity(c.get("db"));
    const overdue = daysBetween(inv.dueOn, todayIST());
    const { html, text } = layout({
      company: entity.legalName,
      heading: kind === "issued" ? `Invoice ${inv.number} for ${periodLabel(inv.period)}` : `Payment reminder: ${inv.number}`,
      paragraphs: [
        `Hello ${t.name} team,`,
        kind === "issued"
          ? `Your invoice for ${periodLabel(inv.period)} is ${inr(Number(inv.total))} (${inv.seats} employees on the ${inv.planName} plan, GST included). It's due on ${inv.dueOn}.`
          : `Invoice ${inv.number} for ${inr(Number(inv.total))} was due on ${inv.dueOn}${overdue > 0 ? ` and is ${overdue} day${overdue === 1 ? "" : "s"} overdue` : ""}. Please pay to keep your account active.`,
        ...(kind === "issued" && (await activeMandate(c.get("db"), inv.tenantId)) ? ["It will be collected by autopay after your bank's pre-debit notice, unless it's above your autopay limit."] : []),
        ...(entity.upiId ? [`Pay by UPI to ${entity.upiId}${entity.bankDetails ? ` or by bank transfer: ${entity.bankDetails}` : ""}. Quote ${inv.number} as the reference.`] : []),
      ],
      cta: cashfreeConfig(c.env) ? { label: "Pay online", url: `${c.env.APP_URL}/settings/billing?pay=${inv.id}` } : { label: "View invoice", url: `${c.env.APP_URL}/settings/billing` },
    });
    await c.get("mailer").send({ to, subject: kind === "issued" ? `Invoice ${inv.number} · ${inr(Number(inv.total))}` : `Reminder: invoice ${inv.number} is overdue`, html, text });
    return true;
  } catch (err) {
    console.error("invoice email failed", err);
    return false;
  }
}

// ===========================================================================
// Platform console
// ===========================================================================
export const platformBillingRoutes = new Hono<AppEnv>();
platformBillingRoutes.use("*", requirePlatform());
const finance = requirePlatform("super_admin", "finance");

// ---- plans ----
platformBillingRoutes.get("/plans", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name));
  const counts = await db.select({ plan: tenants.plan, n: sql<number>`count(*)::int` }).from(tenants).where(ne(tenants.status, "cancelled")).groupBy(tenants.plan);
  return c.json(rows.map((p) => ({ ...p, tenants: counts.find((x) => x.plan === p.key)?.n ?? 0 })));
});
platformBillingRoutes.post("/plans", requirePlatform("super_admin"), v("json", planSchema), async (c) => {
  const [row] = await c.get("db").insert(plans).values(c.req.valid("json")).returning();
  await audit(c, { tenantId: null, action: "platform.plan_create", entity: "plan", entityId: row!.id, summary: `Added plan ${row!.name}` });
  return c.json(row, 201);
});
platformBillingRoutes.patch("/plans/:id", requirePlatform("super_admin"), vPatch(planSchema.omit({ key: true }).partial()), async (c) => {
  const [row] = await c.get("db").update(plans).set(c.req.valid("json")).where(eq(plans.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Plan");
  await audit(c, { tenantId: null, action: "platform.plan_update", entity: "plan", entityId: row.id, summary: `Updated plan ${row.name}`, data: c.req.valid("json") });
  return c.json(row);
});

// ---- invoicing entity ----
platformBillingRoutes.get("/settings", async (c) => c.json({ entity: await getEntity(c.get("db")), dunning: DEFAULT_DUNNING }));
platformBillingRoutes.put("/settings", requirePlatform("super_admin"), v("json", invoicingEntitySchema), async (c) => {
  const value = c.req.valid("json");
  await c.get("db").insert(platformSettings).values({ key: "invoicing", value, updatedBy: uid(c) }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: uid(c), updatedAt: new Date() } });
  await audit(c, { tenantId: null, action: "platform.invoicing_entity", entity: "platform_settings", entityId: "invoicing", summary: `Updated the invoicing entity (${value.legalName})` });
  return c.json({ entity: value });
});

// ---- tenant billing fields ----
platformBillingRoutes.patch("/tenants/:id", finance, vPatch(tenantBillingSchema), async (c) => {
  const b = c.req.valid("json");
  if (b.plan && b.plan !== "trial") {
    const [p] = await c.get("db").select().from(plans).where(eq(plans.key, b.plan));
    if (!p) throw badRequest("Unknown plan");
  }
  const [row] = await c.get("db").update(tenants).set(b).where(eq(tenants.id, c.req.param("id"))).returning();
  if (!row) throw notFound("Tenant");
  await audit(c, { tenantId: null, action: "platform.tenant_billing", entity: "tenant", entityId: row.id, summary: `Billing for ${row.name}: ${Object.entries(b).map(([k, x]) => `${k}=${x}`).join(", ")}` });
  return c.json(row);
});

// ---- summary and invoices ----
platformBillingRoutes.get("/summary", v("query", z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() })), async (c) => {
  const db = c.get("db");
  const today = todayIST();
  const [latest] = await db.select({ p: sql<string>`max(${invoices.period})` }).from(invoices).where(ne(invoices.status, "void"));
  const period = c.req.valid("query").period ?? latest?.p ?? today.slice(0, 7);
  const [s] = await db
    .select({
      count: sql<number>`count(*)::int`,
      invoiced: sql<number>`coalesce(sum(${invoices.total}),0)::float`,
      collected: sql<number>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'paid'),0)::float`,
      gst: sql<number>`coalesce(sum(${invoices.cgst} + ${invoices.sgst} + ${invoices.igst}),0)::float`,
    })
    .from(invoices)
    .where(and(eq(invoices.period, period), ne(invoices.status, "void")));
  const overdue = await overdueInvoices(db, today);
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return c.json({
    period,
    periodLabel: periodLabel(period),
    invoices: s?.count ?? 0,
    invoiced: s?.invoiced ?? 0,
    collected: s?.collected ?? 0,
    collectionRate: s?.invoiced ? Math.round(((s.collected ?? 0) / s.invoiced) * 1000) / 10 : 0,
    gstPayable: s?.gst ?? 0,
    gstDue: `${next}-20`,
    overdue: { amount: overdue.reduce((a, o) => a + Number(o.inv.total), 0), tenants: new Set(overdue.map((o) => o.inv.tenantId)).size, invoices: overdue.length },
  });
});

const listQ = z.object({ period: z.string().optional(), status: z.string().optional(), q: z.string().optional(), tenantId: z.string().optional() });
platformBillingRoutes.get("/invoices", v("query", listQ), async (c) => {
  const q = c.req.valid("query");
  const conds: SQL[] = [];
  if (q.period) conds.push(eq(invoices.period, q.period));
  if (q.tenantId) conds.push(eq(invoices.tenantId, q.tenantId));
  if (q.status === "overdue") conds.push(eq(invoices.status, "issued"), sql`${invoices.dueOn} < ${todayIST()}`);
  else if (q.status) conds.push(inArray(invoices.status, q.status.split(",")));
  if (q.q) conds.push(or(ilike(tenants.name, `%${q.q}%`), ilike(invoices.number, `%${q.q}%`), ilike(tenants.gstin, `%${q.q}%`))!);
  const rows = await c.get("db").select({ inv: invoices, name: tenants.name }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(invoices.period), asc(invoices.number)).limit(2000);
  return c.json(rows.map((r) => shape(r.inv, r.name)));
});
platformBillingRoutes.get("/invoices/:id", async (c) => {
  const [r] = await c.get("db").select({ inv: invoices, name: tenants.name }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId)).where(eq(invoices.id, c.req.param("id")));
  if (!r) throw notFound("Invoice");
  const m = await activeMandate(c.get("db"), r.inv.tenantId);
  return c.json({ ...shape(r.inv, r.name), entity: await getEntity(c.get("db")), onlinePayments: await attemptsFor(c.get("db"), r.inv.id), autopay: m ? { label: methodLabel(m), maxAmount: Number(m.maxAmount) } : null });
});

/** Charge an unpaid invoice against the tenant's autopay mandate (e.g. after a failure, once the bank is sorted). */
platformBillingRoutes.post("/invoices/:id/autopay", finance, async (c) => {
  const cfg = cashfreeConfig(c.env);
  if (!cfg) throw badRequest("Cashfree isn't configured");
  const [inv] = await c.get("db").select().from(invoices).where(eq(invoices.id, c.req.param("id")));
  if (!inv) throw notFound("Invoice");
  // a manual charge after a failed debit takes the place of its automatic retry
  const failed = (await attemptsFor(c.get("db"), inv.id)).find((a) => a.gateway === AUTOPAY_GATEWAY && a.status === "failed");
  const r = await scheduleAutopay(c.get("db"), cfg, inv, uid(c), { retryOf: failed?.id });
  if (!r.scheduled) throw badRequest(r.reason);
  await clearRetries(c.get("db"), { invoiceId: inv.id });
  await audit(c, { tenantId: inv.tenantId, action: "platform.autopay_charge", entity: "invoice", entityId: inv.id, summary: `Scheduled an autopay charge for ${inv.number}` });
  return c.json({ scheduledFor: r.attempt.scheduledFor, orderId: r.attempt.orderId });
});

platformBillingRoutes.get("/gateway", async (c) => {
  const cfg = cashfreeConfig(c.env);
  return c.json({ provider: "cashfree", configured: !!cfg, mode: cfg?.mode ?? null, apiVersion: cfg?.apiVersion ?? null, webhookUrl: `${c.env.APP_URL}/api/public/payments/cashfree/webhook` });
});

// ---- billing run ----
platformBillingRoutes.post("/run/preview", finance, v("json", billingRunSchema), async (c) => {
  const b = c.req.valid("json");
  const drafts = await draftInvoices(c.get("db"), b.period, b.tenantIds);
  const bill = drafts.filter((d) => !d.skip);
  return c.json({ period: b.period, periodLabel: periodLabel(b.period), drafts, count: bill.length, subtotal: bill.reduce((s, d) => s + d.subtotal, 0), total: bill.reduce((s, d) => s + d.total, 0) });
});
platformBillingRoutes.post("/run", finance, v("json", billingRunSchema), async (c) => {
  const b = c.req.valid("json");
  if (b.period >= todayIST().slice(0, 7)) throw badRequest("Bill a month after it ends. The current month can be billed from the 1st of next month.");
  const created = await issueInvoices(c.get("db"), b.period, uid(c), { tenantIds: b.tenantIds });
  let emailed = 0;
  let autopay = 0;
  const cfg = cashfreeConfig(c.env);
  for (const inv of created) {
    // charge tenants with an active mandate (debited after the bank's pre-debit notice)
    if (cfg && (await scheduleAutopay(c.get("db"), cfg, inv, uid(c))).scheduled) autopay++;
    if (await emailInvoice(c, inv, "issued")) emailed++;
  }
  await audit(c, { tenantId: null, action: "platform.billing_run", entity: "invoice", summary: `Billing run for ${periodLabel(b.period)}: ${created.length} invoices, ${inr(created.reduce((s, i) => s + Number(i.total), 0))}` });
  return c.json({ created: created.length, emailed, autopay, total: created.reduce((s, i) => s + Number(i.total), 0) }, 201);
});

// ---- payments, voids, reminders ----
platformBillingRoutes.post("/invoices/:id/payment", finance, v("json", invoicePaymentSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [row] = await db.update(invoices).set({ status: "paid", paidOn: b.paidOn, paymentMethod: b.method, paymentReference: b.reference ?? null }).where(and(eq(invoices.id, c.req.param("id")), eq(invoices.status, "issued"))).returning();
  if (!row) throw badRequest("Only an unpaid invoice can be marked paid");
  const restored = await restoreIfClear(db, row.tenantId);
  await audit(c, { tenantId: row.tenantId, action: "platform.invoice_paid", entity: "invoice", entityId: row.id, summary: `Recorded payment for ${row.number} (${inr(Number(row.total))}, ${b.method}${b.reference ? ` ${b.reference}` : ""})${restored ? "; account restored" : ""}` });
  return c.json({ ...shape(row), restored });
});
platformBillingRoutes.post("/invoices/:id/void", requirePlatform("super_admin"), v("json", z.object({ reason: z.string().trim().min(3).max(300) })), async (c) => {
  const [row] = await c.get("db").update(invoices).set({ status: "void", voidReason: c.req.valid("json").reason }).where(and(eq(invoices.id, c.req.param("id")), eq(invoices.status, "issued"))).returning();
  if (!row) throw badRequest("Only an unpaid invoice can be voided. Issue a credit note for paid invoices.");
  await restoreIfClear(c.get("db"), row.tenantId);
  await audit(c, { tenantId: row.tenantId, action: "platform.invoice_void", entity: "invoice", entityId: row.id, summary: `Voided ${row.number}`, data: c.req.valid("json") });
  return c.json(shape(row));
});
platformBillingRoutes.post("/invoices/:id/remind", finance, async (c) => {
  const [inv] = await c.get("db").select().from(invoices).where(eq(invoices.id, c.req.param("id")));
  if (!inv || inv.status !== "issued") throw badRequest("Only an unpaid invoice can be chased");
  if (!(await emailInvoice(c, inv, "reminder"))) throw badRequest("This tenant has no billing or contact email");
  await c.get("db").update(invoices).set({ remindersSent: inv.remindersSent + 1, lastReminderAt: new Date() }).where(eq(invoices.id, inv.id));
  await audit(c, { tenantId: inv.tenantId, action: "platform.invoice_reminder", entity: "invoice", entityId: inv.id, summary: `Sent a payment reminder for ${inv.number}` });
  return c.json({ ok: true });
});

// ---- dunning ----
async function dunningPlan(c: Context<AppEnv>) {
  const today = todayIST();
  const rows = await overdueInvoices(c.get("db"), today);
  return rows.map((r) => {
    const days = daysBetween(r.inv.dueOn, today);
    const st = dunningStage(days, r.inv.remindersSent);
    const action = st.suspend && r.tenantStatus !== "suspended" ? "suspend" : st.pastDue && r.tenantStatus === "active" ? "past_due" : st.remind ? "remind" : null;
    return { invoiceId: r.inv.id, number: r.inv.number, tenantId: r.inv.tenantId, tenantName: r.tenantName, tenantStatus: r.tenantStatus, total: Number(r.inv.total), dueOn: r.inv.dueOn, daysOverdue: days, remindersSent: r.inv.remindersSent, action, hasEmail: !!r.email };
  });
}
platformBillingRoutes.get("/dunning", async (c) => c.json({ policy: DEFAULT_DUNNING, rows: await dunningPlan(c) }));
platformBillingRoutes.post("/dunning/run", finance, async (c) => {
  const db = c.get("db");
  const plan = (await dunningPlan(c)).filter((r) => r.action);
  const done = { reminded: 0, pastDue: 0, suspended: 0 };
  for (const r of plan) {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    if (!inv) continue;
    // every step also sends the reminder for that stage
    if (await emailInvoice(c, inv, "reminder")) {
      await db.update(invoices).set({ remindersSent: inv.remindersSent + 1, lastReminderAt: new Date() }).where(eq(invoices.id, inv.id));
      done.reminded++;
    }
    if (r.action === "past_due") {
      await db.update(tenants).set({ status: "past_due" }).where(and(eq(tenants.id, r.tenantId), eq(tenants.status, "active")));
      done.pastDue++;
    }
    if (r.action === "suspend") {
      await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, r.tenantId));
      done.suspended++;
    }
  }
  await audit(c, { tenantId: null, action: "platform.dunning_run", entity: "invoice", summary: `Dunning run: ${done.reminded} reminders, ${done.pastDue} marked past due, ${done.suspended} suspended` });
  return c.json(done);
});

// ---- GSTR-1 ----
platformBillingRoutes.get("/gstr1.csv", v("query", z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) })), async (c) => {
  const p = c.req.valid("query").period;
  const entity = await getEntity(c.get("db"));
  // GSTR-1 is by invoice date: everything issued in that calendar month
  const rows = await c.get("db").select().from(invoices).where(and(ne(invoices.status, "void"), sql`to_char(${invoices.issuedOn}, 'YYYY-MM') = ${p}`)).orderBy(asc(invoices.number));
  const csv = toCsv(
    ["Type", "GSTIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Reverse charge", "Rate", "Taxable value", "IGST", "CGST", "SGST", "SAC"],
    rows.map((i) => [i.buyer.gstin ? "B2B" : "B2CS", i.buyer.gstin ?? "", i.buyer.legalName ?? i.buyer.name, i.number, i.issuedOn, Number(i.total), i.buyer.stateCode ? `${i.buyer.stateCode}-${STATE_BY_CODE[i.buyer.stateCode] ?? ""}` : "", "N", 18, Number(i.subtotal), Number(i.igst), Number(i.cgst), Number(i.sgst), entity.sac]),
  );
  await audit(c, { tenantId: null, action: "platform.gstr1", entity: "invoice", summary: `Exported GSTR-1 for ${periodLabel(p)} (${rows.length} invoices)` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gstr1-${p}.csv"` });
});

// ===========================================================================
// Tenant: Settings > Billing & invoices
// ===========================================================================
export const tenantBillingRoutes = new Hono<AppEnv>();
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

tenantBillingRoutes.get("/", requirePerm("billing", "view"), async (c) => {
  const db = c.get("db");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid(c)));
  if (!t) throw notFound("Company");
  const [plan] = await db.select().from(plans).where(eq(plans.key, t.plan));
  const active = (await activeEmployeeCounts(db, [t.id])).get(t.id) ?? 0;
  const [admins] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.status, "active"), sql`${memberships.roleId} is not null`));
  const month = todayIST().slice(0, 7);
  const [usage] = await db
    .select({ payslips: sql<number>`(select count(*)::int from payroll_items i join payroll_runs r on r.id = i.run_id where r.tenant_id = ${t.id} and r.month = ${month} and r.status in ('approved','paid'))`, bankFiles: sql<number>`(select coalesce(sum(export_count),0)::int from payment_batches b where b.tenant_id = ${t.id} and to_char(b.created_at, 'YYYY-MM') = ${month})` })
    .from(tenants)
    .where(eq(tenants.id, t.id));
  const next = (await draftInvoices(db, month, [t.id]))[0];
  const list = await db.select().from(invoices).where(and(eq(invoices.tenantId, t.id), ne(invoices.status, "void"))).orderBy(desc(invoices.period));
  const [y, m] = month.split("-").map(Number) as [number, number];
  const nextDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return c.json({
    status: t.status,
    trialEndsAt: t.trialEndsAt,
    plan: plan ? { key: plan.key, name: plan.name, price: Number(t.customPrice ?? plan.pricePerEmployee ?? 0), custom: t.customPrice !== null, maxEmployees: plan.maxEmployees, includedAdmins: plan.includedAdmins, minSeats: plan.minSeats, features: plan.features } : { key: t.plan, name: t.plan === "trial" ? "Trial" : t.plan, price: 0, custom: false, maxEmployees: null, includedAdmins: null, minSeats: 0, features: [] },
    seats: { active, billable: next?.seats ?? active },
    admins: admins?.n ?? 0,
    nextInvoice: next && !next.skip?.startsWith("Already") ? { period: month, periodLabel: periodLabel(month), date: nextDate, subtotal: next.subtotal, gst: next.cgst + next.sgst + next.igst, total: next.total, note: next.skip } : null,
    usage: { payslips: usage?.payslips ?? 0, bankFiles: usage?.bankFiles ?? 0 },
    billing: { legalName: t.legalName ?? t.name, gstin: t.gstin, state: t.state, address: t.registeredAddress, billingEmail: t.billingEmail ?? t.contactEmail, paymentMethod: t.paymentMethod },
    invoices: list.map((i) => shape(i)),
    overdue: list.filter((i) => invoiceStatus(i) === "overdue").reduce((s, i) => s + Number(i.total), 0),
    payOnline: !!cashfreeConfig(c.env),
    contactPhone: t.contactPhone,
  });
});

tenantBillingRoutes.get("/invoices/:id", requirePerm("billing", "view"), async (c) => {
  const [inv] = await c.get("db").select().from(invoices).where(and(eq(invoices.id, c.req.param("id")), eq(invoices.tenantId, tid(c))));
  if (!inv) throw notFound("Invoice");
  return c.json({ ...shape(inv), entity: await getEntity(c.get("db")), onlinePayments: await attemptsFor(c.get("db"), inv.id), payOnline: !!cashfreeConfig(c.env) && inv.status === "issued" });
});

tenantBillingRoutes.patch("/details", requirePerm("billing", "edit"), v("json", z.object({ billingEmail: z.string().trim().email().nullable() })), async (c) => {
  const [row] = await c.get("db").update(tenants).set({ billingEmail: c.req.valid("json").billingEmail }).where(eq(tenants.id, tid(c))).returning();
  await audit(c, { action: "billing.details", entity: "tenant", entityId: tid(c), summary: `Billing email set to ${row?.billingEmail ?? "the contact email"}` });
  return c.json({ billingEmail: row?.billingEmail ?? null });
});
