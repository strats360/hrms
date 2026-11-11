import { ApiError, api } from "./api";

/**
 * A little state kept on the phone so the app still opens without a connection: who's
 * signed in and today's punch status. Only the person's own data, removed on sign-out.
 * Punches made offline wait here and are sent when the connection is back.
 */
const read = <T>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
};

/** A fetch that never reached the server (no network), as opposed to an error it sent back. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError) && (e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message)));

export const savedMe = <T>() => read<T>("offline:me");
export const saveMe = (me: unknown) => write("offline:me", me);
export const savedHome = <T>(employeeId: string) => read<T>(`offline:home:${employeeId}`);
export const saveHome = (employeeId: string, home: unknown) => write(`offline:home:${employeeId}`, home);

export function clearOffline() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("offline:")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export interface QueuedPunch {
  capturedAt: string;
  action: "in" | "out";
  body: Record<string, unknown>;
}
const qKey = (employeeId: string) => `offline:punches:${employeeId}`;
export const queuedPunches = (employeeId: string) => read<QueuedPunch[]>(qKey(employeeId)) ?? [];
export const QUEUE_EVENT = "offline-punches-changed";
const changed = () => typeof window !== "undefined" && window.dispatchEvent(new Event(QUEUE_EVENT));
export function queuePunch(employeeId: string, p: QueuedPunch) {
  // an in and an out a day is all that matters; keep the list short
  write(qKey(employeeId), [...queuedPunches(employeeId), p].slice(-4));
  changed();
}

let sending = false;
/** Send waiting punches in order. Stops at the first network failure and tries again later. */
export async function sendQueuedPunches(employeeId: string): Promise<{ sent: number; failed: string[] }> {
  if (sending) return { sent: 0, failed: [] };
  sending = true;
  let sent = 0;
  const failed: string[] = [];
  try {
    for (const p of queuedPunches(employeeId)) {
      try {
        await api.post("/ess/attendance/punch", { ...p.body, capturedAt: p.capturedAt });
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        failed.push(e instanceof Error ? e.message : "Couldn't send a saved punch");
      }
      write(qKey(employeeId), queuedPunches(employeeId).filter((x) => x.capturedAt !== p.capturedAt));
    }
  } finally {
    sending = false;
    if (sent || failed.length) changed();
  }
  return { sent, failed };
}
