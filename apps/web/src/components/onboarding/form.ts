import { ApiError } from "@/lib/api";

/** Turn zod's default wording into plain copy. Custom schema messages pass through. */
export function friendly(msg: string): string {
  if (/^Too small: expected string to have >=1 /.test(msg)) return "This is required";
  const m = /^Too small: expected string to have >=(\d+) /.exec(msg);
  if (m) return `Enter at least ${m[1]} characters`;
  if (/^Too big: expected string to have <=(\d+)/.test(msg)) return "This is too long";
  if (/^Invalid input: expected string, received (undefined|null)/.test(msg)) return "This is required";
  if (/^Invalid (email|e-mail)/i.test(msg)) return "Enter a valid email address";
  if (/^Invalid option/.test(msg)) return "Pick one of the options";
  return msg;
}

/** Map zod issues to a { field: message } record. */
export function zodErrors(err: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = friendly(i.message);
  }
  return out;
}

/** Map an API validation error (details = zod issues) to field errors. */
export function apiFieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError && Array.isArray(e.details)) {
    for (const i of e.details as { path?: (string | number)[]; message?: string }[]) {
      const k = String(i.path?.[0] ?? "_");
      if (!out[k] && i.message) out[k] = friendly(i.message);
    }
  }
  return out;
}
