import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { siteControlToken } from "@hrms/shared";
import app from "../src/index";
import { resetAccessCache, verifyAccess } from "../src/access";

const KEY = "test-control-plane-key";
const SITES = [
  { key: "india", name: "Saralix India", url: "https://in.example", region: "India (Mumbai)" },
  { key: "gulf", name: "Saralix Gulf", url: "https://gulf.example", region: "Gulf" },
];
const env = (o: Record<string, string> = {}) => ({ CONTROL_PLANE_KEY: KEY, SITES: JSON.stringify(SITES), ENVIRONMENT: "production", ...o });
const post = (email: string, e = env()) => app.request("/continue", { method: "POST", body: new URLSearchParams({ email }), headers: { "content-type": "application/x-www-form-urlencoded" } }, e);

/** Fake sites: who signs in where, checking each site gets its own token. */
function fakeSites(members: Record<string, string[]>) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const site = SITES.find((s) => url.startsWith(s.url))!;
    const auth = (init.headers as Record<string, string>).authorization;
    if (auth !== `Bearer ${await siteControlToken(KEY, site.key)}`) return new Response("no", { status: 401 });
    if (url.endsWith("/api/control/route")) {
      const { email } = JSON.parse(String(init.body));
      return Response.json({ found: (members[site.key] ?? []).includes(email) });
    }
    if (url.endsWith("/summary")) return Response.json({ companies: 2, payingCompanies: 1, activeEmployees: 250, site: { version: "1.4.0" } });
    if (url.endsWith("/tenants")) return Response.json({ tenants: [{ id: `${site.key}-1`, code: "TN-0142", name: `${site.name} Customer`, plan: "growth", status: "active", country: site.key === "india" ? "IN" : "AE", currency: "INR", employees: 250, createdAt: "2026-01-01", trialEndsAt: null, demo: false }] });
    if (url.endsWith("/revenue")) return Response.json({ months: [{ period: "2026-10", currency: "INR", invoiced: 41494, collected: 41494, count: 1 }] });
    return new Response("not found", { status: 404 });
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("login routing", () => {
  it("shows the sign in form", async () => {
    const r = await app.request("/", {}, env());
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('name="email"');
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("rejects a bad email", async () => {
    expect((await post("nope")).status).toBe(400);
  });

  it("sends people straight to their site, email in the fragment", async () => {
    fakeSites({ gulf: ["sara@acme.ae"] });
    const r = await post("Sara@Acme.ae");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://gulf.example/login#email=sara%40acme.ae");
  });

  it("lets someone on two sites choose", async () => {
    fakeSites({ india: ["ravi@group.com"], gulf: ["ravi@group.com"] });
    const body = await (await post("ravi@group.com")).text();
    expect(body).toContain("more than one site");
    expect(body).toContain("https://in.example/login#email=ravi%40group.com");
    expect(body).toContain("https://gulf.example/login#email=ravi%40group.com");
  });

  it("doesn't say whether an unknown email exists", async () => {
    fakeSites({});
    const body = await (await post("stranger@example.com")).text();
    expect(body).toContain("Pick the site your company uses");
    expect(body).not.toMatch(/not found|no account|doesn't exist/i);
  });

  it("goes straight to the only site when there's one", async () => {
    const r = await post("a@b.co", env({ SITES: JSON.stringify([SITES[0]]) }));
    expect(r.headers.get("location")).toBe("https://in.example/login#email=a%40b.co");
  });
});

describe("console", () => {
  it("is closed without Cloudflare Access", async () => {
    expect((await app.request("/console", {}, env())).status).toBe(403);
    expect((await app.request("/console/companies.csv", {}, env())).status).toBe(403);
  });

  it("shows every site's companies and revenue", async () => {
    fakeSites({});
    const body = await (await app.request("/console", {}, env({ ENVIRONMENT: "development" }))).text();
    expect(body).toContain("Saralix India Customer");
    expect(body).toContain("Saralix Gulf Customer");
    expect(body).toContain("2 of 2");
    expect(body).toContain("₹41,494");
    const csv = await (await app.request("/console/companies.csv", {}, env({ ENVIRONMENT: "development" }))).text();
    expect(csv.split("\n")[1]).toContain("Saralix India Customer,TN-0142,Saralix India,IN");
  });

  it("still lists a site that's down", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const body = await (await app.request("/console", {}, env({ ENVIRONMENT: "development" }))).text();
    expect(body).toContain("0 of 2");
    expect(body).toContain("answered 503");
  });
});

describe("Cloudflare Access token", () => {
  let keys: CryptoKeyPair;
  let jwk: JsonWebKey & { kid: string };
  const team = "saralix.cloudflareaccess.com";
  const b64 = (b: ArrayBuffer | Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sign = async (claims: Record<string, unknown>) => {
    const head = b64(JSON.stringify({ alg: "RS256", kid: "k1" }));
    const body = b64(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64(sig)}`;
  };
  beforeAll(async () => {
    keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
  });
  const certs = (async () => Response.json({ keys: [jwk] })) as unknown as typeof fetch;
  const cfg = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: "aud123" };
  const now = Date.now();
  const good = () => ({ aud: ["aud123"], iss: `https://${team}`, exp: Math.floor(now / 1000) + 600, email: "pankaj@example.com" });

  it("accepts a valid token", async () => {
    resetAccessCache();
    expect(await verifyAccess(await sign(good()), cfg, certs, now)).toEqual({ email: "pankaj@example.com" });
  });
  it("rejects the wrong audience, issuer, an expired token or a forged signature", async () => {
    resetAccessCache();
    expect(await verifyAccess(await sign({ ...good(), aud: ["other"] }), cfg, certs, now)).toBeNull();
    expect(await verifyAccess(await sign({ ...good(), iss: "https://evil.example" }), cfg, certs, now)).toBeNull();
    expect(await verifyAccess(await sign({ ...good(), exp: Math.floor(now / 1000) - 10 }), cfg, certs, now)).toBeNull();
    const t = await sign(good());
    const forged = t.slice(0, t.lastIndexOf(".") + 1) + b64("forged signature bytes");
    expect(await verifyAccess(forged, cfg, certs, now)).toBeNull();
    expect(await verifyAccess(undefined, cfg, certs, now)).toBeNull();
  });
});
