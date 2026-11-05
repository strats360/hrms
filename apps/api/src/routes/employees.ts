import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  branches,
  departments,
  designations,
  employeeDocuments,
  employees,
  memberships,
  onboardingInvites,
  shifts,
} from "@hrms/db";
import {
  can,
  decryptField,
  DOCUMENT_TYPES,
  employeeCreateSchema,
  employeeListQuery,
  employeeUpdateSchema,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeStatus,
} from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { ALLOWED_TYPES, deleteFile, MAX_UPLOAD_BYTES, putFile, safeName } from "../lib/storage";
import { bankFields, linkExistingLogin, nextEmployeeCode, sendOnboardingInvite } from "../services/employees";
import { toCsv, parseCsv } from "../lib/csv";

export const employeeRoutes = new Hono<AppEnv>();
const mgr = alias(employees, "mgr");

const listColumns = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  workEmail: employees.workEmail,
  phone: employees.phone,
  status: employees.status,
  employmentType: employees.employmentType,
  dateOfJoining: employees.dateOfJoining,
  annualCtc: employees.annualCtc,
  departmentId: employees.departmentId,
  department: departments.name,
  designation: designations.name,
  branch: branches.name,
  manager: mgr.fullName,
};

function listWhere(tid: string, q: z.infer<typeof employeeListQuery>) {
  const conds: SQL[] = [eq(employees.tenantId, tid)];
  if (q.q) {
    const like = `%${q.q.trim()}%`;
    conds.push(or(ilike(employees.fullName, like), ilike(employees.employeeCode, like), ilike(employees.workEmail, like), ilike(designations.name, like))!);
  }
  if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
  if (q.branchId) conds.push(eq(employees.branchId, q.branchId));
  if (q.status) conds.push(inArray(employees.status, q.status.split(",")));
  return and(...conds)!;
}

const sortCols = {
  name: employees.fullName,
  code: employees.employeeCode,
  doj: employees.dateOfJoining,
  ctc: employees.annualCtc,
  department: departments.name,
  status: employees.status,
};

