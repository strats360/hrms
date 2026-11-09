import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { id, timestamps } from "./_helpers";

const tenantId = () =>
  text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

export const branches = pgTable(
  "branches",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    code: text("code"),
    state: text("state").notNull(),
    city: text("city"),
    address: text("address"),
    isHeadOffice: boolean("is_head_office").notNull().default(false),
    esiSubCode: text("esi_sub_code"),
    ptRegistration: text("pt_registration"),
    /** Office location for punch checks: centre and radius. */
    geoLat: doublePrecision("geo_lat"),
    geoLng: doublePrecision("geo_lng"),
    geoRadiusM: integer("geo_radius_m"),
    /** Office network: addresses or CIDR ranges punches may come from. */
    allowedIps: jsonb("allowed_ips").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("branches_tenant_name_uq").on(t.tenantId, t.name)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    code: text("code"),
    ...timestamps,
  },
  (t) => [uniqueIndex("departments_tenant_name_uq").on(t.tenantId, t.name)],
);

export const designations = pgTable(
  "designations",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    grade: text("grade"),
    ...timestamps,
  },
  (t) => [uniqueIndex("designations_tenant_name_uq").on(t.tenantId, t.name)],
);

export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(), // HH:MM
    endTime: text("end_time").notNull(),
    graceMinutes: integer("grace_minutes").notNull().default(15),
    halfDayMinutes: integer("half_day_minutes").notNull().default(240),
    fullDayMinutes: integer("full_day_minutes").notNull().default(480),
    weeklyOffs: integer("weekly_offs").array().notNull().default([0, 6]),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("shifts_tenant_idx").on(t.tenantId)],
);

export { tenantId as tenantIdColumn };
