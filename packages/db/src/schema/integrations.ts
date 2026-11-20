import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { id, timestamps } from "./_helpers";

/** Read-only keys for the public API (/api/v1). The secret is shown once; only its hash is kept. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyHint: text("key_hint").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    createdBy: text("created_by"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("api_keys_tenant_idx").on(t.tenantId)],
);

/** Where to send events. The signing secret is encrypted, because each delivery needs it. */
export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    tenantId: tenantId(),
    url: text("url").notNull(),
    events: text("events").array().notNull().default([]),
    secretEnc: text("secret_enc").notNull(),
    secretHint: text("secret_hint").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("webhooks_tenant_idx").on(t.tenantId)],
);

/** One event for one webhook, retried with backoff until it gets a 2xx or runs out of tries. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    tenantId: tenantId(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending, delivered or failed (gave up). */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    responseCode: integer("response_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt), index("webhook_deliveries_hook_idx").on(t.webhookId)],
);
