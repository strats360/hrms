import { and, eq, isNotNull, lte } from "drizzle-orm";
import { auditLogs, createDb, invoicePayments, invoices, tenants, type Database } from "@hrms/db";
import { inr } from "@hrms/shared";
import type { Env } from "../env";
import { mailerFor } from "../lib/context";
import { layout } from "../lib/email";
import { cashfreeConfig } from "./cashfree";
import { AUTOPAY_GATEWAY, scheduleAutopay } from "./autopay";
import { getEntity } from "./billing";

const istDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function log(db: Database, tenantId: string, action: string, entityId: string, summary: string) {
  await db.insert(auditLogs).values({ tenantId, actorUserId: null, actorName: "System", action, entity: "invoice", entityId, summary }).catch((e) => console.error("audit failed", e));
}

/**
 * Daily: give each failed autopay debit its one retry, if it's still worth making.
 * The invoice must still be unpaid and the mandate active; the retry itself is
 * scheduled after the bank's pre-debit notice, like any autopay debit.
 */
export async function runAutopayRetries(env: Env, now = new Date()) {
  const out = { due: 0, scheduled: 0, skipped: 0 };
  const cfg = cashfreeConfig(env);
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!cfg || !url) return out;
  const db = createDb(url, { max: 2 });
  const mailer = mailerFor(env);
  try {
    const due = await db
      .select()
      .from(invoicePayments)
      .where(and(eq(invoicePayments.gateway, AUTOPAY_GATEWAY), eq(invoicePayments.status, "failed"), isNotNull(invoicePayments.retryAt), lte(invoicePayments.retryAt, now)));
    out.due = due.length;
    for (const a of due) {
      // claim it first, so overlapping runs can't retry the same debit twice
      const [claimed] = await db.update(invoicePayments).set({ retryAt: null }).where(and(eq(invoicePayments.id, a.id), isNotNull(invoicePayments.retryAt))).returning();
      if (!claimed) continue;
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, a.invoiceId));
      if (!inv || inv.status !== "issued") {
        out.skipped++;
        continue;
      }
      const r = await scheduleAutopay(db, cfg, inv, null, { retryOf: a.id });
      if (!r.scheduled) {
        out.skipped++;
        await log(db, inv.tenantId, "billing.autopay_retry_skipped", inv.id, `Autopay retry for ${inv.number} not made: ${r.reason}`);
        continue;
      }
      out.scheduled++;
      await log(db, inv.tenantId, "billing.autopay_retry", inv.id, `Retrying the autopay debit for ${inv.number} (${inr(Number(inv.total))})`);
      try {
        const [t] = await db.select().from(tenants).where(eq(tenants.id, inv.tenantId));
        const to = t?.billingEmail ?? t?.contactEmail;
        if (to) {
          const entity = await getEntity(db);
          const when = r.attempt.scheduledFor ? istDate(r.attempt.scheduledFor) : "in the next day or two";
          const { html, text } = layout({
            company: entity.legalName,
            heading: `Trying autopay again for ${inv.number}`,
            paragraphs: [`We'll debit ${inr(Number(inv.total))} again on ${when}, after your bank's pre-debit notice. This is the only automatic retry.`, "If you pay online before then, we'll cancel the debit, as long as it hasn't reached your bank yet. You can also skip it under Settings › Billing & invoices."],
            cta: { label: "View invoice", url: `${env.APP_URL}/settings/billing` },
          });
          await mailer.send({ to, subject: `Autopay retry for ${inv.number}`, html, text });
        }
      } catch (e) {
        console.error("retry email failed", e);
      }
    }
    return out;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

/** Cron Trigger entry point (see wrangler config "triggers.crons"). */
export async function runScheduled(env: Env) {
  const r = await runAutopayRetries(env);
  if (r.due) console.log(`autopay retries: ${r.scheduled} scheduled, ${r.skipped} skipped of ${r.due} due`);
}
