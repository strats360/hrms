import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { billingMandates, invoicePayments, tenants, type Database } from "@hrms/db";
import type { CashfreeConfig, CfPayment } from "./cashfree";
import { cancelSubscriptionPayment, chargeSubscription, getSubscription, getSubscriptionPayment, mandateStatus, type CfSubPayment } from "./cashfree-subscriptions";
import { applyPayment, type Attempt, type SettleResult } from "./online-payments";
import type { Invoice } from "./billing";

export type Mandate = typeof billingMandates.$inferSelect;
export const AUTOPAY_GATEWAY = "cashfree_autopay";
/** UPI needs the bank's pre-debit notice at least 24 hours before the debit. */
const PRE_DEBIT_HOURS = 26;
/** A failed debit gets one automatic retry, this many days later. */
export const AUTOPAY_RETRY_DAYS = 3;

export async function activeMandate(db: Database, tenantId: string) {
  const [m] = await db.select().from(billingMandates).where(and(eq(billingMandates.tenantId, tenantId), eq(billingMandates.status, "active"))).orderBy(desc(billingMandates.authorizedAt)).limit(1);
  return m ?? null;
}

export async function latestMandate(db: Database, tenantId: string) {
  const [m] = await db.select().from(billingMandates).where(eq(billingMandates.tenantId, tenantId)).orderBy(desc(billingMandates.createdAt)).limit(1);
  return m ?? null;
}

export const methodLabel = (m: Pick<Mandate, "method" | "payer">) => `${m.method === "upi" ? "UPI autopay" : "Bank e-mandate"}${m.payer ? ` · ${m.payer}` : ""}`;

/** Refresh a mandate from Cashfree. Activating one retires any older active mandate. */
export async function syncMandate(db: Database, cfg: CashfreeConfig, m: Mandate) {
  const s = await getSubscription(cfg, m.subscriptionId);
  const status = mandateStatus(s.status);
  const [row] = await db
    .update(billingMandates)
    .set({
      status,
      gatewayStatus: s.status,
      gatewaySubscriptionId: s.cfSubscriptionId ?? m.gatewaySubscriptionId,
      payer: s.payer ?? m.payer,
      authorizedAt: status === "active" && !m.authorizedAt ? new Date() : m.authorizedAt,
      cancelledAt: status === "cancelled" && !m.cancelledAt ? new Date() : m.cancelledAt,
      raw: s.raw,
    })
    .where(eq(billingMandates.id, m.id))
    .returning();
  const fresh = row ?? m;
  if (status === "active" && m.status !== "active") {
    await db.update(billingMandates).set({ status: "cancelled", cancelledAt: new Date(), failureReason: "Replaced by a newer mandate" }).where(and(eq(billingMandates.tenantId, m.tenantId), eq(billingMandates.status, "active"), ne(billingMandates.id, m.id)));
    await db.update(tenants).set({ paymentMethod: methodLabel(fresh) }).where(eq(tenants.id, m.tenantId));
  }
  if ((status === "cancelled" || status === "expired") && m.status === "active") await db.update(tenants).set({ paymentMethod: null }).where(eq(tenants.id, m.tenantId));
  return { mandate: fresh, changed: status !== m.status };
}

export type ScheduleResult = { scheduled: true; attempt: Attempt } | { scheduled: false; reason: string };

/** Charge an invoice against the tenant's active mandate (no-op if one is already pending or paid). */
export async function scheduleAutopay(db: Database, cfg: CashfreeConfig, inv: Invoice, userId: string | null, opts: { retryOf?: string } = {}): Promise<ScheduleResult> {
  if (inv.status !== "issued") return { scheduled: false, reason: "Invoice isn't open" };
  const m = await activeMandate(db, inv.tenantId);
  if (!m) return { scheduled: false, reason: "No active autopay mandate" };
  if (Number(inv.total) > Number(m.maxAmount)) return { scheduled: false, reason: `Invoice is above the autopay limit of ₹${Number(m.maxAmount).toLocaleString("en-IN")}` };
  const [existing] = await db
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, inv.id), eq(invoicePayments.gateway, AUTOPAY_GATEWAY), inArray(invoicePayments.status, ["created", "paid"])))
    .limit(1);
  if (existing) return { scheduled: true, attempt: existing };
  const paymentId = `AP-${inv.number}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const scheduleAt = new Date(Date.now() + PRE_DEBIT_HOURS * 3600_000);
  const [attempt] = await db
    .insert(invoicePayments)
    .values({ invoiceId: inv.id, tenantId: inv.tenantId, gateway: AUTOPAY_GATEWAY, orderId: paymentId, amount: Number(inv.total), mandateId: m.id, scheduledFor: scheduleAt, method: m.method, createdBy: userId, retryOf: opts.retryOf ?? null })
    .returning();
  try {
    const p = await chargeSubscription(cfg, { subscriptionId: m.subscriptionId, paymentId, amount: Number(inv.total), scheduleAt, remarks: `${inv.number} subscription` });
    const [a] = await db.update(invoicePayments).set({ gatewayPaymentId: p.cfPaymentId, raw: p.raw }).where(eq(invoicePayments.id, attempt!.id)).returning();
    // a charge can also come back already settled or rejected
    if (p.status === "SUCCESS" || p.status === "FAILED") await applyPayment(db, a ?? attempt!, toCfPayment(p, m.method));
    return { scheduled: true, attempt: a ?? attempt! };
  } catch (e) {
    await db.update(invoicePayments).set({ status: "failed", failureReason: (e as Error).message }).where(eq(invoicePayments.id, attempt!.id));
    return { scheduled: false, reason: `Cashfree didn't accept the charge: ${(e as Error).message}` };
  }
}