employeeRoutes.get("/", requirePerm("employees", "view"), v("query", employeeListQuery), async (c) => {
  const q = c.req.valid("query");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const where = listWhere(tid, q);
  const base = () =>
    db
      .select(listColumns)
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(branches, eq(branches.id, employees.branchId))
      .leftJoin(mgr, eq(mgr.id, employees.managerId));
  const order = q.dir === "desc" ? desc(sortCols[q.sort]) : asc(sortCols[q.sort]);
  const [rows, [count]] = await Promise.all([
    base().where(where).orderBy(order, asc(employees.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(where),
  ]);
  const showCtc = can(c.get("tenant").permissions, "payroll", "view") || can(c.get("tenant").permissions, "employees", "edit");
  return c.json({
    rows: rows.map((r) => ({ ...r, annualCtc: showCtc ? r.annualCtc : null })),
    total: count?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
});

employeeRoutes.get("/stats", requirePerm("employees", "view"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const byStatus = await db
    .select({ status: employees.status, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.tenantId, tid))
    .groupBy(employees.status);
  const byBranch = await db
    .select({ branch: branches.name, n: sql<number>`count(*)::int` })
    .from(employees)
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive')`))
    .groupBy(branches.name);
  return c.json({ byStatus, byBranch, total: byStatus.reduce((a, b) => a + b.n, 0) });
});

employeeRoutes.get("/export.csv", requirePerm("employees", "export"), async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ ...listColumns, pan: employees.pan, uan: employees.uan, bankName: employees.bankName, ifsc: employees.ifsc, accountLast4: employees.accountLast4, dob: employees.dateOfBirth, gender: employees.gender })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(eq(employees.tenantId, c.get("tenant").tenantId))
    .orderBy(asc(employees.employeeCode));
  const csv = toCsv(
    ["Employee ID", "Name", "Work email", "Phone", "Department", "Designation", "Branch", "Manager", "Status", "Type", "Date of joining", "Date of birth", "Gender", "Annual CTC", "PAN", "UAN", "Bank", "IFSC", "Account (last 4)"],
    rows.map((r) => [r.employeeCode, r.fullName, r.workEmail, r.phone, r.department, r.designation, r.branch, r.manager, EMPLOYEE_STATUS_LABELS[r.status as EmployeeStatus] ?? r.status, EMPLOYMENT_TYPE_LABELS[r.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? r.employmentType, r.dateOfJoining, r.dob, r.gender, r.annualCtc, r.pan, r.uan, r.bankName, r.ifsc, r.accountLast4]),
  );
  await audit(c, { action: "employee.export", entity: "employee", summary: `Exported ${rows.length} employees` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="employee-master.csv"' });
});

employeeRoutes.get("/:id", requirePerm("employees", "view"), async (c) => {
  const db = c.get("db");
  const t = c.get("tenant");
  const [row] = await db
    .select({ e: employees, department: departments.name, designation: designations.name, branch: branches.name, branchState: branches.state, manager: mgr.fullName, shift: shifts.name, shiftStart: shifts.startTime, shiftEnd: shifts.endTime })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .leftJoin(shifts, eq(shifts.id, employees.shiftId))
    .where(and(eq(employees.id, c.req.param("id")), eq(employees.tenantId, t.tenantId)));
  if (!row) throw notFound("Employee");
  const docs = await db.select().from(employeeDocuments).where(and(eq(employeeDocuments.tenantId, t.tenantId), eq(employeeDocuments.employeeId, row.e.id))).orderBy(asc(employeeDocuments.createdAt));
  const [invite] = await db.select().from(onboardingInvites).where(and(eq(onboardingInvites.tenantId, t.tenantId), eq(onboardingInvites.employeeId, row.e.id)));
  const [membership] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, t.tenantId), eq(memberships.employeeId, row.e.id)));

  const sensitive = can(t.permissions, "employees", "edit") || can(t.permissions, "payroll", "view");
  const reveal = c.req.query("reveal") === "account" && can(t.permissions, "employees", "edit");
  const { accountNumberEnc, ...e } = row.e;
  let accountNumber: string | null = null;
  if (reveal) {
    accountNumber = await decryptField(accountNumberEnc, c.env.ENCRYPTION_KEY);
    await audit(c, { action: "employee.reveal_account", entity: "employee", entityId: e.id, summary: `Viewed full bank account of ${e.fullName}` });
  }
  return c.json({
    ...e,
    annualCtc: sensitive ? e.annualCtc : null,
    accountNumber,
    department: row.department,
    designation: row.designation,
    branch: row.branch,
    branchState: row.branchState,
    manager: row.manager,
    shift: row.shift ? `${row.shift} · ${row.shiftStart}–${row.shiftEnd}` : null,
    hasLogin: !!membership,
    invite: invite ? { status: invite.status, progress: invite.progress, sentAt: invite.sentAt, expiresAt: invite.expiresAt, submittedAt: invite.submittedAt } : null,
    documents: docs,
  });
});

async function assertRefs(c: Context<AppEnv>, tid: string, body: Record<string, unknown>, selfId?: string) {
  const db = c.get("db");
  const check = async (table: any, id: unknown, label: string) => {
    if (!id) return;
    const [r] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id as string), eq(table.tenantId, tid)));
    if (!r) throw badRequest(`${label} not found`);
  };
  await check(departments, body.departmentId, "Department");
  await check(designations, body.designationId, "Designation");
  await check(branches, body.branchId, "Branch");
  await check(shifts, body.shiftId, "Shift");
  await check(employees, body.managerId, "Reporting manager");
  if (selfId && body.managerId === selfId) throw badRequest("An employee can't report to themselves");
}

employeeRoutes.post("/", requirePerm("employees", "edit"), v("json", employeeCreateSchema), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  await assertRefs(c, tid, body);
  const { sendInvite, accountNumber, ...rest } = body;
  const code = body.employeeCode || (await nextEmployeeCode(db, tid));
  const fullName = [body.firstName, body.lastName].filter(Boolean).join(" ");
  const status = sendInvite ? "onboarding" : body.status;
  const [emp] = await db
    .insert(employees)
    .values({
      ...rest,
      employeeCode: code,
      fullName,
      status,
      tenantId: tid,
      ...(await bankFields(accountNumber, c.env.ENCRYPTION_KEY)),
    } as typeof employees.$inferInsert)
    .returning();
  const linked = await linkExistingLogin(db, tid, emp!.id, emp!.workEmail);
  if (sendInvite && !linked) await sendOnboardingInvite(c, emp!.id);
  await audit(c, { action: "employee.create", entity: "employee", entityId: emp!.id, summary: `Added ${fullName} (${code})` });
  return c.json({ id: emp!.id, employeeCode: code, invited: sendInvite && !linked }, 201);
});

