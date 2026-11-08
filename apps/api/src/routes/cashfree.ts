import { Hono, type Context } from "hono";
import { and, desc, eq, gt } from "drizzle-orm";
import { billingMandates, invoicePayments, invoices, tenants } from "@hrms/db";
import { inr } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { cashfreeConfig, CashfreeError, createOrder, verifyWebhook } from "../services/cashfree";
import { createSubscription, manageSubscription, UPI_AUTOPAY_LIMIT, webhookIds } from "../services/cashfree-subscriptions";
import { activeMandate, AUTOPAY_GATEWAY, latestMandate, methodLabel, scheduleAutopay, suggestedLimit, syncCharge, syncMandate } from "../services/autopay";
import { z } from "zod";
import { v } from "../lib/validate";
import { syncOrder, type SettleResult } from "../services/online-payments";
import { getEntity, periodLabel } from "../services/billing";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

/** Indian mobile number for Cashfree's customer_phone (10 digits). */
export function phoneFor(raw: string | null | undefined) {
  const d = (raw ?? "").replace(/\D/g, "");
  const n = d.length > 10 && (d.startsWith("91") || d.startsWith("0")) ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

async function receipt(c: Context<AppEnv>, r: SettleResult) {
  if (!r.settled) return;
  try {
    const [inv] = await c.get("db").select({ i: invoices, t: tenants }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId)).where(eq(invoices.id, r.attempt.invoiceId));
    const to = inv?.t.billingEmail ?? inv?.t.contactEmail;
    if (!inv || !to) return;
    const entity = await getEntity(c.get("db"));
    const { html, text } = layout({
      company: entity.legalName,
      heading: `Payment received for ${inv.i.number}`,
      paragraphs: [`We've received ${inr(Number(r.attempt.amount))} for ${periodLabel(inv.i.period)} (paid by ${r.attempt.method ?? "online payment"}). Thank you.`, ...(r.restored ? ["Your account is active again."] : [])],
      cta: { label: "View invoice", url: `${c.env.APP_URL}/settings/billing` },
    });
    await c.get("mailer").send({ to, subject: `Payment received · ${inv.i.number}`, html, text });
  } catch (err) {
    console.error("receipt email failed", err);
  }
}

// ---------------------------------------------------------------------------
// Tenant: pay an invoice online
// ---------------------------------------------------------------------------
export const tenantPayRoutes = new Hono<AppEnv>();

