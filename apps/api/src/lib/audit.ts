import type { Context } from "hono";
import { auditLogs } from "@hrms/db";
import type { AppEnv } from "../env";

/** Record an audit log entry for the current actor. Never throws. */
export async function audit(
  c: Context<AppEnv>,
  entry: { action: string; entity: string; entityId?: string | null; summary?: string; data?: unknown; tenantId?: string | null },
) {
  try {
    const s = c.get("session");
    let tenantId = entry.tenantId;
    if (tenantId === undefined) {
      try {
        tenantId = c.get("tenant")?.tenantId ?? null;
      } catch {
        tenantId = null;
      }
    }
    await c
      .get("db")
      .insert(auditLogs)
      .values({
        tenantId,
        actorUserId: s?.userId ?? null,
        actorName: s?.name ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        summary: entry.summary ?? null,
        data: entry.data ?? null,
        ip: c.req.header("cf-connecting-ip") ?? null,
      });
  } catch (e) {
    console.error("audit failed", e);
  }
}
