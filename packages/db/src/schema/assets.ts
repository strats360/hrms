import { date, index, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

export const assets = pgTable(
  "assets",
  {
    id: id(),
    tenantId: tenantId(),
    tag: text("tag").notNull(), // AST-0001, or the company's own tag
    name: text("name").notNull(),
    category: text("category").notNull(),
    serialNumber: text("serial_number"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    purchaseCost: numeric("purchase_cost", { precision: 14, scale: 2, mode: "number" }),
    vendor: text("vendor"),
    invoiceNumber: text("invoice_number"),
    warrantyUntil: date("warranty_until", { mode: "string" }),
    branchId: text("branch_id"),
    status: text("status").notNull().default("available"), // available | assigned | in_repair | retired | lost
    condition: text("condition").notNull().default("good"),
    notes: text("notes"),
    /** Who has it now. */
    holderId: text("holder_id").references(() => employees.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("assets_tag_uq").on(t.tenantId, t.tag), index("assets_tenant_status_idx").on(t.tenantId, t.status), index("assets_holder_idx").on(t.tenantId, t.holderId)],
);

/** Each time an asset goes to someone and comes back. */
export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: id(),
    tenantId: tenantId(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    assignedOn: date("assigned_on", { mode: "string" }).notNull(),
    expectedReturn: date("expected_return", { mode: "string" }),
    conditionOut: text("condition_out").notNull(),
    noteOut: text("note_out"),
    assignedBy: text("assigned_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    returnedOn: date("returned_on", { mode: "string" }),
    conditionIn: text("condition_in"),
    noteIn: text("note_in"),
    returnedBy: text("returned_by"),
    /** The employee reported a problem: damaged, lost, not received. */
    issue: text("issue"),
    issueNote: text("issue_note"),
    issueAt: timestamp("issue_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("asset_assignments_asset_idx").on(t.assetId), index("asset_assignments_emp_idx").on(t.tenantId, t.employeeId)],
);
