import { Hono } from "hono";
import { fmtMoney } from "@hrms/shared";
import { verifyAccess } from "./access";
import { html, page } from "./html";
import { callSite, type Site } from "./sites";
import type { AppEnv } from "./index";

interface Tenant {
  id: string;
  code: string;
  name: string;
  plan: string;
  status: string;
  country: string | null;
  currency: string | null;
  employees: number;
  createdAt: string;
  trialEndsAt: string | null;
  demo: boolean;
}
interface Summary {
  companies: number;
  payingCompanies: number;
  activeEmployees: number;
  site: { version: string };
}
interface Month {
  period: string;
  currency: string;
  invoiced: number;
  collected: number;
  count: number;
}
export interface SiteView {
  site: Site;
  up: boolean;
  error: string | null;
  version: string | null;
  summary: Summary | null;
  tenants: Tenant[];
  months: Month[];
}

/** Everything the console shows for one site. A site that's down still gets a row. */
export async function loadSite(site: Site, key: string, fetchImpl: typeof fetch = fetch): Promise<SiteView> {
  try {
    const [summary, tenants, revenue] = await Promise.all([
      callSite<Summary>(site, key, "/summary", {}, fetchImpl),
      callSite<{ tenants: Tenant[] }>(site, key, "/tenants", {}, fetchImpl),
      callSite<{ months: Month[] }>(site, key, "/revenue", {}, fetchImpl),
    ]);
    return { site, up: true, error: null, version: summary.site.version, summary, tenants: tenants.tenants, months: revenue.months };
  } catch (e) {
    return { site, up: false, error: e instanceof Error ? (e.name === "AbortError" ? "no answer in 5 seconds" : e.message) : String(e), version: null, summary: null, tenants: [], months: [] };
  }
}

export const consoleRoutes = new Hono<AppEnv>();

// Cloudflare Access signs staff in; we verify its token. Local development can open it without.
consoleRoutes.use("*", async (c, next) => {
  const dev = c.env.ENVIRONMENT === "development";
  const user = dev ? { email: "dev@localhost" } : await verifyAccess(c.req.header("cf-access-jwt-assertion"), c.env);
  if (!user) return c.html(page("Not allowed", html`<div class="card"><h1>Not allowed</h1><p class="muted">The console is for Saralix staff. Sign in through Cloudflare Access first.</p></div>`), 403);
  c.set("staff", user);
  await next();
});

const STATUS: Record<string, string> = { active: "Active", trial: "Trial", past_due: "Past due", suspended: "Suspended", cancelled: "Cancelled" };

