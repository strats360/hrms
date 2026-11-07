import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { id, timestamps } from "./_helpers";

/**
 * Feature flags. Rollout: all | plans | tenants | percent. A flag that's switched
 * off is off everywhere (kill switch); excluded tenants never get it.
 */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    rollout: text("rollout").notNull().default("all"),
    plans: jsonb("plans").$type<string[]>().notNull().default([]),
    tenantIds: jsonb("tenant_ids").$type<string[]>().notNull().default([]),
    excludedTenantIds: jsonb("excluded_tenant_ids").$type<string[]>().notNull().default([]),
    percent: integer("percent").notNull().default(100),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("feature_flags_key_uq").on(t.key)],
);

/**
 * Versioned statutory rules maintained by the platform. key examples: pf, esi,
 * pt:Gujarat, lwf:Maharashtra, tax:2026-27, minwage:Gujarat. The live version with
 * the latest effective date on or before a payroll month applies to that month.
 */
export const statutoryRules = pgTable(
  "statutory_rules",
  {
    id: id(),
    key: text("key").notNull(),
    category: text("category").notNull(), // pf | esi | pt | lwf | tax | minwage
    scope: text("scope").notNull().default("All India"),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"), // draft | live | retired
    source: text("source"),
    notes: text("notes"),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("statutory_rules_key_idx").on(t.key, t.status, t.effectiveFrom), uniqueIndex("statutory_rules_live_uq").on(t.key, t.effectiveFrom).where(sql`status = 'live'`)],
);

/** Tenant support tickets. Number is a platform-wide running number (#4812). */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    number: integer("number").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    raisedBy: text("raised_by").notNull(),
    subject: text("subject").notNull(),
    category: text("category").notNull().default("other"),
    priority: text("priority").notNull().default("P3"), // P1 | P2 | P3
    status: text("status").notNull().default("open"), // open | in_progress | waiting_on_customer | resolved | closed
    assigneeId: text("assignee_id"),
    /** The tenant agreed to read-only support access while the ticket is open. */
    allowAccess: boolean("allow_access").notNull().default(false),
    responseDueAt: timestamp("response_due_at", { withTimezone: true }).notNull(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("support_tickets_number_uq").on(t.number), index("support_tickets_tenant_idx").on(t.tenantId, t.status), index("support_tickets_status_idx").on(t.status, t.priority)],
);

export interface TicketAttachment {
  key: string;
  name: string;
  type: string;
  size: number;
}

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    authorKind: text("author_kind").notNull(), // tenant | platform | system
    body: text("body").notNull(),
    /** Internal notes are only visible to platform staff. */
    internal: boolean("internal").notNull().default(false),
    attachments: jsonb("attachments").$type<TicketAttachment[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** A time-boxed, read-only support session into a tenant, tied to a ticket. */
export const supportAccess = pgTable(
  "support_access",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    staffUserId: text("staff_user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("support_access_staff_idx").on(t.staffUserId, t.tenantId)],
);
