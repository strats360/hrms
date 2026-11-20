import { and, eq, lte, sql } from "drizzle-orm";
import type { Context } from "hono";
import { createDb, webhookDeliveries, webhooks, type Database } from "@hrms/db";
import { decryptField, signWebhook, WEBHOOK_RETRY_MINUTES, webhookUrlError, type WebhookEvent } from "@hrms/shared";
import type { AppEnv, Env } from "../env";

export const allowLocalHooks = (env: Env) => env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";

/** Sends one delivery. Returns true once the receiver answers with a 2xx. */
export async function attemptDelivery(db: Database, env: Env, deliveryId: string) {
  const [row] = await db.select({ d: webhookDeliveries, h: webhooks }).from(webhookDeliveries).innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId)).where(eq(webhookDeliveries.id, deliveryId));
  if (!row || row.d.status !== "pending") return false;
  const { d, h } = row;
  const attempts = d.attempts + 1;
  let code: number | null = null;
  let error: string | null = null;
  const urlError = webhookUrlError(h.url, { allowLocal: allowLocalHooks(env) });
  if (urlError || !h.active) error = urlError ?? "Webhook is turned off";
  else {
    try {
      const secret = (await decryptField(h.secretEnc, env.ENCRYPTION_KEY!)) ?? "";
      const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt.toISOString(), data: d.payload });
      const res = await fetch(h.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "User-Agent": "Saralix-Webhooks/1", "X-Saralix-Event": d.event, "X-Saralix-Delivery": d.id, "X-Saralix-Signature": await signWebhook(secret, body) },
        body,
      });
      code = res.status;
      if (res.status < 200 || res.status >= 300) error = `The receiver answered ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "Couldn't reach the receiver";
    }
  }
  const done = !error;
  const wait = WEBHOOK_RETRY_MINUTES[attempts - 1];
  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      responseCode: code,
      lastError: error,
      status: done ? "delivered" : wait === undefined || !h.active ? "failed" : "pending",
      deliveredAt: done ? new Date() : null,
      nextAttemptAt: done || wait === undefined ? null : new Date(Date.now() + wait * 60_000),
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, d.id));
  return done;
}

/** What a payroll event carries: the run and its totals, no one's pay. */
export const runEventData = (run: { id: string; entityId: string | null; kind: string; label: string | null; month: string; periodStart: string; periodEnd: string; payDate: string | null; totals: unknown }) => ({
  id: run.id,
  entityId: run.entityId,
  kind: run.kind,
  label: run.label,
  month: run.month,
  periodStart: run.periodStart,
  periodEnd: run.periodEnd,
  payDate: run.payDate,
  totals: run.totals,
});

/** Queues an event for every webhook that wants it, and tries to send it straight away. */
export async function emitEvent(c: Context<AppEnv>, event: WebhookEvent, data: Record<string, unknown>) {
  const db = c.get("db");
  const tenantId = c.get("tenant").tenantId;
  try {
    const hooks = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.active, true), sql`${event} = any(${webhooks.events})`));
    if (!hooks.length) return;
    const rows = await db.insert(webhookDeliveries).values(hooks.map((h) => ({ tenantId, webhookId: h.id, event, payload: data }))).returning({ id: webhookDeliveries.id });
    const send = Promise.all(rows.map((r) => attemptDelivery(db, c.env, r.id).catch((e) => console.error("webhook delivery failed", e))));
    // on Workers, finish after the response; in tests and on Node, just wait
    try {
      c.executionCtx.waitUntil(send);
    } catch {
      await send;
    }
  } catch (e) {
    // a webhook must never break the action that raised it
    console.error("webhook emit failed", e);
  }
}

/** Hourly: retry deliveries that are due. */
export async function retryDueDeliveries(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return { tried: 0 };
  const db = createDb(url, { max: 2 });
  try {
    const due = await db.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, new Date()))).limit(200);
    for (const d of due) await attemptDelivery(db, env, d.id).catch((e) => console.error("webhook retry failed", e));
    return { tried: due.length };
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
