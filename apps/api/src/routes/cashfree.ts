import { Hono, type Context } from "hono";
import { and, desc, eq, gt } from "drizzle-orm";
import { invoicePayments, invoices, tenants } from "@hrms/db";
import { inr } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { cashfreeConfig, CashfreeError, createOrder, verifyWebhook } from "../services/cashfree";
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
