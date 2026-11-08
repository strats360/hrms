import { call, type CashfreeConfig } from "./cashfree";

/**
 * Cashfree Subscriptions (autopay mandates). One ON_DEMAND subscription per tenant:
 * the payer authorises debits up to a maximum, and we charge each invoice against it.
 * All response parsing is defensive and in this file, so the API version can move
 * without touching the rest of the app.
 */
export type MandateMethod = "upi" | "enach";

/** RBI: e-mandate debits above this need the payer's approval each time (UPI and cards). */
export const UPI_AUTOPAY_LIMIT = 15000;

export interface CfSubscription {
  subscriptionId: string;
  cfSubscriptionId: string | null;
  sessionId: string | null;
  status: string;
  payer: string | null;
  raw: Record<string, unknown>;
}
export interface CfSubPayment {
  paymentId: string;
  cfPaymentId: string | null;
  status: string;
  amount: number;
  method: string | null;
  bankReference: string | null;
  time: string | null;
  message: string | null;
  raw: Record<string, unknown>;
}

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const pick = (o: Record<string, any>, ...paths: string[]) => {
  for (const p of paths) {
    const v = p.split(".").reduce<any>((x, k) => (x == null ? undefined : x[k]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

function parseSubscription(r: Record<string, any>): CfSubscription {
  const vpa = pick(r, "authorization_details.payment_method.upi.upi_id", "authorization_details.upi_id", "authorization_details.payment_method_details.upi_id");
  const acct = pick(r, "authorization_details.payment_method.enach.account_number", "authorization_details.bank_account_number", "authorization_details.account_number");
  return {
    subscriptionId: String(pick(r, "subscription_id") ?? ""),
    cfSubscriptionId: str(pick(r, "cf_subscription_id")),
    sessionId: str(pick(r, "subscription_session_id", "session_id")),
    status: String(pick(r, "subscription_status", "status") ?? "UNKNOWN").toUpperCase(),
    payer: vpa ? String(vpa).replace(/^(.{2}).*(@.*)$/, "$1***$2") : acct ? `A/c ····${String(acct).slice(-4)}` : null,
    raw: r,
  };
}

function parsePayment(r: Record<string, any>): CfSubPayment {
  return {
    paymentId: String(pick(r, "payment_id", "merchant_payment_id") ?? ""),
    cfPaymentId: str(pick(r, "cf_payment_id", "cf_txn_id")),
    status: String(pick(r, "payment_status", "status") ?? "UNKNOWN").toUpperCase(),
    amount: Number(pick(r, "payment_amount", "amount") ?? 0),
    method: str(pick(r, "payment_method", "payment_group", "authorization_details.payment_method")),
    bankReference: str(pick(r, "bank_reference", "utr", "payment_utr")),
    time: str(pick(r, "payment_completion_time", "payment_time", "payment_initiated_date")),
    message: str(pick(r, "failure_details.failure_reason", "payment_message", "failure_reason")),
    raw: r,
  };
}

export async function createSubscription(
  cfg: CashfreeConfig,
  s: { subscriptionId: string; maxAmount: number; method: MandateMethod; customer: { name: string; email: string; phone: string }; returnUrl: string; notifyUrl: string; note: string },
) {
  const expiry = new Date(Date.now() + 5 * 365 * 86400_000).toISOString();
  const r = await call<Record<string, any>>(
    cfg,
    "POST",
    "/subscriptions",
    {
      subscription_id: s.subscriptionId,
      customer_details: { customer_name: s.customer.name.slice(0, 100), customer_email: s.customer.email, customer_phone: s.customer.phone },
      plan_details: { plan_name: `Strats360 People · up to ₹${s.maxAmount.toLocaleString("en-IN")}`.slice(0, 40), plan_type: "ON_DEMAND", plan_currency: "INR", plan_max_amount: s.maxAmount, plan_note: s.note.slice(0, 100) },
      authorization_details: { authorization_amount: 1, authorization_amount_refund: true, payment_methods: s.method === "upi" ? ["upi"] : ["enach"] },
      subscription_meta: { return_url: s.returnUrl, notification_channel: ["EMAIL", "SMS"] },
      subscription_expiry_time: expiry,
      subscription_tags: { purpose: "saas-invoices" },
    },
    s.subscriptionId,
    cfg.subsApiVersion,
  );
  return parseSubscription(r);
}

export async function getSubscription(cfg: CashfreeConfig, subscriptionId: string) {
  return parseSubscription(await call<Record<string, any>>(cfg, "GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`, undefined, undefined, cfg.subsApiVersion));
}

/** Charge an invoice against an active mandate. Debits happen on the scheduled date, after the bank's pre-debit notice. */
export async function chargeSubscription(cfg: CashfreeConfig, c: { subscriptionId: string; paymentId: string; amount: number; scheduleAt: Date; remarks: string }) {
  const r = await call<Record<string, any>>(
    cfg,
    "POST",
    "/subscriptions/pay",
    { subscription_id: c.subscriptionId, payment_id: c.paymentId, payment_amount: Math.round(c.amount * 100) / 100, payment_schedule_date: c.scheduleAt.toISOString(), payment_remarks: c.remarks.slice(0, 100), payment_type: "CHARGE" },
    c.paymentId,
    cfg.subsApiVersion,
  );
  return parsePayment(r);
}

export async function getSubscriptionPayment(cfg: CashfreeConfig, subscriptionId: string, paymentId: string) {
  return parsePayment(await call<Record<string, any>>(cfg, "GET", `/subscriptions/${encodeURIComponent(subscriptionId)}/payments/${encodeURIComponent(paymentId)}`, undefined, undefined, cfg.subsApiVersion));
}

export async function manageSubscription(cfg: CashfreeConfig, subscriptionId: string, action: "CANCEL" | "PAUSE" | "ACTIVATE") {
  return parseSubscription(await call<Record<string, any>>(cfg, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, { subscription_id: subscriptionId, action }, undefined, cfg.subsApiVersion));
}

/** Cashfree subscription status -> our mandate status. */
export function mandateStatus(cf: string) {
  const s = cf.toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "ON_HOLD" || s === "PAUSED") return "paused";
  if (s === "CANCELLED" || s === "CUSTOMER_CANCELLED" || s === "COMPLETED") return "cancelled";
  if (s === "LINK_EXPIRED" || s === "EXPIRED") return "expired";
  if (s.includes("FAIL") || s === "REJECTED") return "failed";
  if (s === "BANK_APPROVAL_PENDING" || s === "PENDING" || s === "CUSTOMER_PAUSED") return "pending";
  return "initialized";
}

/** Pull subscription and payment ids out of a webhook, whatever the payload version. */
export function webhookIds(body: Record<string, any>) {
  const d = body.data ?? {};
  return {
    subscriptionId: str(pick(d, "subscription_details.subscription_id", "subscription_id", "payment_details.subscription_id", "authorization_details.subscription_id")),
    paymentId: str(pick(d, "payment_details.payment_id", "payment_id", "merchant_payment_id")),
  };
}
