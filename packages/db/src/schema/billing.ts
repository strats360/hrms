import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { id, timestamps } from "./_helpers";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

/** SaaS plans. Tenants reference a plan by key (tenants.plan). */
export const plans = pgTable(
  "plans",
  {
    id: id(),
    key: text("key").notNull(), // starter | growth | enterprise
    name: text("name").notNull(),
    /** Per active employee per month, before GST. Null = custom pricing (set on the tenant). */
    pricePerEmployee: money("price_per_employee"),
    minSeats: integer("min_seats").notNull().default(0),
    maxEmployees: integer("max_employees"),
    includedAdmins: integer("included_admins"),
    description: text("description"),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("plans_key_uq").on(t.key)],
);

export interface InvoiceParty {
  name: string;
  legalName?: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  stateCode: string | null;
}
export interface InvoiceLine {
  description: string;
  sac: string;
  quantity: number;
  rate: number;
  amount: number;
}

/** Monthly subscription invoice to a tenant. Seller and buyer are snapshotted when issued. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(), // INV-P-2611-0001
    period: text("period").notNull(), // 2026-11
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    planKey: text("plan_key").notNull(),
    planName: text("plan_name").notNull(),
    seats: integer("seats").notNull(),
    rate: money("rate").notNull(),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull().default([]),
    subtotal: money("subtotal").notNull(),
    cgst: money("cgst").notNull().default(0),
    sgst: money("sgst").notNull().default(0),
    igst: money("igst").notNull().default(0),
    total: money("total").notNull(),
    seller: jsonb("seller").$type<InvoiceParty>().notNull(),
    buyer: jsonb("buyer").$type<InvoiceParty>().notNull(),
    /** issued | paid | void (overdue is issued past its due date) */
    status: text("status").notNull().default("issued"),
    paidOn: date("paid_on", { mode: "string" }),
    paymentMethod: text("payment_method"),
    paymentReference: text("payment_reference"),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    notes: text("notes"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("invoices_number_uq").on(t.number), uniqueIndex("invoices_tenant_period_uq").on(t.tenantId, t.period).where(sql`status <> 'void'`), index("invoices_status_idx").on(t.status, t.dueOn)],
);

/** Platform-wide settings (invoicing entity, dunning policy) as key -> JSON. */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
