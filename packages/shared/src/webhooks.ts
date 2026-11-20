import { z } from "zod";

/** What an API key can read. Keys are read only; attendance devices have their own keys to send punches. */
export const API_SCOPES = ["employees:read", "payroll:read", "attendance:read", "leave:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "employees:read": "Employees and their jobs",
  "payroll:read": "Payroll runs and payslips",
  "attendance:read": "Daily attendance",
  "leave:read": "Leave requests",
};

export const WEBHOOK_EVENTS = ["employee.created", "employee.updated", "employee.exited", "payroll.approved", "payroll.paid", "leave.approved"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "employee.created": "An employee is added",
  "employee.updated": "An employee's details change",
  "employee.exited": "An employee's exit is completed",
  "payroll.approved": "A payroll run is approved",
  "payroll.paid": "A payroll run is marked paid",
  "leave.approved": "Leave is approved",
};

export const apiKeySchema = z.object({
  name: z.string().trim().min(1, "Name the key, like the system that uses it").max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Pick what the key can read"),
});

/**
 * Webhook addresses must be https on a public host name, so a webhook can't be pointed at
 * something inside our network. Development and test also allow http on localhost.
 */
export function webhookUrlError(raw: string, opts: { allowLocal?: boolean } = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter a full address, like https://example.com/hooks/saralix";
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (opts.allowLocal && local) return null;
  if (u.protocol !== "https:") return "Use an https address";
  if (u.username || u.password) return "Leave the user name and password out of the address";
  if (local || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || !host.includes(".")) return "Use a public address, not one inside your network";
  // IP addresses: refuse private, loopback, link local and carrier ranges; IPv6 literals altogether
  if (host.includes(":")) return "Use a host name, not an IPv6 address";
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return "Use a public address, not one inside your network";
  }
  return null;
}

export const webhookSchema = z.object({
  url: z.string().trim().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
  active: z.boolean().default(true),
});

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * The signature header sent with each delivery: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * Receivers recompute it with their signing secret and reject old timestamps.
 */
export async function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${hex(sig)}`;
}

/** Wait before the next try: 1 minute, 5, 30, 2 hours, 12 hours. Then give up. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720];