consoleRoutes.get("/", async (c) => {
  const key = c.env.CONTROL_PLANE_KEY;
  if (!key) return c.html(page("Console", html`<div class="card"><h1>Not set up</h1><p class="muted">Add the CONTROL_PLANE_KEY secret to the control plane Worker.</p></div>`), 503);
  const views = await Promise.all(c.get("sites").map((s) => loadSite(s, key)));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const only = c.req.query("site") ?? "";
  const all = views.flatMap((v) => v.tenants.map((t) => ({ ...t, site: v.site })));
  const rows = all.filter((t) => (!only || t.site.key === only) && (!q || `${t.name} ${t.code}`.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const real = all.filter((t) => !t.demo);
  const versions = [...new Set(views.filter((v) => v.up).map((v) => v.version))];
  // last six months of revenue, per site and currency
  const periods = [...new Set(views.flatMap((v) => v.months.map((m) => m.period)))].sort().reverse().slice(0, 6);

  const body = html`
    <nav class="top"><h1>Console</h1><span class="muted small">Signed in as ${c.get("staff").email}</span></nav>
    <p class="muted">Every company on every Saralix site. Numbers come live from each site; no employee data is kept here.</p>
    <div class="grid">
      <div class="card"><div class="muted small">Sites up</div><div class="stat">${views.filter((v) => v.up).length} of ${views.length}</div></div>
      <div class="card"><div class="muted small">Companies</div><div class="stat">${real.length}</div><div class="muted small">${real.filter((t) => t.status === "active" || t.status === "past_due").length} paying, ${real.filter((t) => t.status === "trial").length} on trial</div></div>
      <div class="card"><div class="muted small">Active employees</div><div class="stat">${real.reduce((n, t) => n + t.employees, 0).toLocaleString("en-IN")}</div></div>
      <div class="card"><div class="muted small">Versions running</div><div class="stat">${versions.length ? versions.join(", ") : "?"}</div>${versions.length > 1 ? html`<div class="down small">Sites differ: a rollout may have stopped part way.</div>` : ""}</div>
    </div>

    <h2>Sites</h2>
    <div class="card scroll"><table>
      <thead><tr><th>Site</th><th>Data region</th><th>Status</th><th>Version</th><th class="num">Companies</th><th class="num">Active employees</th><th></th></tr></thead>
      <tbody>${views.map(
        (v) => html`<tr>
          <td><strong>${v.site.name}</strong></td>
          <td class="muted">${v.site.region ?? ""}</td>
          <td>${v.up ? html`<span class="up">● Up</span>` : html`<span class="down">● Down</span> <span class="muted small">${v.error}</span>`}</td>
          <td>${v.version ?? "?"}</td>
          <td class="num">${v.summary?.companies ?? "?"}</td>
          <td class="num">${v.summary?.activeEmployees?.toLocaleString("en-IN") ?? "?"}</td>
          <td><a href="${v.site.url}/platform">Open console</a></td>
        </tr>`,
      )}</tbody>
    </table></div>

    <h2>Revenue</h2>
    <div class="card scroll"><table>
      <thead><tr><th>Site</th><th>Month</th><th class="num">Invoices</th><th class="num">Invoiced</th><th class="num">Collected</th></tr></thead>
      <tbody>${views.flatMap((v) =>
        v.months
          .filter((m) => periods.includes(m.period))
          .map((m) => html`<tr><td>${v.site.name}</td><td>${m.period}</td><td class="num">${m.count}</td><td class="num">${fmtMoney(m.invoiced, { currency: m.currency })}</td><td class="num">${fmtMoney(m.collected, { currency: m.currency })}</td></tr>`),
      )}</tbody>
    </table>${periods.length ? "" : html`<p class="muted">No invoices yet.</p>`}</div>

    <h2>Companies</h2>
    <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input name="q" value="${q}" placeholder="Search name or code" style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--text);font:inherit" />
      <select name="site" style="padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--text);font:inherit">
        <option value="">All sites</option>
        ${views.map((v) => html`<option value="${v.site.key}" ${only === v.site.key ? html`selected` : ""}>${v.site.name}</option>`)}
      </select>
      <button class="btn" style="width:auto;margin:0" type="submit">Filter</button>
      <a class="btn" style="width:auto;margin:0;background:var(--tint);color:var(--text)" href="/console/companies.csv">Export CSV</a>
    </form>
    <div class="card scroll"><table>
      <thead><tr><th>Company</th><th>Site</th><th>Country</th><th>Plan</th><th>Status</th><th class="num">Employees</th><th>Joined</th></tr></thead>
      <tbody>${rows.map(
        (t) => html`<tr>
          <td><a href="${t.site.url}/platform/tenants/${t.id}"><strong>${t.name}</strong></a><br /><span class="muted small">${t.code}</span> ${t.demo ? html`<span class="tag">Demo</span>` : ""}</td>
          <td>${t.site.name}</td>
          <td>${t.country ?? ""}</td>
          <td>${t.plan}</td>
          <td>${STATUS[t.status] ?? t.status}</td>
          <td class="num">${t.employees.toLocaleString("en-IN")}</td>
          <td class="muted">${String(t.createdAt).slice(0, 10)}</td>
        </tr>`,
      )}</tbody>
    </table>${rows.length ? "" : html`<p class="muted">No companies match.</p>`}</div>
  `;
  return c.html(page("Saralix console", body, { wide: true }));
});

consoleRoutes.get("/companies.csv", async (c) => {
  const key = c.env.CONTROL_PLANE_KEY;
  if (!key) return c.text("Not set up", 503);
  const views = await Promise.all(c.get("sites").map((s) => loadSite(s, key)));
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  const lines = [["Company", "Code", "Site", "Country", "Currency", "Plan", "Status", "Employees", "Joined", "Demo"].join(",")];
  for (const v of views) for (const t of v.tenants) lines.push([t.name, t.code, v.site.name, t.country, t.currency, t.plan, t.status, t.employees, String(t.createdAt).slice(0, 10), t.demo ? "yes" : ""].map(cell).join(","));
  return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="saralix-companies.csv"' });
});