tenantPayRoutes.post("/invoices/:id/pay", requirePerm("billing", "view"), async (c) => {
  if (c.get("tenant").readOnly) throw new ApiError(403, "Read-only support view", "forbidden");
  const cfg = cashfreeConfig(c.env);
  if (!cfg) throw new ApiError(503, "Online payment isn't set up yet. Pay by UPI or bank transfer using the details on the invoice.", "unavailable");
  const db = c.get("db");
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, c.req.param("id")), eq(invoices.tenantId, tid(c))));
  if (!inv) throw notFound("Invoice");
  if (inv.status !== "issued") throw badRequest(inv.status === "paid" ? "This invoice is already paid" : "This invoice can't be paid");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid(c)));
  const phone = phoneFor(t?.contactPhone);
  if (!phone) throw badRequest("Add your company's contact mobile number in Settings › Organization first. The payment gateway needs it.");
  const email = t?.billingEmail ?? t?.contactEmail ?? c.get("session")!.email;

  // reuse a checkout that's still open, so double clicks don't create two orders
  const [open] = await db
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, inv.id), eq(invoicePayments.status, "created"), gt(invoicePayments.expiresAt, new Date(Date.now() + 2 * 60_000))))
    .orderBy(desc(invoicePayments.createdAt))
    .limit(1);
  if (open?.paymentSessionId && Number(open.amount) === Number(inv.total)) return c.json({ orderId: open.orderId, paymentSessionId: open.paymentSessionId, mode: cfg.mode });

  const orderId = `${inv.number}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const [attempt] = await db.insert(invoicePayments).values({ invoiceId: inv.id, tenantId: inv.tenantId, orderId, amount: Number(inv.total), expiresAt, createdBy: c.get("session")!.userId }).returning();
  try {
    const order = await createOrder(cfg, {
      orderId,
      amount: Number(inv.total),
      customer: { id: `t_${inv.tenantId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`, name: t?.legalName ?? t?.name ?? "Customer", email, phone },
      returnUrl: `${c.env.APP_URL}/settings/billing?order_id={order_id}`,
      notifyUrl: `${c.env.APP_URL}/api/public/payments/cashfree/webhook`,
      note: `${inv.number} · ${periodLabel(inv.period)}`,
      tags: { invoice: inv.number, tenant: t?.code ?? "" },
    });
    if (!order.payment_session_id) throw new CashfreeError("Cashfree didn't return a payment session", 502);
    await db.update(invoicePayments).set({ paymentSessionId: order.payment_session_id, gatewayOrderId: order.cf_order_id ? String(order.cf_order_id) : null }).where(eq(invoicePayments.id, attempt!.id));
    await audit(c, { action: "billing.pay_start", entity: "invoice", entityId: inv.id, summary: `Started online payment for ${inv.number} (${inr(Number(inv.total))})` });
    return c.json({ orderId, paymentSessionId: order.payment_session_id, mode: cfg.mode }, 201);
  } catch (e) {
    await db.update(invoicePayments).set({ status: "failed", failureReason: (e as Error).message }).where(eq(invoicePayments.id, attempt!.id));
    console.error("cashfree create order failed", e);
    throw new ApiError(502, "The payment gateway didn't respond. Please try again in a minute.", "gateway_error");
  }
});

/** Return page check: asks Cashfree, settles if paid. */
tenantPayRoutes.get("/payments/:orderId", requirePerm("billing", "view"), async (c) => {
  const cfg = cashfreeConfig(c.env);
  if (!cfg) throw new ApiError(503, "Online payment isn't set up", "unavailable");
  const db = c.get("db");
  const [a] = await db.select().from(invoicePayments).where(and(eq(invoicePayments.orderId, c.req.param("orderId")), eq(invoicePayments.tenantId, tid(c))));
  if (!a) throw notFound("Payment");
  const r = await syncOrder(db, cfg, a.orderId);
  if (r) await receipt(c, r);
  const [inv] = await db.select({ status: invoices.status, number: invoices.number }).from(invoices).where(eq(invoices.id, a.invoiceId));
  return c.json({ status: r?.status ?? a.status, invoice: inv, failureReason: r?.attempt.failureReason ?? null });
});

// ---------------------------------------------------------------------------
// Tenant: autopay (Cashfree Subscriptions)
// ---------------------------------------------------------------------------
const mandateView = (m: typeof billingMandates.$inferSelect | null) =>
  m ? { id: m.id, subscriptionId: m.subscriptionId, method: m.method, maxAmount: Number(m.maxAmount), status: m.status, payer: m.payer, label: methodLabel(m), authorizedAt: m.authorizedAt, cancelledAt: m.cancelledAt, failureReason: m.failureReason, createdAt: m.createdAt } : null;

tenantPayRoutes.get("/autopay", requirePerm("billing", "view"), async (c) => {
  const db = c.get("db");
  const [latest] = await db.select({ total: invoices.total }).from(invoices).where(eq(invoices.tenantId, tid(c))).orderBy(desc(invoices.period)).limit(1);
  const m = (await activeMandate(db, tid(c))) ?? (await latestMandate(db, tid(c)));
  const [next] = await db
    .select({ p: invoicePayments, number: invoices.number })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(and(eq(invoicePayments.tenantId, tid(c)), eq(invoicePayments.gateway, AUTOPAY_GATEWAY), eq(invoicePayments.status, "created")))
    .orderBy(desc(invoicePayments.createdAt))
    .limit(1);
  return c.json({
    available: !!cashfreeConfig(c.env),
    mandate: mandateView(m),
    suggestedMax: suggestedLimit(Number(latest?.total ?? 0)),
    upiLimit: UPI_AUTOPAY_LIMIT,
    nextCharge: next ? { invoice: next.number, amount: Number(next.p.amount), scheduledFor: next.p.scheduledFor } : null,
  });
});

const setupSchema = z.object({ method: z.enum(["upi", "enach"]), maxAmount: z.coerce.number().min(500).max(10_000_000) });

tenantPayRoutes.post("/autopay", requirePerm("billing", "edit"), v("json", setupSchema), async (c) => {
  if (c.get("tenant").readOnly) throw new ApiError(403, "Read-only support view", "forbidden");
  const cfg = cashfreeConfig(c.env);
  if (!cfg) throw new ApiError(503, "Autopay isn't available yet", "unavailable");
  const b = c.req.valid("json");
  if (b.method === "upi" && b.maxAmount > UPI_AUTOPAY_LIMIT) throw badRequest(`UPI autopay debits above ₹${UPI_AUTOPAY_LIMIT.toLocaleString("en-IN")} need your approval in the UPI app every month. Use a bank e-mandate (eNACH) for a higher limit.`);
  const db = c.get("db");
  if (await activeMandate(db, tid(c))) throw new ApiError(409, "Autopay is already on. Cancel it first to set up a new one.", "conflict");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tid(c)));
  const phone = phoneFor(t?.contactPhone);
  if (!phone) throw badRequest("Add your company's contact mobile number in Settings › Organization first. The bank needs it for the mandate.");
  const subscriptionId = `MND-${t!.code}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const [m] = await db.insert(billingMandates).values({ tenantId: tid(c), subscriptionId, method: b.method, maxAmount: b.maxAmount, createdBy: c.get("session")!.userId }).returning();
  try {
    const s = await createSubscription(cfg, {
      subscriptionId,
      maxAmount: b.maxAmount,
      method: b.method,
      customer: { name: t?.legalName ?? t?.name ?? "Customer", email: t?.billingEmail ?? t?.contactEmail ?? c.get("session")!.email, phone },
      returnUrl: `${c.env.APP_URL}/settings/billing?autopay=${subscriptionId}`,
      notifyUrl: `${c.env.APP_URL}/api/public/payments/cashfree/webhook`,
      note: `Strats360 People invoices for ${t?.name}`,
    });
    if (!s.sessionId) throw new CashfreeError("Cashfree didn't return a session", 502);
    await db.update(billingMandates).set({ sessionId: s.sessionId, gatewaySubscriptionId: s.cfSubscriptionId, gatewayStatus: s.status }).where(eq(billingMandates.id, m!.id));
    await audit(c, { action: "billing.autopay_start", entity: "billing_mandate", entityId: m!.id, summary: `Started ${b.method === "upi" ? "UPI autopay" : "bank e-mandate"} setup, limit ${inr(b.maxAmount)}` });
    return c.json({ subscriptionId, sessionId: s.sessionId, mode: cfg.mode }, 201);
  } catch (e) {
    await db.update(billingMandates).set({ status: "failed", failureReason: (e as Error).message }).where(eq(billingMandates.id, m!.id));
    console.error("cashfree subscription failed", e);
    throw new ApiError(502, "The payment gateway didn't respond. Please try again in a minute.", "gateway_error");
  }
});

