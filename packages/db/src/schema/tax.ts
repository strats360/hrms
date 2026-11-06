import { bigint, date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { TaxDeclarationData, Verified } from "@hrms/shared";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** An employee's tax declaration for one financial year (Form 12BB). */
export const taxDeclarations = pgTable(
  "tax_declarations",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fy: text("fy").notNull(), // "2026-27"
    regime: text("regime").notNull().default("new"),
    data: jsonb("data").$type<TaxDeclarationData>().notNull().default({}),
    /** HR-verified amounts per section; a verified section overrides the declared amount in TDS. */
    verified: jsonb("verified").$type<Verified>().notNull().default({}),
    status: text("status").notNull().default("draft"), // draft | submitted | verified (locked)
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_decl_emp_fy_uq").on(t.tenantId, t.employeeId, t.fy), index("tax_decl_tenant_fy_idx").on(t.tenantId, t.fy)],
);

/** Investment proofs uploaded against a declaration section. */
export const taxProofs = pgTable(
  "tax_proofs",
  {
    id: id(),
    tenantId: tenantId(),
    declarationId: text("declaration_id")
      .notNull()
      .references(() => taxDeclarations.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: text("status").notNull().default("pending"), // pending | accepted | rejected
    note: text("note"),
    ...timestamps,
  },
  (t) => [index("tax_proofs_decl_idx").on(t.declarationId)],
);

/** Quarterly TDS return (Form 24Q) filing record. */
export const tdsReturns = pgTable(
  "tds_returns",
  {
    id: id(),
    tenantId: tenantId(),
    fy: text("fy").notNull(),
    quarter: text("quarter").notNull(), // Q1..Q4
    filedOn: date("filed_on", { mode: "string" }).notNull(),
    acknowledgement: text("acknowledgement"), // token / provisional receipt number
    notes: text("notes"),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tds_returns_uq").on(t.tenantId, t.fy, t.quarter)],
);
