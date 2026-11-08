import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login } from "./helpers";
import { webhookSignature } from "../src/services/cashfree";

let kunal: Client, platform: Client;
const SECRET = "cf_test_secret_key";
const calls: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
const subs = new Map<string, string>(); // subscription_id -> status
const subPays = new Map<string, any>(); // payment_id -> payment
const realFetch = globalThis.fetch;

function stub() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://sandbox.cashfree.com/pg")) return realFetch(input as any, init);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers, body });
    const path = url.replace("https://sandbox.cashfree.com/pg", "");
    if (path === "/subscriptions" && method === "POST") {
      subs.set(body.subscription_id, "INITIALIZED");
      return Response.json({ subscription_id: body.subscription_id, cf_subscription_id: "77001", subscription_session_id: `sub_session_${body.subscription_id}`, subscription_status: "INITIALIZED" });
    }
    if (path === "/subscriptions/pay" && method === "POST") {
      subPays.set(body.payment_id, { payment_id: body.payment_id, cf_payment_id: "88001", payment_status: "INITIALIZED", payment_amount: body.payment_amount });
      return Response.json(subPays.get(body.payment_id));
    }
    let m = path.match(/^\/subscriptions\/([^/]+)\/payments\/([^/]+)$/);
    if (m) return Response.json(subPays.get(decodeURIComponent(m[2]!)) ?? {});
    m = path.match(/^\/subscriptions\/([^/]+)\/manage$/);
    if (m) {
      subs.set(decodeURIComponent(m[1]!), "CANCELLED");
      return Response.json({ subscription_id: m[1], subscription_status: "CANCELLED" });
    }
    m = path.match(/^\/subscriptions\/([^/]+)$/);
    if (m) return Response.json({ subscription_id: decodeURIComponent(m[1]!), cf_subscription_id: "77001", subscription_status: subs.get(decodeURIComponent(m[1]!)) ?? "INITIALIZED", authorization_details: { payment_method: { enach: { account_number: "50100012345678" } } } });
    return new Response("{}", { status: 404 });
  });
}

async function hook(type: string, data: Record<string, unknown>) {
  const payload = { type, event_time: new Date().toISOString(), data };
  const ts = String(Date.now());
  const sig = await webhookSignature(SECRET, ts, JSON.stringify(payload));
  return new Client().req("POST", "/public/payments/cashfree/webhook", payload, { "x-webhook-timestamp": ts, "x-webhook-signature": sig });
}