tenantPayRoutes.get("/autopay/:subscriptionId", requirePerm("billing", "view"), async (c) => {
  const cfg = cashfreeConfig(c.env);
  if (!cfg) throw new ApiError(503, "Autopay isn't available", "unavailable");
  const db = c.get("db");
  const [m] = await db.select().from(billingMandates).where(and(eq(billingMandates.subscriptionId, c.req.param("subscriptionId")), eq(billingMandates.tenantId, tid(c))));
  if (!m) throw notFound("Mandate");
  const { mandate, changed } = await syncMandate(db, cfg, m);
  if (changed && mandate.status === "active") await audit(c, { action: "billing.autopay_active", entity: "billing_mandate", entityId: m.id, summary: `Autopay is on (${methodLabel(mandate)}, up to ${inr(Number(mandate.maxAmount))})` });
  // switching autopay on also lines up the open invoice, if it fits under the limit
  if (mandate.status === "active") {
    const [open] = await db.select().from(invoices).where(and(eq(invoices.tenantId, tid(c)), eq(invoices.status, "issued"))).orderBy(desc(invoices.period)).limit(1);
    if (open) await scheduleAutopay(db, cfg, open, c.get("session")!.userId);
  }
  return c.json({ mandate: mandateView(mandate) });
});

tenantPayRoutes.post("/autopay/cancel", requirePerm("billing", "edit"), async (c) => {
  if (c.get("tenant").readOnly) throw new ApiError(403, "Read-only support view", "forbidden");
  const cfg = cashfreeConfig(c.env);
  const db = c.get("db");
  const m = await activeMandate(db, tid(c));
  if (!m) throw badRequest("Autopay isn't on");
  if (cfg) {
    try {
      await manageSubscription(cfg, m.subscriptionId, "CANCEL");
    } catch (e) {
      console.error("cashfree cancel failed", e);
      throw new ApiError(502, "The payment gateway didn't respond. Please try again in a minute.", "gateway_error");
    }
  }
  await db.update(billingMandates).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(billingMandates.id, m.id));
  await db.update(tenants).set({ paymentMethod: null }).where(eq(tenants.id, tid(c)));
  // charges not yet debited are withdrawn with the mandate
  await db.update(invoicePayments).set({ status: "dropped", failureReason: "Autopay cancelled" }).where(and(eq(invoicePayments.mandateId, m.id), eq(invoicePayments.status, "created")));
  await audit(c, { action: "billing.autopay_cancel", entity: "billing_mandate", entityId: m.id, summary: `Cancelled autopay (${methodLabel(m)})` });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public: Cashfree webhook
// ---------------------------------------------------------------------------
export const cashfreeWebhook = new Hono<AppEnv>();

cashfreeWebhook.post("/cashfree/webhook", async (c) => {
  const cfg = cashfreeConfig(c.env);
  if (!cfg) return c.json({ ok: false, error: "not configured" }, 503);
  const raw = await c.req.text();
  const ok = await verifyWebhook(cfg.secret, c.req.header("x-webhook-timestamp"), c.req.header("x-webhook-signature"), raw);
  if (!ok) {
    console.warn("cashfree webhook: bad signature");
    return c.json({ ok: false, error: "invalid signature" }, 401);
  }
  let body: { type?: string; data?: { order?: { order_id?: string } } };
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: "invalid body" }, 400);
  }
  if (/^SUBSCRIPTION_/.test(body.type ?? "")) return subscriptionEvent(c, cfg, body as Record<string, any>);
  const orderId = body.data?.order?.order_id;
  if (!orderId || !/^PAYMENT_/.test(body.type ?? "")) return c.json({ ok: true, ignored: body.type ?? "unknown" });
  // the payload only tells us which order to look at; the API is the source of truth
  const r = await syncOrder(c.get("db"), cfg, orderId);
  if (!r) return c.json({ ok: true, ignored: "unknown order" });
  await receipt(c, r);
  if (r.settled || r.needsReview) {
    await audit(c, { tenantId: r.attempt.tenantId, action: r.settled ? "billing.paid_online" : "billing.payment_review", entity: "invoice", entityId: r.attempt.invoiceId, summary: r.settled ? `Invoice paid online (${inr(Number(r.attempt.amount))}, Cashfree ${r.attempt.gatewayPaymentId}${r.restored ? "; account restored" : ""})` : `Online payment needs review: ${r.needsReview} (order ${orderId})` });
  }
  return c.json({ ok: true, status: r.status });
});

