import { siteControlToken } from "@hrms/shared";

/** A live Saralix site, from deploy/instances.json (passed in the SITES variable at deploy). */
export interface Site {
  key: string;
  name: string;
  url: string;
  region?: string | null;
}

export function parseSites(raw: string | undefined): Site[] {
  try {
    const list = JSON.parse(raw ?? "[]") as Site[];
    return Array.isArray(list) ? list.filter((s) => s && s.key && s.name && /^https?:\/\//.test(s.url)) : [];
  } catch {
    return [];
  }
}

const TIMEOUT_MS = 5000;

/** Call one site's control API with its own token. */
export async function callSite<T>(site: Site, controlPlaneKey: string, path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${site.url}/api/control${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${await siteControlToken(controlPlaneKey, site.key)}`, "content-type": "application/json", "user-agent": "saralix-control" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${site.name} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Which sites this email signs in on. Each site is asked in parallel; nothing is stored here,
 * and a site that doesn't answer in time just isn't counted.
 */
export async function routeEmail(email: string, sites: Site[], controlPlaneKey: string, fetchImpl: typeof fetch = fetch) {
  const answers = await Promise.allSettled(sites.map((s) => callSite<{ found: boolean }>(s, controlPlaneKey, "/route", { method: "POST", body: { email } }, fetchImpl)));
  const found = sites.filter((_, i) => answers[i]!.status === "fulfilled" && (answers[i] as PromiseFulfilledResult<{ found: boolean }>).value.found);
  const unreachable = sites.filter((_, i) => answers[i]!.status === "rejected");
  return { found, unreachable };
}

/** Where to send someone on a site: its login page, with the email in the fragment (never sent to a server). */
export const loginUrl = (site: Site, email: string) => `${site.url}/login#email=${encodeURIComponent(email)}`;
