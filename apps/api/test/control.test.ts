import { afterAll, describe, expect, it } from "vitest";
import { siteControlToken } from "@hrms/shared";
import { Client, env } from "./helpers";

const call = (method: string, path: string, token?: string, body?: unknown) => new Client().req(method, `/control${path}`, body, token ? { authorization: `Bearer ${token}` } : {});

afterAll(() => {
  delete env.CONTROL_TOKEN;
});

describe("control API", () => {
  it("is off until the site has a control token", async () => {
    delete env.CONTROL_TOKEN;
    expect((await call("GET", "/summary", "anything")).status).toBe(404);
  });

  it("needs the site's own token", async () => {
    env.CONTROL_TOKEN = await siteControlToken("test-control-plane-key", "local");
    expect((await call("GET", "/summary")).status).toBe(401);
    expect((await call("GET", "/summary", await siteControlToken("test-control-plane-key", "gulf"))).status).toBe(401); // another site's token
    const r = await call("GET", "/summary", env.CONTROL_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.site).toMatchObject({ key: "local", countries: ["IN"] });
    expect(r.body.companies).toBeGreaterThanOrEqual(1);
    expect(r.body.activeEmployees).toBeGreaterThan(200);
  });

  it("lists companies with company level data only", async () => {
    const r = await call("GET", "/tenants", env.CONTROL_TOKEN);
    const s = r.body.tenants.find((t: any) => t.code === "TN-0142");
    expect(s).toMatchObject({ name: "Strats360 Technolabs LLP", plan: "growth", country: "IN", currency: "INR", demo: false });
    expect(s.employees).toBeGreaterThan(200);
    // nothing about people
    expect(Object.keys(s).sort()).toEqual(["code", "country", "createdAt", "currency", "demo", "employees", "id", "name", "plan", "status", "trialEndsAt"]);
  });

  it("says whether an email signs in here, without storing it", async () => {
    expect((await call("POST", "/route", env.CONTROL_TOKEN, { email: "Kunal.Shah@strats360.com" })).body).toEqual({ found: true });
    expect((await call("POST", "/route", env.CONTROL_TOKEN, { email: "platform@saralix.com" })).body).toEqual({ found: true });
    expect((await call("POST", "/route", env.CONTROL_TOKEN, { email: "nobody@example.com" })).body).toEqual({ found: false });
    expect((await call("POST", "/route", env.CONTROL_TOKEN, { email: "not an email" })).status).toBe(422);
  });

  it("reports revenue by month", async () => {
    const r = await call("GET", "/revenue", env.CONTROL_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.months[0]).toMatchObject({ currency: "INR" });
    expect(r.body.months[0].invoiced).toBeGreaterThan(0);
  });
});
