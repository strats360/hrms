/**
 * Where a punch may come from: within an office's radius, and/or from an office network.
 * Each check is off, flags the punch for HR, or blocks it. Work-from-home punches are
 * exempt unless the company says otherwise.
 */
export type PunchCheckMode = "off" | "flag" | "block";
export interface PunchPolicy {
  location: PunchCheckMode;
  ip: PunchCheckMode;
  wfhExempt: boolean;
  /** Ask for a selfie at each punch. */
  selfie: "off" | "optional" | "required";
  /** Selfies are deleted this many days after the punch. */
  selfieRetentionDays: number;
}
export const DEFAULT_PUNCH_POLICY: PunchPolicy = { location: "off", ip: "off", wfhExempt: true, selfie: "off", selfieRetentionDays: 90 };

export interface Office {
  name: string;
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  allowedIps: string[];
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

function ipv4ToBig(ip: string): bigint | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((acc, x) => (acc << 8n) + BigInt(Number(x)), 0n);
}
function ipv6ToBig(ip: string): bigint | null {
  let s = ip.toLowerCase();
  // ::ffff:1.2.3.4
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToBig(v4[1]!);
    if (n === null) return null;
    s = s.replace(v4[1]!, `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return parts.reduce((acc, x) => (acc << 16n) + BigInt(parseInt(x, 16)), 0n);
}
function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  const t = ip.trim();
  const v4 = ipv4ToBig(t);
  if (v4 !== null) return { v: 4, n: v4 };
  const v6 = ipv6ToBig(t);
  return v6 === null ? null : { v: 6, n: v6 };
}

/** An address or CIDR range, IPv4 or IPv6: "203.0.113.7", "203.0.113.0/24", "2001:db8::/48". */
export function validIpRule(rule: string) {
  const [addr, bits, extra] = rule.trim().split("/");
  if (extra !== undefined || !addr) return false;
  const p = parseIp(addr);
  if (!p) return false;
  if (bits === undefined) return true;
  const b = Number(bits);
  return /^\d+$/.test(bits) && b >= 0 && b <= (p.v === 4 ? 32 : 128);
}

export function ipMatches(ip: string, rule: string) {
  const a = parseIp(ip);
  const [addr, bits] = rule.trim().split("/");
  const r = addr ? parseIp(addr) : null;
  if (!a || !r) return false;
  // an IPv4 rule also matches the IPv4-mapped IPv6 form
  let an = a.n;
  let av = a.v;
  if (a.v === 6 && r.v === 4 && a.n >> 32n === 0xffffn) {
    an = a.n & 0xffffffffn;
    av = 4;
  }
  if (av !== r.v) return false;
  const width = r.v === 4 ? 32 : 128;
  const b = bits === undefined ? width : Number(bits);
  const shift = BigInt(width - b);
  return an >> shift === r.n >> shift;
}

export interface PunchCheck {
  /** False when a blocking rule failed. */
  allowed: boolean;
  /** Why it was refused, written for the employee. */
  error: string | null;
  /** Reasons to show HR on an accepted punch. */
  flags: string[];
  /** Metres from the employee's office, when known. */
  distanceM: number | null;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/**
 * Check a punch against the employee's office (and the company's other offices: being at
 * any office counts). `accuracyM` is the phone's reported GPS accuracy; up to 200 m of it
 * is given as the benefit of the doubt.
 */
export function checkPunch(policy: PunchPolicy, home: Office | null, others: Office[], p: { lat?: number | null; lng?: number | null; accuracyM?: number | null; ip?: string | null; wfh: boolean; offline?: boolean }): PunchCheck {
  const out: PunchCheck = { allowed: true, error: null, flags: [], distanceM: null };
  if (p.wfh && policy.wfhExempt) return out;
  const offices = [home, ...others].filter(Boolean) as Office[];

  if (policy.location !== "off") {
    const fenced = offices.filter((o) => o.lat !== null && o.lng !== null && o.radiusM);
    if (fenced.length) {
      let problem: string | null = null;
      if (p.lat === null || p.lat === undefined || p.lng === null || p.lng === undefined) {
        problem = "Turn on location for this site so we can see you're at the office";
      } else {
        const slack = Math.min(200, Math.max(0, p.accuracyM ?? 0));
        const at = (o: Office) => distanceMeters({ lat: p.lat!, lng: p.lng! }, { lat: o.lat!, lng: o.lng! });
        const homeFenced = home && fenced.includes(home) ? home : null;
        if (homeFenced) out.distanceM = at(homeFenced);
        const inside = fenced.find((o) => at(o) - slack <= o.radiusM!);
        if (!inside) {
          const nearest = fenced.reduce((a, b) => (at(a) <= at(b) ? a : b));
          problem = `You're ${km(at(nearest))} from ${nearest.name}`;
        }
      }
      if (problem) {
        if (policy.location === "block") return { ...out, allowed: false, error: `${problem}. Punch in at the office, or ask HR for a correction.` };
        out.flags.push(problem.replace(/^You're/, "Punched").replace("Turn on location for this site so we can see you're at the office", "No location shared"));
      }
    }
  }

  // a punch saved offline is sent later from wherever the phone is: its network says nothing
  if (policy.ip !== "off" && !p.offline) {
    const rules = offices.flatMap((o) => o.allowedIps);
    if (rules.length) {
      const ok = !!p.ip && rules.some((r) => ipMatches(p.ip!, r));
      if (!ok) {
        if (policy.ip === "block") return { ...out, allowed: false, error: "You're not on an office network. Punch in from the office Wi-Fi, or ask HR for a correction." };
        out.flags.push(`Not on an office network${p.ip ? ` (${p.ip})` : ""}`);
      }
    }
  }
  return out;
}

/** How old an offline punch can be when it's finally sent. */
export const OFFLINE_PUNCH_MAX_HOURS = 12;