function toCfPayment(p: CfSubPayment, method: string): CfPayment {
  const st = p.status === "SUCCESS" ? "SUCCESS" : ["FAILED", "CANCELLED", "DECLINED", "REJECTED"].includes(p.status) ? "FAILED" : "PENDING";
  return { cf_payment_id: p.cfPaymentId ?? p.paymentId, payment_status: st, payment_amount: p.amount, payment_group: (p.method ?? method).toLowerCase().includes("upi") ? "upi" : "enach", bank_reference: p.bankReference, payment_time: p.time ?? undefined, payment_message: p.message ?? undefined };
}

/** Refresh an autopay charge from Cashfree and settle the invoice if it went through. */
export async function syncCharge(db: Database, cfg: CashfreeConfig, attempt: Attempt) {
  const [m] = attempt.mandateId ? await db.select().from(billingMandates).where(eq(billingMandates.id, attempt.mandateId)) : [];
  if (!m) return null;
  const p = await getSubscriptionPayment(cfg, m.subscriptionId, attempt.orderId);
  return applyPayment(db, attempt, toCfPayment(p, m.method));
}

/** A sensible limit: half as much again as the latest invoice, rounded up to ₹1,000. */
export function suggestedLimit(latestTotal: number) {
  return Math.max(5000, Math.ceil((latestTotal * 1.5) / 1000) * 1000);
}

/**
 * After a failed debit: plan its one automatic retry. A retry that fails isn't
 * retried again. Returns when the retry is due, or null.
 */
export async function planRetry(db: Database, attempt: Attempt) {
  if (attempt.gateway !== AUTOPAY_GATEWAY || attempt.retryOf || attempt.status !== "failed") return null;
  const [done] = await db.select({ id: invoicePayments.id }).from(invoicePayments).where(eq(invoicePayments.retryOf, attempt.id)).limit(1);
  if (done) return null; // already retried once
  const at = new Date(Date.now() + AUTOPAY_RETRY_DAYS * 86400_000);
  const [row] = await db.update(invoicePayments).set({ retryAt: at }).where(and(eq(invoicePayments.id, attempt.id), eq(invoicePayments.status, "failed"))).returning();
  return row ? at : null;
}

/** Drop pending automatic retries (paid by hand, manual retry, or autopay cancelled). */
export async function clearRetries(db: Database, where: { invoiceId?: string; mandateId?: string }) {
  const cond = where.invoiceId ? eq(invoicePayments.invoiceId, where.invoiceId) : eq(invoicePayments.mandateId, where.mandateId!);
  await db.update(invoicePayments).set({ retryAt: null }).where(and(cond, eq(invoicePayments.gateway, AUTOPAY_GATEWAY)));
}

export interface CancelOutcome {
  /** Debits withdrawn before they reached the bank. */
  cancelled: Attempt[];
  /** Debits already with the bank (or Cashfree didn't answer): they may still go through. */
  pending: { attempt: Attempt; reason: string }[];
  /** Debits that turned out to be settled or failed already. */
  settled: SettleResult[];
}

/**
 * Withdraw the scheduled autopay debits for an invoice, e.g. because it was paid
 * another way, voided, or the tenant asked to skip it. Also drops a pending retry.
 * A debit Cashfree has already sent to the bank can't be stopped: it is re-read and
 * reported, and if it later succeeds the duplicate is flagged for a refund.
 */
export async function cancelScheduledCharges(db: Database, cfg: CashfreeConfig | null, invoiceId: string, reason: string, opts: { orderId?: string } = {}): Promise<CancelOutcome> {
  const out: CancelOutcome = { cancelled: [], pending: [], settled: [] };
  await clearRetries(db, { invoiceId });
  const rows = await db
    .select({ a: invoicePayments, m: billingMandates })
    .from(invoicePayments)
    .leftJoin(billingMandates, eq(billingMandates.id, invoicePayments.mandateId))
    .where(and(eq(invoicePayments.invoiceId, invoiceId), eq(invoicePayments.gateway, AUTOPAY_GATEWAY), eq(invoicePayments.status, "created"), ...(opts.orderId ? [eq(invoicePayments.orderId, opts.orderId)] : [])));
  for (const { a, m } of rows) {
    let ok = !m || !cfg; // nothing at Cashfree to withdraw
    let why = "";
    if (m && cfg) {
      try {
        const p = await cancelSubscriptionPayment(cfg, m.subscriptionId, a.orderId);
        if (p.status === "SUCCESS" || p.status === "FAILED") {
          out.settled.push(await applyPayment(db, a, toCfPayment(p, m.method)));
          continue;
        }
        ok = true;
      } catch (e) {
        why = (e as Error).message;
        // see where the debit actually stands before reporting it
        try {
          const p = await getSubscriptionPayment(cfg, m.subscriptionId, a.orderId);
          if (p.status === "SUCCESS" || p.status === "FAILED" || p.status === "CANCELLED") {
            if (p.status === "CANCELLED") ok = true;
            else {
              out.settled.push(await applyPayment(db, a, toCfPayment(p, m.method)));
              continue;
            }
          }
        } catch {
          /* keep the cancel error */
        }
      }
    }
    if (ok) {
      const [row] = await db.update(invoicePayments).set({ status: "cancelled", failureReason: reason, retryAt: null }).where(and(eq(invoicePayments.id, a.id), eq(invoicePayments.status, "created"))).returning();
      if (row) out.cancelled.push(row);
    } else {
      out.pending.push({ attempt: a, reason: why || "Cashfree didn't confirm the cancellation" });
    }
  }
  return out;
}
