import { and, desc, eq } from "drizzle-orm";
import { invoicePayments, invoices, type Database } from "@hrms/db";
import { getPayments, methodOf, type CashfreeConfig, type CfPayment } from "./cashfree";
import { restoreIfClear } from "./billing";

export type Attempt = typeof invoicePayments.$inferSelect;

export interface SettleResult {
  attempt: Attempt;
  status: string;
  /** The invoice was marked paid by this call. */
  settled: boolean;
  /** Paid, but the invoice was already paid or void: money to refund or adjust. */
  needsReview: string | null;
  restored: boolean;
}

/**
 * Apply a gateway payment to its attempt and invoice. Idempotent: the webhook and the
 * return page can both call it, in any order, any number of times.
 */
export async function applyPayment(db: Database, attempt: Attempt, p: CfPayment | null): Promise<SettleResult> {
  const base = { attempt, settled: false, needsReview: null as string | null, restored: false };
  if (!p) return { ...base, status: attempt.status };
  if (p.payment_status === "SUCCESS") {
    if (Math.abs(Number(p.payment_amount) - Number(attempt.amount)) > 0.009) {
      // never settle an invoice on a different amount
      const [a] = await db.update(invoicePayments).set({ status: "failed", failureReason: `Amount mismatch: paid ${p.payment_amount}, expected ${attempt.amount}`, raw: p as unknown as Record<string, unknown> }).where(eq(invoicePayments.id, attempt.id)).returning();
      return { ...base, attempt: a ?? attempt, status: "failed", needsReview: "Amount mismatch" };
    }
    const paidAt = p.payment_time ? new Date(p.payment_time) : new Date();
    const [a] = await db
      .update(invoicePayments)
      .set({ status: "paid", gatewayPaymentId: String(p.cf_payment_id), method: methodOf(p.payment_group), bankReference: p.bank_reference ?? null, paidAt, failureReason: null, raw: p as unknown as Record<string, unknown> })
      .where(eq(invoicePayments.id, attempt.id))
      .returning();
    const paidOn = new Date(paidAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const [inv] = await db
      .update(invoices)
      .set({ status: "paid", paidOn, paymentMethod: methodOf(p.payment_group), paymentReference: `Cashfree ${p.cf_payment_id}${p.bank_reference ? ` · ${p.bank_reference}` : ""}` })
      .where(and(eq(invoices.id, attempt.invoiceId), eq(invoices.status, "issued")))
      .returning();
    if (inv) return { ...base, attempt: a ?? attempt, status: "paid", settled: true, restored: await restoreIfClear(db, inv.tenantId) };
    const [cur] = await db.select({ status: invoices.status, ref: invoices.paymentReference }).from(invoices).where(eq(invoices.id, attempt.invoiceId));
    const dup = cur?.status === "paid" && !cur.ref?.includes(String(p.cf_payment_id));
    return { ...base, attempt: a ?? attempt, status: "paid", needsReview: cur?.status === "void" ? "Paid after the invoice was voided: refund it" : dup ? "Invoice was already paid: refund the duplicate" : null };
  }
  if (attempt.status !== "created") return { ...base, status: attempt.status };
  const next = p.payment_status === "FAILED" ? "failed" : p.payment_status === "USER_DROPPED" || p.payment_status === "CANCELLED" ? "dropped" : null;
  if (!next) return { ...base, status: attempt.status };
  const [a] = await db.update(invoicePayments).set({ status: next, failureReason: p.payment_message ?? null, raw: p as unknown as Record<string, unknown> }).where(and(eq(invoicePayments.id, attempt.id), eq(invoicePayments.status, "created"))).returning();
  return { ...base, attempt: a ?? attempt, status: next };
}

/** Ask Cashfree what happened to an order, then apply it. The source of truth is always the API. */
export async function syncOrder(db: Database, cfg: CashfreeConfig, orderId: string) {
  const [attempt] = await db.select().from(invoicePayments).where(eq(invoicePayments.orderId, orderId));
  if (!attempt) return null;
  const payments = await getPayments(cfg, orderId);
  const pick = payments.find((p) => p.payment_status === "SUCCESS") ?? [...payments].sort((a, b) => String(b.payment_time ?? "").localeCompare(String(a.payment_time ?? "")))[0] ?? null;
  const r = await applyPayment(db, attempt, pick);
  // an unpaid order past its expiry won't complete
  if (r.status === "created" && attempt.expiresAt && attempt.expiresAt.getTime() < Date.now()) {
    await db.update(invoicePayments).set({ status: "expired" }).where(and(eq(invoicePayments.id, attempt.id), eq(invoicePayments.status, "created")));
    return { ...r, status: "expired" };
  }
  return r;
}

export async function attemptsFor(db: Database, invoiceId: string) {
  return db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId)).orderBy(desc(invoicePayments.createdAt));
}
