import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login } from "./helpers";
import { webhookSignature } from "../src/services/cashfree";

let kunal: Client, platform: Client;
const SECRET = "cf_test_secret_key";
const calls: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
const payments = new Map<string, any[]>();
const realFetch = globalThis.fetch;

/** Stand-in for Cashfree's sandbox API. */
function stubCashfree() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://sandbox.cashfree.com/pg")) return realFetch(input as any, init);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", url, headers, body });
    if (headers["x-client-secret"] !== SECRET) return new Response(JSON.stringify({ message: "authentication Failed", code: "request_failed" }), { status: 401 });
    const m = url.match(/\/orders\/([^/]+)\/payments$/);
    if (m) return Response.json(payments.get(decodeURIComponent(m[1]!)) ?? []);
    if (url.endsWith("/orders") && init?.method === "POST") return Response.json({ cf_order_id: 900001, order_id: body.order_id, order_amount: body.order_amount, order_currency: "INR", order_status: "ACTIVE", payment_session_id: `session_${body.order_id}` });
    return new Response("{}", { status: 404 });
  });
}

async function webhook(orderId: string, opts: { secret?: string; ts?: number } = {}) {
  const payload = { type: "PAYMENT_SUCCESS_WEBHOOK", event_time: new Date().toISOString(), data: { order: { order_id: orderId } } };
  const raw = JSON.stringify(payload);
  const ts = String(opts.ts ?? Date.now());
  const sig = await webhookSignature(opts.secret ?? SECRET, ts, raw);
  return new Client().req("POST", "/public/payments/cashfree/webhook", payload, { "x-webhook-timestamp": ts, "x-webhook-signature": sig });
}

beforeAll(async () => {
  // Cashfree needs a mobile number; the demo company has a landline
  const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await sql`update tenants set contact_phone = '+91 98250 12345' where code = 'TN-0142'`;
  await sql.end();
  [kunal, platform] = await Promise.all([login("kunal.shah@strats360.com"), login("platform@strats360people.in")]);
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete env.CASHFREE_APP_ID;
  delete env.CASHFREE_SECRET_KEY;
});

const openInvoice = async () => (await kunal.get("/admin/billing")).body.invoices.find((i: any) => i.status === "issued");

describe("Cashfree payments", () => {
  let orderId = "";
  let invoiceId = "";
  let total = 0;

  it("isn't offered until the gateway is configured", async () => {
    const inv = await openInvoice();
    expect(inv).toBeTruthy();
    invoiceId = inv.id;
    total = Number(inv.total);
    expect((await kunal.get("/admin/billing")).body.payOnline).toBe(false);
    expect((await kunal.post(`/admin/billing/invoices/${invoiceId}/pay`)).status).toBe(503);
    env.CASHFREE_APP_ID = "cf_test_app";
    env.CASHFREE_SECRET_KEY = SECRET;
    stubCashfree();
    expect((await kunal.get("/admin/billing")).body.payOnline).toBe(true);
    expect((await platform.get("/platform/billing/gateway")).body).toMatchObject({ configured: true, mode: "sandbox" });
  });

  it("creates a Cashfree order for the invoice total and reuses an open checkout", async () => {
    const r = await kunal.post(`/admin/billing/invoices/${invoiceId}/pay`);
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe("sandbox");
    orderId = r.body.orderId;
    expect(r.body.paymentSessionId).toBe(`session_${orderId}`);
    const create = calls.find((x) => x.method === "POST")!;
    expect(create.headers["x-api-version"]).toBe("2023-08-01");
    expect(create.headers["x-client-id"]).toBe("cf_test_app");
    expect(create.body.order_amount).toBe(total);
    expect(create.body.customer_details.customer_phone).toMatch(/^[6-9]\d{9}$/);
    expect(create.body.order_meta.return_url).toContain("/settings/billing?order_id={order_id}");
    expect(create.body.order_meta.notify_url).toContain("/api/public/payments/cashfree/webhook");
    const again = await kunal.post(`/admin/billing/invoices/${invoiceId}/pay`);
    expect(again.body.orderId).toBe(orderId); // no second order
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(1);
  });

  it("rejects webhooks that aren't signed by Cashfree, or are stale", async () => {
    expect((await webhook(orderId, { secret: "wrong" })).status).toBe(401);
    expect((await webhook(orderId, { ts: Date.now() - 3600_000 })).status).toBe(401);
  });

  it("settles the invoice once from the webhook, and the return page agrees", async () => {
    payments.set(orderId, [{ cf_payment_id: 5551234, payment_status: "SUCCESS", payment_amount: total, payment_group: "upi", bank_reference: "UTR998877", payment_time: new Date().toISOString() }]);
    const w = await webhook(orderId);
    expect(w.status).toBe(200);
    expect(w.body.status).toBe("paid");
    const inv = (await kunal.get(`/admin/billing/invoices/${invoiceId}`)).body;
    expect(inv.status).toBe("paid");
    expect(inv.paymentMethod).toBe("upi");
    expect(inv.paymentReference).toContain("5551234");
    expect(inv.onlinePayments[0].status).toBe("paid");
    expect(lastEmailTo("accounts@strats360.com")?.subject).toMatch(/^Payment received/);
    // retries from Cashfree and the return page are harmless
    expect((await webhook(orderId)).status).toBe(200);
    const st = await kunal.get(`/admin/billing/payments/${orderId}`);
    expect(st.body.status).toBe("paid");
    expect(st.body.invoice.status).toBe("paid");
    expect((await kunal.post(`/admin/billing/invoices/${invoiceId}/pay`)).status).toBe(400); // already paid
  });

  it("never settles on a different amount, and records failures", async () => {
    await platform.post("/platform/billing/run", { period: "2026-01" });
    const inv = (await kunal.get("/admin/billing")).body.invoices.find((i: any) => i.period === "2026-01" && i.status === "issued");
    const r = await kunal.post(`/admin/billing/invoices/${inv.id}/pay`);
    payments.set(r.body.orderId, [{ cf_payment_id: 1, payment_status: "SUCCESS", payment_amount: 1, payment_group: "upi" }]);
    expect((await webhook(r.body.orderId)).body.status).toBe("failed");
    expect((await kunal.get(`/admin/billing/invoices/${inv.id}`)).body.status).toBe("issued");
    const r2 = await kunal.post(`/admin/billing/invoices/${inv.id}/pay`);
    payments.set(r2.body.orderId, [{ cf_payment_id: 2, payment_status: "FAILED", payment_amount: Number(inv.total), payment_message: "Insufficient funds" }]);
    const st = await kunal.get(`/admin/billing/payments/${r2.body.orderId}`);
    expect(st.body.status).toBe("failed");
    expect(st.body.failureReason).toBe("Insufficient funds");
  });
});
