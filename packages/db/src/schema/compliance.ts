import { date, index, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { id, timestamps, money } from "./_helpers";

/**
 * A statutory payment recorded against an obligation. Obligations themselves are
 * derived from locked payroll runs; a row here marks one as paid.
 */
export const statutoryChallans = pgTable(
  "statutory_challans",
  {
    id: id(),
    tenantId: tenantId(),
    statute: text("statute").notNull(), // epf | esi | pt | lwf | tds
    period: text("period").notNull(), // wage month YYYY-MM
    jurisdiction: text("jurisdiction").notNull().default(""), // state for PT/LWF, "" otherwise
    amountDue: money("amount_due").notNull(),
    amountPaid: money("amount_paid").notNull(),
    reference: text("reference"), // TRRN / CIN / challan number
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    receiptKey: text("receipt_key"),
    receiptName: text("receipt_name"),
    notes: text("notes"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("challans_uq").on(t.tenantId, t.statute, t.period, t.jurisdiction), index("challans_tenant_period_idx").on(t.tenantId, t.period)],
);
