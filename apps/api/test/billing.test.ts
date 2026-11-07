import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { todayIST } from "@hrms/shared";
import { Client, env, lastEmailTo, login } from "./helpers";

let platform: Client, kunal: Client, nisha: Client;
const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const PERIOD = "2026-03"; // before the seeded invoices

beforeAll(async () => {
  [platform, kunal, nisha] = await Promise.all([login("platform@strats360people.in"), login("kunal.shah@strats360.com"), login("nisha.trivedi@strats360.com")]);
});
afterAll(async () => {
  await sql`update tenants set status = 'active' where code = 'TN-0142'`;
  await sql.end();
});

describe("Plans", () => {
  it("lists plans with tenant counts; only platform staff see them", async () => {
    const r = await platform.get("/platform/billing/plans");
    expect(r.status).toBe(200);
    expect(r.body.map((p: any) => p.key)).toEqual(["starter", "growth", "enterprise"]);
    expect(r.body.find((p: any) => p.key === "growth").tenants).toBeGreaterThanOrEqual(1);
    expect((await kunal.get("/platform/billing/plans")).status).toBe(403);
    const c = await platform.post("/platform/billing/plans", { key: "nonprofit", name: "Non-profit", pricePerEmployee: 49, features: ["Everything in Growth"] });
    expect(c.status).toBe(201);
    expect((await platform.patch(`/platform/billing/plans/${c.body.id}`, { active: false })).body.active).toBe(false);
  });
});

describe("Billing run", () => {
  let invId = "";
  it("previews who gets billed and why others are skipped", async () => {
    const r = await platform.post("/platform/billing/run/preview", { period: PERIOD });
    expect(r.status).toBe(200);
    const demo = r.body.drafts.find((d: any) => d.tenantCode === "TN-0142");
    expect(demo.skip).toBeNull();
    expect(demo.rate).toBe(149);
    expect(demo.cgst).toBeGreaterThan(0); // Gujarat to Gujarat
    expect(demo.igst).toBe(0);
    expect(demo.total).toBeCloseTo(demo.subtotal * 1.18, 1);
    const oct = await platform.post("/platform/billing/run/preview", { period: "2026-10" });
    expect(oct.body.drafts.find((d: any) => d.tenantCode === "TN-0142").skip).toMatch(/Already invoiced/);
    expect((await platform.post("/platform/billing/run", { period: todayIST().slice(0, 7) })).status).toBe(400);
  });

  it("issues invoices and emails the billing contact", async () => {
    const r = await platform.post("/platform/billing/run", { period: PERIOD });
    expect(r.status).toBe(201);
    expect(r.body.created).toBeGreaterThanOrEqual(1);
    expect(lastEmailTo("accounts@strats360.com")?.subject).toMatch(/^Invoice INV-P-2603-/);
    expect((await platform.post("/platform/billing/run", { period: PERIOD })).body.created).toBe(0); // no duplicates
    const list = (await platform.get(`/platform/billing/invoices?period=${PERIOD}`)).body;
    invId = list[0].id;
    expect(list[0].number).toMatch(/^INV-P-2603-\d{4}$/);
    expect(list[0].seller.gstin).toBe("24AAICS7781M1ZK");
  });

  it("voids an invoice so the period can be billed again", async () => {
    expect((await platform.post(`/platform/billing/invoices/${invId}/void`, { reason: "Wrong seat count" })).body.status).toBe("void");
    expect((await platform.post("/platform/billing/run", { period: PERIOD })).body.created).toBe(1);
  });

  it("exports GSTR-1 for invoices issued in a month", async () => {
    const r = await platform.get(`/platform/billing/gstr1.csv?period=${todayIST().slice(0, 7)}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("B2B");
    expect(r.body).toContain("24-Gujarat");
  });
});

describe("Collections and dunning", () => {
  it("marks a tenant past due, then restores it on payment", async () => {
    const [inv] = await sql`select id, number from invoices where period = ${PERIOD} and status = 'issued' limit 1`;
    await sql`update invoices set due_on = (current_date - 20) where id = ${inv!.id}`;
    const s = (await platform.get("/platform/billing/summary")).body;
    expect(s.overdue.invoices).toBeGreaterThanOrEqual(1);
    const plan = (await platform.get("/platform/billing/dunning")).body.rows.find((r: any) => r.invoiceId === inv!.id);
    expect(plan.action).toBe("past_due");
    const run = await platform.post("/platform/billing/dunning/run");
    expect(run.body.pastDue).toBeGreaterThanOrEqual(1);
    expect(lastEmailTo("accounts@strats360.com")?.subject).toMatch(/overdue/);
    const mine = (await kunal.get("/admin/billing")).body;
    expect(mine.status).toBe("past_due");
    expect(mine.overdue).toBeGreaterThan(0);
    const paid = await platform.post(`/platform/billing/invoices/${inv!.id}/payment`, { paidOn: todayIST(), method: "neft", reference: "UTR123" });
    expect(paid.body.status).toBe("paid");
    expect(paid.body.restored).toBe(true);
    expect((await kunal.get("/admin/billing")).body.status).toBe("active");
  });
});

describe("Tenant billing page", () => {
  it("shows plan, seats, the next invoice and history", async () => {
    const r = await kunal.get("/admin/billing");
    expect(r.status).toBe(200);
    expect(r.body.plan.name).toBe("Growth");
    expect(r.body.seats.active).toBeGreaterThan(200);
    expect(r.body.nextInvoice.total).toBeGreaterThan(0);
    expect(r.body.invoices.length).toBeGreaterThanOrEqual(7);
    const one = await kunal.get(`/admin/billing/invoices/${r.body.invoices[0].id}`);
    expect(one.body.entity.legalName).toBeTruthy();
    expect((await nisha.get("/admin/billing")).status).toBe(403);
    expect((await kunal.patch("/admin/billing/details", { billingEmail: "finance@strats360.com" })).body.billingEmail).toBe("finance@strats360.com");
    await kunal.patch("/admin/billing/details", { billingEmail: "accounts@strats360.com" });
  });
});