employeeRoutes.patch("/:id", requirePerm("employees", "edit"), v("json", employeeUpdateSchema), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const id = c.req.param("id");
  const [cur] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.tenantId, tid)));
  if (!cur) throw notFound("Employee");
  await assertRefs(c, tid, body, id);
  const { accountNumber, ...rest } = body;
  const patch: Partial<typeof employees.$inferInsert> = { ...(rest as Partial<typeof employees.$inferInsert>), ...(await bankFields(accountNumber, c.env.ENCRYPTION_KEY)) };
  if (body.firstName !== undefined || body.lastName !== undefined) {
    patch.fullName = [body.firstName ?? cur.firstName, body.lastName !== undefined ? body.lastName : cur.lastName].filter(Boolean).join(" ");
  }
  if (accountNumber !== undefined || body.ifsc !== undefined) patch.bankVerified = false;
  const [row] = await db.update(employees).set(patch).where(eq(employees.id, id)).returning();
  const changed = Object.keys(body).filter((k) => k !== "accountNumber");
  await audit(c, { action: "employee.update", entity: "employee", entityId: id, summary: `Updated ${row!.fullName}`, data: { fields: accountNumber !== undefined ? [...changed, "accountNumber"] : changed } });
  return c.json({ id: row!.id });
});

employeeRoutes.post("/:id/invite", requirePerm("employees", "edit"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, c.req.param("id")), eq(employees.tenantId, tid)));
  if (!emp) throw notFound("Employee");
  if (emp.userId) throw badRequest("This employee already has a login");
  await sendOnboardingInvite(c, emp.id);
  await audit(c, { action: "employee.invite", entity: "employee", entityId: emp.id, summary: `Sent onboarding invite to ${emp.workEmail}` });
  return c.json({ ok: true });
});

// ---------- documents ----------
employeeRoutes.post("/:id/documents", requirePerm("employees", "edit"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, c.req.param("id")), eq(employees.tenantId, tid)));
  if (!emp) throw notFound("Employee");
  const doc = await storeUpload(c, tid, emp.id, "verified");
  await audit(c, { action: "document.upload", entity: "employee_document", entityId: doc.id, summary: `Uploaded ${doc.name}` });
  return c.json(doc, 201);
});