/** Subscription webhooks: mandate status changes and autopay charge results. Always re-read from the API. */
async function subscriptionEvent(c: Context<AppEnv>, cfg: NonNullable<ReturnType<typeof cashfreeConfig>>, body: Record<string, any>) {
  const db = c.get("db");
  const ids = webhookIds(body);
  if (ids.paymentId) {
    const [attempt] = await db.select().from(invoicePayments).where(and(eq(invoicePayments.orderId, ids.paymentId), eq(invoicePayments.gateway, AUTOPAY_GATEWAY)));
    if (attempt) {
      const r = await syncCharge(db, cfg, attempt);
      if (r) {
        await receipt(c, r);
        if (r.settled || r.needsReview || r.status === "failed") {
          await audit(c, {
            tenantId: attempt.tenantId,
            action: r.settled ? "billing.paid_autopay" : r.status === "failed" ? "billing.autopay_failed" : "billing.payment_review",
            entity: "invoice",
            entityId: attempt.invoiceId,
            summary: r.settled ? `Invoice paid by autopay (${inr(Number(attempt.amount))})${r.restored ? "; account restored" : ""}` : r.status === "failed" ? `Autopay charge failed: ${r.attempt.failureReason ?? "declined"}` : `Autopay payment needs review: ${r.needsReview}`,
          });
        }
        if (r.status === "failed") await autopayFailed(c, attempt.tenantId, Number(attempt.amount), r.attempt.failureReason);
        return c.json({ ok: true, status: r.status });
      }
    }
  }
  if (ids.subscriptionId) {
    const [m] = await db.select().from(billingMandates).where(eq(billingMandates.subscriptionId, ids.subscriptionId));
    if (m) {
      const { mandate, changed } = await syncMandate(db, cfg, m);
      if (changed) await audit(c, { tenantId: m.tenantId, action: "billing.autopay_status", entity: "billing_mandate", entityId: m.id, summary: `Autopay is now ${mandate.status}` });
      return c.json({ ok: true, mandate: mandate.status });
    }
  }
  return c.json({ ok: true, ignored: "unknown subscription" });
}

async function autopayFailed(c: Context<AppEnv>, tenantId: string, amount: number, reason: string | null) {
  try {
    const [t] = await c.get("db").select().from(tenants).where(eq(tenants.id, tenantId));
    const to = t?.billingEmail ?? t?.contactEmail;
    if (!to) return;
    const entity = await getEntity(c.get("db"));
    const { html, text } = layout({
      company: entity.legalName,
      heading: "Autopay couldn't collect your invoice",
      paragraphs: [`The autopay debit of ${inr(amount)} didn't go through${reason ? ` (${reason})` : ""}.`, "Please pay the invoice online, or check your mandate with your bank. We won't retry automatically."],
      cta: { label: "Pay now", url: `${c.env.APP_URL}/settings/billing` },
    });
    await c.get("mailer").send({ to, subject: "Autopay debit failed", html, text });
  } catch (err) {
    console.error("autopay failure email failed", err);
  }
}