beforeAll(async () => {
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

describe("Autopay (Cashfree Subscriptions)", () => {
  let subscriptionId = "";
  let chargeId = "";

  it("is offered once Cashfree is connected, with a suggested limit", async () => {
    expect((await kunal.get("/admin/billing/autopay")).body.available).toBe(false);
    env.CASHFREE_APP_ID = "cf_test_app";
    env.CASHFREE_SECRET_KEY = SECRET;
    stub();
    const r = (await kunal.get("/admin/billing/autopay")).body;
    expect(r.available).toBe(true);
    expect(r.upiLimit).toBe(15000);
    expect(r.suggestedMax).toBeGreaterThan(40000);
  });

  it("keeps UPI autopay under the RBI limit and sets up a bank e-mandate", async () => {
    const upi = await kunal.post("/admin/billing/autopay", { method: "upi", maxAmount: 60000 });
    expect(upi.status).toBe(400);
    expect(upi.body.error.message).toMatch(/e-mandate/);
    const r = await kunal.post("/admin/billing/autopay", { method: "enach", maxAmount: 60000 });
    expect(r.status).toBe(201);
    subscriptionId = r.body.subscriptionId;
    expect(r.body.sessionId).toBe(`sub_session_${subscriptionId}`);
    const create = calls.find((x) => x.url.endsWith("/subscriptions") && x.method === "POST")!;
    expect(create.headers["x-api-version"]).toBe("2025-01-01");
    expect(create.body.plan_details).toMatchObject({ plan_type: "ON_DEMAND", plan_max_amount: 60000 });
    expect(create.body.authorization_details.payment_methods).toEqual(["enach"]);
    expect(create.body.subscription_meta.return_url).toContain(`autopay=${subscriptionId}`);
  });

  it("turns on after the bank approves, and lines up the open invoice", async () => {
    await platform.post("/platform/billing/run", { period: "2025-11" });
    subs.set(subscriptionId, "ACTIVE");
    const s = await kunal.get(`/admin/billing/autopay/${subscriptionId}`);
    expect(s.body.mandate.status).toBe("active");
    expect(s.body.mandate.payer).toBe("A/c ····5678");
    const charge = calls.find((x) => x.url.endsWith("/subscriptions/pay"))!;
    expect(charge).toBeTruthy();
    chargeId = charge.body.payment_id;
    expect(Date.parse(charge.body.payment_schedule_date) - Date.now()).toBeGreaterThan(24 * 3600_000); // after the pre-debit notice
    const a = (await kunal.get("/admin/billing/autopay")).body;
    expect(a.nextCharge.amount).toBe(charge.body.payment_amount);
    expect((await kunal.get("/admin/billing")).body.billing.paymentMethod).toMatch(/^Bank e-mandate/);
    expect((await kunal.post("/admin/billing/autopay", { method: "enach", maxAmount: 70000 })).status).toBe(409);
  });

  it("settles the invoice when the debit succeeds", async () => {
    subPays.set(chargeId, { payment_id: chargeId, cf_payment_id: "88001", payment_status: "SUCCESS", payment_amount: subPays.get(chargeId).payment_amount, bank_reference: "NACH123" });
    const w = await hook("SUBSCRIPTION_PAYMENT_SUCCESS", { payment_details: { payment_id: chargeId, subscription_id: subscriptionId } });
    expect(w.status).toBe(200);
    expect(w.body.status).toBe("paid");
    const inv = (await kunal.get("/admin/billing")).body.invoices.find((i: any) => i.paymentReference?.includes("88001"));
    expect(inv.status).toBe("paid");
    expect(inv.paymentMethod).toBe("enach");
    expect((await hook("SUBSCRIPTION_PAYMENT_SUCCESS", { payment_details: { payment_id: chargeId } })).status).toBe(200); // idempotent
  });

  it("charges new invoices from the billing run, and reports failures", async () => {
    const run = await platform.post("/platform/billing/run", { period: "2025-10" });
    expect(run.body.autopay).toBe(1);
    const charge = calls.filter((x) => x.url.endsWith("/subscriptions/pay")).at(-1)!;
    subPays.set(charge.body.payment_id, { payment_id: charge.body.payment_id, cf_payment_id: "88002", payment_status: "FAILED", payment_amount: charge.body.payment_amount, failure_details: { failure_reason: "Insufficient balance" } });
    const w = await hook("SUBSCRIPTION_PAYMENT_FAILED", { payment_details: { payment_id: charge.body.payment_id } });
    expect(w.body.status).toBe("failed");
    expect(lastEmailTo("accounts@strats360.com")?.subject).toBe("Autopay debit failed");
    const inv = (await kunal.get("/admin/billing")).body.invoices.find((i: any) => i.period === "2025-10");
    expect(inv.status).toBe("issued"); // still payable by hand
    const retry = await platform.post(`/platform/billing/invoices/${inv.id}/autopay`);
    expect(retry.status).toBe(200);
  });

  it("follows mandate status changes and can be cancelled", async () => {
    await kunal.post("/admin/billing/autopay/cancel");
    expect(calls.some((x) => x.url.endsWith(`/subscriptions/${subscriptionId}/manage`) && x.body.action === "CANCEL")).toBe(true);
    const a = (await kunal.get("/admin/billing/autopay")).body;
    expect(a.mandate.status).toBe("cancelled");
    expect(a.nextCharge).toBeNull(); // the pending retry was withdrawn
    expect((await kunal.get("/admin/billing")).body.billing.paymentMethod).toBeFalsy();
    expect((await hook("SUBSCRIPTION_STATUS_CHANGED", { subscription_details: { subscription_id: subscriptionId } })).body.mandate).toBe("cancelled");
  });
});