/** Shared upload handler (admin and self-service). */
export async function storeUpload(c: Context<AppEnv>, tid: string, employeeId: string, status: "pending" | "verified") {
  const form = await c.req.formData();
  const file = form.get("file");
  const type = String(form.get("type") ?? "other");
  if (!(file instanceof File)) throw badRequest("Attach a file");
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) throw badRequest("Unknown document type");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Files must be 10 MB or smaller");
  if (!ALLOWED_TYPES.includes(file.type)) throw badRequest("Upload a PDF, PNG, JPG or WebP file");
  const key = `tenants/${tid}/employees/${employeeId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await putFile(c.env, key, await file.arrayBuffer(), file.type);
  const [doc] = await c
    .get("db")
    .insert(employeeDocuments)
    .values({
      tenantId: tid,
      employeeId,
      type,
      name: String(form.get("name") || file.name),
      fileKey: key,
      mimeType: file.type,
      sizeBytes: file.size,
      status,
      uploadedBy: c.get("session")!.userId,
      ...(status === "verified" ? { verifiedBy: c.get("session")!.userId, verifiedAt: new Date() } : {}),
    })
    .returning();
  return doc!;
}

employeeRoutes.patch("/documents/:docId", requirePerm("employees", "edit"), v("json", z.object({ status: z.enum(["verified", "rejected", "pending"]) })), async (c) => {
  const { status } = c.req.valid("json");
  const [doc] = await c
    .get("db")
    .update(employeeDocuments)
    .set({ status, verifiedBy: c.get("session")!.userId, verifiedAt: new Date() })
    .where(and(eq(employeeDocuments.id, c.req.param("docId")), eq(employeeDocuments.tenantId, c.get("tenant").tenantId)))
    .returning();
  if (!doc) throw notFound("Document");
  await audit(c, { action: `document.${status}`, entity: "employee_document", entityId: doc.id, summary: `Marked ${doc.name} as ${status}` });
  return c.json(doc);
});

employeeRoutes.delete("/documents/:docId", requirePerm("employees", "edit"), async (c) => {
  const [doc] = await c
    .get("db")
    .delete(employeeDocuments)
    .where(and(eq(employeeDocuments.id, c.req.param("docId")), eq(employeeDocuments.tenantId, c.get("tenant").tenantId)))
    .returning();
  if (!doc) throw notFound("Document");
  await deleteFile(c.env, doc.fileKey);
  await audit(c, { action: "document.delete", entity: "employee_document", entityId: doc.id, summary: `Deleted ${doc.name}` });
  return c.json({ ok: true });
});

// ---------- bulk import ----------
const IMPORT_HEADERS = ["First name", "Last name", "Work email", "Phone", "Date of joining (YYYY-MM-DD)", "Department", "Designation", "Branch", "Employment type", "Annual CTC", "PAN", "UAN", "Bank name", "Account number", "IFSC"];

employeeRoutes.get("/import/template.csv", requirePerm("employees", "edit"), (c) =>
  c.body(toCsv(IMPORT_HEADERS, [["Bhavna", "Solanki", "bhavna.solanki@example.com", "+91 99099 41236", "2026-12-01", "Engineering", "Software Engineer", "Bhavnagar HQ", "full_time", "840000", "", "", "", "", ""]]), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="employee-import-template.csv"',
  }),
);

employeeRoutes.post(
  "/import",
  requirePerm("employees", "edit"),
  v("json", z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(true), sendInvites: z.boolean().default(false) })),
  async (c) => {
    const { csv, dryRun, sendInvites } = c.req.valid("json");
    const db = c.get("db");
    const tid = c.get("tenant").tenantId;
    const [header, ...lines] = parseCsv(csv);
    if (!header) throw badRequest("The file is empty");
    const idx = (name: string) => header.findIndex((h) => h.trim().toLowerCase().startsWith(name.toLowerCase()));
    const col = {
      first: idx("first name"), last: idx("last name"), email: idx("work email"), phone: idx("phone"), doj: idx("date of joining"),
      dept: idx("department"), desig: idx("designation"), branch: idx("branch"), type: idx("employment type"), ctc: idx("annual ctc"),
      pan: idx("pan"), uan: idx("uan"), bank: idx("bank name"), acct: idx("account number"), ifsc: idx("ifsc"),
    };
    if (col.first < 0 || col.email < 0 || col.doj < 0) throw badRequest("The file needs at least First name, Work email and Date of joining columns");

    const [depts, desigs, brs] = await Promise.all([
      db.select().from(departments).where(eq(departments.tenantId, tid)),
      db.select().from(designations).where(eq(designations.tenantId, tid)),
      db.select().from(branches).where(eq(branches.tenantId, tid)),
    ]);
    const find = (list: { id: string; name: string }[], name?: string) => (name ? list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())?.id : undefined);
    const existingEmails = new Set((await db.select({ e: employees.workEmail }).from(employees).where(eq(employees.tenantId, tid))).map((r) => r.e));

    const results: { row: number; name: string; email: string; ok: boolean; errors: string[] }[] = [];
    const valid: { row: number; data: z.infer<typeof employeeCreateSchema> }[] = [];
    lines.forEach((cells, i) => {
      if (cells.every((x) => !x.trim())) return;
      const get = (k: number) => (k >= 0 ? (cells[k] ?? "").trim() : "");
      const errors: string[] = [];
      const deptName = get(col.dept), desigName = get(col.desig), branchName = get(col.branch);
      const departmentId = find(depts, deptName);
      const designationId = find(desigs, desigName);
      const branchId = find(brs, branchName);
      if (deptName && !departmentId) errors.push(`Unknown department "${deptName}"`);
      if (desigName && !designationId) errors.push(`Unknown designation "${desigName}"`);
      if (branchName && !branchId) errors.push(`Unknown branch "${branchName}"`);
      const parsed = employeeCreateSchema.safeParse({
        firstName: get(col.first), lastName: get(col.last), workEmail: get(col.email), phone: get(col.phone), dateOfJoining: get(col.doj),
        departmentId, designationId, branchId, employmentType: get(col.type) || "full_time", annualCtc: get(col.ctc).replace(/[,₹\s]/g, "") || 0,
        pan: get(col.pan), uan: get(col.uan), bankName: get(col.bank), accountNumber: get(col.acct), ifsc: get(col.ifsc), sendInvite: sendInvites,
      });
      if (!parsed.success) errors.push(...parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
      const email = get(col.email).toLowerCase();
      if (existingEmails.has(email)) errors.push("An employee with this email already exists");
      existingEmails.add(email);
      results.push({ row: i + 2, name: `${get(col.first)} ${get(col.last)}`.trim(), email, ok: errors.length === 0, errors });
      if (!errors.length && parsed.success) valid.push({ row: i + 2, data: parsed.data });
    });

    let created = 0;
    if (!dryRun && valid.length) {
      for (const { data } of valid) {
        const { sendInvite, accountNumber, ...rest } = data;
        const code = await nextEmployeeCode(db, tid);
        const [emp] = await db
          .insert(employees)
          .values({ ...rest, tenantId: tid, employeeCode: code, fullName: [data.firstName, data.lastName].filter(Boolean).join(" "), status: sendInvite ? "onboarding" : data.status, ...(await bankFields(accountNumber, c.env.ENCRYPTION_KEY)) } as typeof employees.$inferInsert)
          .returning();
        if (sendInvite) await sendOnboardingInvite(c, emp!.id);
        created++;
      }
      await audit(c, { action: "employee.import", entity: "employee", summary: `Imported ${created} employees` });
    }
    return c.json({ total: results.length, ready: valid.length, failed: results.length - valid.length, created, results });
  },
);
