import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/**
 * An employee's flexible benefit plan for one financial year: how much of their special
 * allowance goes into each benefit head (tenant settings fbp.heads). See shared fbp.ts.
 */
export const fbpDeclarations = pgTable(
  "fbp_declarations",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Financial year, like 2026-27. */
    fy: text("fy").notNull(),
    /** Yearly amount per head code. */
    allocations: jsonb("allocations").$type<Record<string, number>>().notNull().default({}),
    /** submitted, approved or rejected. Only approved plans change payroll. */
    status: text("status").notNull().default("submitted"),
    note: text("note"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("fbp_decl_emp_fy_uq").on(t.tenantId, t.employeeId, t.fy), index("fbp_decl_tenant_fy_idx").on(t.tenantId, t.fy)],
);
