import type { Env } from "../env";

/**
 * Cashfree Payment Gateway (PG API). Orders are created on the server; the browser
 * opens Cashfree checkout with the payment_session_id; Cashfree calls our webhook.
 */
export interface CashfreeConfig {
  appId: string;
  secret: string;
  mode: "sandbox" | "production";
  base: string;
  apiVersion: string;
  /** Subscriptions API version (autopay). */
  subsApiVersion: string;
}

export function cashfreeConfig(env: Env): CashfreeConfig | null {
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) return null;
  const mode = env.CASHFREE_ENV === "production" ? "production" : "sandbox";
  return {
    appId: env.CASHFREE_APP_ID,
    secret: env.CASHFREE_SECRET_KEY,
    mode,
    base: mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
    apiVersion: env.CASHFREE_API_VERSION || "2023-08-01",
    subsApiVersion: env.CASHFREE_SUBS_API_VERSION || "2025-01-01",
  };
}

export class CashfreeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function call<T>(cfg: CashfreeConfig, method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string, apiVersion?: string): Promise<T> {
  const headers: Record<string, string> = {
    "x-client-id": cfg.appId,
    "x-client-secret": cfg.secret,
    "x-api-version": apiVersion ?? cfg.apiVersion,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  const res = await fetch(`${cfg.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new CashfreeError(String(json.message ?? `Cashfree request failed (${res.status})`), res.status, json.code as string | undefined);
  return json as T;
}

export interface CfOrder {
  cf_order_id?: string | number;
  order_id: string;
  order_amount: number;
  order_currency: string;
  order_status: "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED" | "TERMINATION_REQUESTED" | string;
  payment_session_id?: string;
  order_expiry_time?: string;
}
export interface CfPayment {
  cf_payment_id: string | number;
  order_id?: string;
  payment_status: "SUCCESS" | "FAILED" | "USER_DROPPED" | "PENDING" | "NOT_ATTEMPTED" | "CANCELLED" | "VOID" | string;
  payment_amount: number;
  payment_currency?: string;
  payment_group?: string;
  payment_message?: string;
  bank_reference?: string | null;
  payment_time?: string;
}

export function createOrder(
  cfg: CashfreeConfig,
  o: { orderId: string; amount: number; customer: { id: string; name: string; email: string; phone: string }; returnUrl: string; notifyUrl: string; note: string; tags: Record<string, string> },
) {
  return call<CfOrder>(
    cfg,
    "POST",
    "/orders",
    {
      order_id: o.orderId,
      order_amount: Math.round(o.amount * 100) / 100,
      order_currency: "INR",
      customer_details: { customer_id: o.customer.id, customer_name: o.customer.name.slice(0, 100), customer_email: o.customer.email, customer_phone: o.customer.phone },
      order_meta: { return_url: o.returnUrl, notify_url: o.notifyUrl },
      order_note: o.note.slice(0, 200),
      order_tags: o.tags,
      // checkout links stay valid for 30 minutes
      order_expiry_time: new Date(Date.now() + 30 * 60_000).toISOString(),
    },
    o.orderId,
  );
}

export const getOrder = (cfg: CashfreeConfig, orderId: string) => call<CfOrder>(cfg, "GET", `/orders/${encodeURIComponent(orderId)}`);
export const getPayments = (cfg: CashfreeConfig, orderId: string) => call<CfPayment[]>(cfg, "GET", `/orders/${encodeURIComponent(orderId)}/payments`);

/** Cashfree signs webhooks as base64(HMAC-SHA256(timestamp + rawBody, secret key)). */
export async function webhookSignature(secret: string, timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyWebhook(secret: string, timestamp: string | undefined, signature: string | undefined, rawBody: string, maxAgeSeconds = 900) {
  if (!timestamp || !signature) return false;
  // reject replays: Cashfree sends the timestamp in milliseconds
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && Math.abs(Date.now() - (ts > 1e12 ? ts : ts * 1000)) > maxAgeSeconds * 1000) return false;
  const expected = await webhookSignature(secret, timestamp, rawBody);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Cashfree payment_group -> our payment method label. */
export function methodOf(group?: string) {
  if (!group) return "online";
  if (group.includes("upi")) return "upi";
  if (group.includes("card")) return "card";
  if (group.includes("net_banking") || group.includes("netbanking")) return "netbanking";
  if (group.includes("wallet")) return "wallet";
  return group;
}
