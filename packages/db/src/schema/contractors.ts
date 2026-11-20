import { boolean, date, index, pgTable, text } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { id, money, timestamps } from "./_helpers";

/**
 * Contractors and professionals paid against invoices, outside payroll, with TDS under section
 * 194C or 194J (section 393 of the Income Tax Act 2025 from tax year 2026-27).
 */
export const contractors = pgTable(
  "contractors",
  {
    id: id(),
    tenantId: tenantId(),
    /** Legal entity that pays them; null means the default entity. */
    entityId: text("entity_id"),
    name: text("name").notNull(),
    pan: text("pan"),
    /** individual or company: 194C is 1% for individuals and HUFs, 2% for others. */
    kind: text("kind").notNull().default("individual"),
    /** 194C (contract work), 194J_professional (10%) or 194J_technical (2%). */
    section: text("section").notNull().default("194C"),
    email: text("email"),
    phone: text("phone"),
    bankName: text("bank_name"),
    accountNumberEnc: text("account_number_enc"),
    accountLast4: text("account_last4"),
    ifsc: text("ifsc"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("contractors_tenant_idx").on(t.tenantId)],
);

export const contractorPayments = pgTable(
  "contractor_payments",
  {
    id: id(),
    tenantId: tenantId(),
    contractorId: text("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    invoiceNo: text("invoice_no"),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    description: text("description"),
    gross: money("gross").notNull(),
    section: text("section").notNull(),
    rate: money("rate").notNull(),
    tds: money("tds").notNull(),
    net: money("net").notNull(),
    /** Why TDS is what it is: under the threshold, catch-up after crossing it, no PAN. */
    tdsNote: text("tds_note"),
    status: text("status").notNull().default("draft"),
    paidOn: date("paid_on", { mode: "string" }),
    reference: text("reference"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("contractor_payments_tenant_idx").on(t.tenantId, t.invoiceDate), index("contractor_payments_contractor_idx").on(t.contractorId)],
);
