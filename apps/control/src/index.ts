import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { html, page } from "./html";
import { loginUrl, parseSites, routeEmail, type Site } from "./sites";
import { consoleRoutes } from "./console";

/**
 * The Saralix control plane (docs/MULTI_COUNTRY.md, phase 3). It holds no employee data:
 * every answer comes live from the sites' control APIs.
 *
 *   /          one sign in page that sends people to their site
 *   /console   our staff's view across every site (behind Cloudflare Access)
 */
export interface Env {
  /** Shared with the sites; each site's token is derived from it. Worker secret. */
  CONTROL_PLANE_KEY?: string;
  /** Live sites as JSON: [{ key, name, url, region }]. Written from deploy/instances.json at deploy. */
  SITES?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ENVIRONMENT?: string;
}
export type AppEnv = { Bindings: Env; Variables: { sites: Site[]; staff: { email: string } } };

export const app = new Hono<AppEnv>();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], styleSrc: ["'unsafe-inline'"], imgSrc: ["'self'", "data:"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    referrerPolicy: "no-referrer",
  }),
);
app.use("*", async (c, next) => {
  c.set("sites", parseSites(c.env.SITES));
  await next();
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

app.get("/healthz", (c) => c.json({ ok: true, sites: c.get("sites").length, configured: !!c.env.CONTROL_PLANE_KEY }));

const loginForm = (email = "", error?: string) =>
  html`<div class="card">
    <h1>Sign in</h1>
    <p class="muted">Enter your work email and we'll take you to your company's Saralix.</p>
    <form method="post" action="/continue" novalidate>
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" autocomplete="email" required autofocus value="${email}" />
      ${error ? html`<div class="err" role="alert">${error}</div>` : ""}
      <button class="btn" type="submit">Continue</button>
    </form>
  </div>`;

const sitePicker = (sites: Site[], email: string, intro: string) =>
  html`<div class="card">
    <h1>Choose your site</h1>
    <p class="muted">${intro}</p>
    ${sites.map((s) => html`<a class="site" href="${email ? loginUrl(s, email) : `${s.url}/login`}"><span><strong>${s.name}</strong><br /><span class="muted small">${s.region ?? ""}</span></span><span aria-hidden="true">→</span></a>`)}
    <p class="muted small" style="margin-top:16px"><a href="/">Use a different email</a></p>
  </div>`;

app.get("/", (c) => c.html(page("Sign in to Saralix", loginForm())));

app.post("/continue", async (c) => {
  const sites = c.get("sites");
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return c.html(page("Sign in to Saralix", loginForm(email, "Enter a valid email address.")), 400);
  if (!sites.length) return c.html(page("Sign in to Saralix", loginForm(email, "Sign in isn't set up yet. Please try again later.")), 503);
  if (sites.length === 1) return c.redirect(loginUrl(sites[0]!, email), 303);
  if (!c.env.CONTROL_PLANE_KEY) return c.html(page("Choose your site", sitePicker(sites, email, "Pick the site your company uses.")));
  const { found } = await routeEmail(email, sites, c.env.CONTROL_PLANE_KEY);
  if (found.length === 1) return c.redirect(loginUrl(found[0]!, email), 303);
  if (found.length > 1) return c.html(page("Choose your site", sitePicker(found, email, "Your email signs in on more than one site. Which one do you need?")));
  // not found (or a site didn't answer): let them pick, without saying whether the email exists
  return c.html(page("Choose your site", sitePicker(sites, email, "Pick the site your company uses. Your HR team can tell you which one.")));
});

app.route("/console", consoleRoutes);

app.notFound((c) => c.html(page("Not found", html`<div class="card"><h1>Page not found</h1><p><a href="/">Go to sign in</a></p></div>`), 404));

export default app;
