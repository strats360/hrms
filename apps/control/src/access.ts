/**
 * Cloudflare Access in front of the console. Access signs people in (email one time code or your
 * identity provider) and passes a signed token in the Cf-Access-Jwt-Assertion header. We check
 * that token ourselves (signature, audience, issuer, expiry), so the console stays closed even
 * if the Access application were removed by mistake.
 *
 *   ACCESS_TEAM_DOMAIN   e.g. saralix.cloudflareaccess.com
 *   ACCESS_AUD           the Access application's audience tag
 */
interface Jwk extends JsonWebKey {
  kid: string;
}

let certs: { at: number; keys: Jwk[] } | null = null;

async function keysFor(team: string, fetchImpl: typeof fetch): Promise<Jwk[]> {
  if (certs && Date.now() - certs.at < 10 * 60_000) return certs.keys;
  const res = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  certs = { at: Date.now(), keys: body.keys };
  return body.keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

export interface AccessUser {
  email: string;
}

/** The signed in person, or null when the token is missing or doesn't check out. */
export async function verifyAccess(token: string | undefined, env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<AccessUser | null> {
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]!) as { alg: string; kid: string };
    const claims = json(parts[1]!) as { aud: string | string[]; iss: string; exp: number; nbf?: number; email?: string };
    if (header.alg !== "RS256") return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    const t = Math.floor(now / 1000);
    if (!claims.exp || claims.exp < t || (claims.nbf && claims.nbf > t + 60)) return null;
    const jwk = (await keysFor(env.ACCESS_TEAM_DOMAIN, fetchImpl)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok && claims.email ? { email: claims.email } : null;
  } catch {
    return null;
  }
}

/** For tests: forget cached keys. */
export const resetAccessCache = () => {
  certs = null;
};
