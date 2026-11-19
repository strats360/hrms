import { sql } from "drizzle-orm";
import { numeric, boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { NotificationPrefs, PermissionMatrix, TenantSettings } from "@hrms/shared";
import { user } from "./auth";
import { id, timestamps } from "./_helpers";

export type StatutoryRegistration = { enabled: boolean; registration?: string | null };
export type TenantStatutory = Partial<Record<"epf" | "esi" | "pt" | "lwf" | "tds" | "bonus", StatutoryRegistration>>;

/** A company (customer) on the platform. Every tenant-owned row carries tenant_id. */
export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    code: text("code").notNull(), // human readable, e.g. TN-0142
    name: text("name").notNull(),
    legalName: text("legal_name"),
    entityType: text("entity_type"),
    industry: text("industry"),
    gstin: text("gstin"),
    pan: text("pan"),
    tan: text("tan"),
    llpinCin: text("llpin_cin"),
    registeredAddress: text("registered_address"),
    state: text("state"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    logoKey: text("logo_key"),
    plan: text("plan").notNull().default("trial"), // trial | starter | growth | enterprise
    status: text("status").notNull().default("trial"), // trial | active | past_due | suspended | cancelled
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Billing: negotiated rate per employee (overrides the plan), billing email, how they pay. */
    customPrice: numeric("custom_price", { precision: 14, scale: 2, mode: "number" }),
    billingEmail: text("billing_email"),
    paymentMethod: text("payment_method"),
    setupStep: text("setup_step").notNull().default("0"),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    settings: jsonb("settings").$type<Partial<TenantSettings>>().notNull().default({}),
    statutory: jsonb("statutory").$type<TenantStatutory>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("tenants_code_uq").on(t.code)],
);

/**
 * A legal entity (company) inside a tenant. Each entity has its own country, currency, time zone
 * and registration numbers, and its country pack decides payroll and statutory rules.
 * Every tenant has one default entity. In Phase 1 the default entity mirrors the tenant's company
 * profile and statutory settings (see services/entities.ts). See docs/MULTI_COUNTRY.md.
 */
export const legalEntities = pgTable(
  "legal_entities",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // short, unique in the tenant, e.g. IN01
    name: text("name").notNull(),
    legalName: text("legal_name"),
    country: text("country").notNull().default("IN"), // ISO 3166 alpha 2
    currency: text("currency").notNull().default("INR"), // ISO 4217
    timeZone: text("time_zone").notNull().default("Asia/Kolkata"), // IANA
    state: text("state"),
    address: text("address"),
    /** Country specific registration numbers, e.g. { gstin, pan, tan, cin } in India. */
    registrations: jsonb("registrations").$type<Record<string, string | null>>().notNull().default({}),
    /** Country specific schemes and their registrations, e.g. { epf: { enabled, registration } }. */
    statutory: jsonb("statutory").$type<Record<string, StatutoryRegistration>>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("legal_entities_tenant_code_uq").on(t.tenantId, t.code),
    uniqueIndex("legal_entities_one_default_uq").on(t.tenantId).where(sql`${t.isDefault}`),
    index("legal_entities_tenant_idx").on(t.tenantId),
  ],
);

/** Tenant roles with a module x action permission matrix. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key"), // set for system roles (super_admin, hr_admin, ...)
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    permissions: jsonb("permissions").$type<PermissionMatrix>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("roles_tenant_name_uq").on(t.tenantId, t.name)],
);

/**
 * Links a login (auth_user) to a tenant. role_id null means employee self-service only.
 * employee_id links the login to their employee record (for ESS).
 */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
    employeeId: text("employee_id"),
    scope: text("scope"), // free-text scope note, e.g. "Sales · Ahmedabad"
    status: text("status").notNull().default("active"), // active | disabled | invited
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    /** Emails this person turned off for this company (see NOTIFICATIONS in @hrms/shared). */
    notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** SaaS operator staff (platform super admin console). */
export const platformStaff = pgTable("platform_staff", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("support"), // super_admin | support | finance
  status: text("status").notNull().default("active"),
  ...timestamps,
});

/** Admin-panel invitations (for users who are not employees yet, e.g. an external CA). */
export const adminInvites = pgTable(
  "admin_invites",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    roleId: text("role_id").references(() => roles.id, { onDelete: "cascade" }),
    scope: text("scope"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedBy: text("invited_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("admin_invites_token_uq").on(t.tokenHash)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(), // e.g. employee.create
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    summary: text("summary"),
    data: jsonb("data"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
