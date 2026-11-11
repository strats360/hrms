import { and, eq, inArray, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import {
  attendanceCorrections,
  attendancePunches,
  attendanceRecords,
  claimReceipts,
  compOffRequests,
  employeeDocuments,
  employeeExits,
  employeeLoans,
  employees,
  leaveBalances,
  leaveEncashments,
  leaveRequests,
  loanRepayments,
  memberships,
  onboardingInvites,
  performanceReviews,
  reviewCycles,
  reviewGoals,
  payments,
  payrollAdjustments,
  payrollItems,
  privacyRequests,
  probationEvents,
  reimbursementClaims,
  salaryStructures,
  shiftRoster,
  taxDeclarations,
  taxProofs,
  tenants,
  user,
  type Database,
} from "@hrms/db";
import { COMPANY_ISSUED_DOCS, DEFAULT_PRIVACY, ERASED_DATA, KEPT_DATA, todayIST, type PrivacySettings } from "@hrms/shared";
import type { Env } from "../env";
import { deleteFile, getFile, safeName } from "../lib/storage";

export async function privacySettings(db: Database, tenantId: string): Promise<PrivacySettings> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_PRIVACY, ...((t?.settings as { privacy?: Partial<PrivacySettings> } | null)?.privacy ?? {}) };
}

async function myReviews(db: Database, tenantId: string, employeeId: string) {
  const rows = await db.select({ r: performanceReviews, cycle: reviewCycles.name }).from(performanceReviews).innerJoin(reviewCycles, eq(reviewCycles.id, performanceReviews.cycleId)).where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.employeeId, employeeId), ne(reviewCycles.status, "draft")));
  const out = [];
  for (const { r, cycle } of rows) {
    const shared = r.stage === "shared" || r.stage === "acknowledged";
    const goals = await db.select().from(reviewGoals).where(eq(reviewGoals.reviewId, r.id));
    out.push({
      cycle,
      stage: r.stage,
      selfReview: r.self,
      managerReview: shared ? r.manager : null,
      finalRating: shared ? r.finalRating : null,
      employeeComment: r.employeeComment,
      goals: goals.map((g) => ({ title: g.title, description: g.description, weight: g.weight, selfRating: g.selfRating, selfComment: g.selfComment, ...(shared ? { managerRating: g.managerRating, managerComment: g.managerComment } : {}) })),
    });
  }
  return out;
}

/** Columns that are internal plumbing or secrets, never part of the copy. */
const HIDDEN = /^(tenantId|userId|tokenHash|.*Enc|.*Key|draft)$/;
function clean<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !HIDDEN.test(k))));
}

async function bytes(env: Env, key: string | null | undefined) {
  if (!key) return null;
  const f = await getFile(env, key);
  if (!f) return null;
  return new Uint8Array(f.body instanceof ArrayBuffer ? f.body : await new Response(f.body).arrayBuffer());
}
const ext = (mime: string | null | undefined) => ({ "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" })[mime ?? ""] ?? "";
const withExt = (name: string, mime: string | null | undefined) => (/\.\w{2,4}$/.test(name) ? safeName(name) : safeName(name) + ext(mime));

/**
 * Everything we hold about one employee, as a zip: data.json (every record, by area),
 * their uploaded files, and a README saying what's in it.
 */
export async function exportEmployeeData(db: Database, env: Env, tenantId: string, employeeId: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!e) return null;
  const [t] = await db.select({ name: tenants.name, legalName: tenants.legalName }).from(tenants).where(eq(tenants.id, tenantId));
  const own = <T extends { employeeId: unknown; tenantId: unknown }>(tbl: T) => and(eq(tbl.employeeId as never, employeeId), eq(tbl.tenantId as never, tenantId));

  const loans = await db.select().from(employeeLoans).where(own(employeeLoans));
  const claims = await db.select().from(reimbursementClaims).where(own(reimbursementClaims));
  const declarations = await db.select().from(taxDeclarations).where(own(taxDeclarations));
  const docs = await db.select().from(employeeDocuments).where(own(employeeDocuments));
  const receipts = claims.length ? await db.select().from(claimReceipts).where(inArray(claimReceipts.claimId, claims.map((x) => x.id))) : [];
  const proofs = declarations.length ? await db.select().from(taxProofs).where(inArray(taxProofs.declarationId, declarations.map((x) => x.id))) : [];
  const [membership] = await db.select({ prefs: memberships.notificationPrefs, status: memberships.status, lastActiveAt: memberships.lastActiveAt }).from(memberships).where(and(eq(memberships.employeeId, employeeId), eq(memberships.tenantId, tenantId)));

  const profile = clean([e])[0]!;
  const data = {
    exportedAt: new Date().toISOString(),
    company: t?.legalName ?? t?.name ?? "",
    profile: { ...profile, bankAccount: e.accountLast4 ? `ending ${e.accountLast4}` : null },
    documents: clean(docs),
    attendance: clean(await db.select().from(attendanceRecords).where(own(attendanceRecords)).orderBy(attendanceRecords.date)),
    attendanceCorrections: clean(await db.select().from(attendanceCorrections).where(own(attendanceCorrections))),
    devicePunches: clean(await db.select().from(attendancePunches).where(own(attendancePunches)).orderBy(attendancePunches.punchedAt)),
    shiftRoster: clean(await db.select().from(shiftRoster).where(own(shiftRoster)).orderBy(shiftRoster.date)),
    leaveBalances: clean(await db.select().from(leaveBalances).where(own(leaveBalances))),
    leaveRequests: clean(await db.select().from(leaveRequests).where(own(leaveRequests))),
    leaveEncashments: clean(await db.select().from(leaveEncashments).where(own(leaveEncashments))),
    compOff: clean(await db.select().from(compOffRequests).where(own(compOffRequests))),
    salaryStructures: clean(await db.select().from(salaryStructures).where(own(salaryStructures))),
    payslips: clean(await db.select().from(payrollItems).where(own(payrollItems))),
    payrollAdjustments: clean(await db.select().from(payrollAdjustments).where(own(payrollAdjustments))),
    salaryPayments: clean(await db.select().from(payments).where(own(payments))),
    taxDeclarations: clean(declarations),
    taxProofs: clean(proofs),
    expenseClaims: clean(claims),
    claimReceipts: clean(receipts),
    loans: clean(loans),
    loanRepayments: loans.length ? clean(await db.select().from(loanRepayments).where(inArray(loanRepayments.loanId, loans.map((l) => l.id)))) : [],
    probation: clean(await db.select().from(probationEvents).where(own(probationEvents))),
    exit: clean(await db.select().from(employeeExits).where(own(employeeExits))),
    dataRequests: clean(await db.select().from(privacyRequests).where(own(privacyRequests))),
    // reviews: only what the employee can already see (the manager's part once shared)
    performanceReviews: await myReviews(db, tenantId, employeeId),
    account: membership ? { status: membership.status, lastActiveAt: membership.lastActiveAt, emailSettings: membership.prefs } : null,
  };

  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const add = async (folder: string, name: string, key: string | null | undefined) => {
    const b = await bytes(env, key);
    if (!b) return;
    let path = `${folder}/${name}`;
    for (let i = 2; used.has(path); i++) path = `${folder}/${i}-${name}`;
    used.add(path);
    files[path] = b;
  };
  await add("photo", "photo.jpg", e.photoKey);
  for (const d of docs) await add("documents", withExt(d.name, d.mimeType), d.fileKey);
  for (const r of receipts) await add("expense-receipts", withExt(r.fileName, r.mimeType), r.fileKey);
  for (const p of proofs) await add("tax-proofs", withExt(p.fileName, p.mimeType), p.fileKey);

  const readme = [
    `Your data held by ${data.company}`,
    `Prepared ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} for ${e.fullName} (${e.employeeCode}).`,
    "",
    "data.json has every record about you, grouped by area: profile, attendance, leave, salary and payslips, tax, expense claims, loans, probation, performance reviews, exit and your requests about your data.",
    "Dates are in YYYY-MM-DD. Times are in UTC. Amounts are in rupees.",
    "The folders hold the files you or HR uploaded: your photo, documents, expense receipts and tax proofs.",
    "Punch selfies aren't included; HR can share them on request. Bank account numbers show only the last 4 digits.",
    "",
    "You can ask the company to erase your personal data from Your account > Your data, once you've left.",
  ].join("\n");
  const zip = zipSync({ "README.txt": strToU8(readme), "data.json": strToU8(JSON.stringify(data, null, 2)), ...files }, { level: 6 });
  return { zip, filename: `my-data-${safeName(e.employeeCode)}-${todayIST()}.zip`, employee: e, fileCount: Object.keys(files).length };
}

/**
 * Erase personal data the company no longer needs. Keeps what labour and tax law make it hold:
 * name, IDs, PAN/UAN/ESIC, dates, job history, payroll, statutory and tax records, and letters
 * it issued. Removes contact and personal details, bank details, photo, selfies, locations,
 * uploaded personal documents, onboarding answers and the sign-in.
 */
export async function eraseEmployee(db: Database, env: Env, tenantId: string, employeeId: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
  if (!e) throw new Error("employee not found");
  const summary: Record<string, number> = {};

  // files first: once the keys are gone we can't find them again
  const docs = await db.select({ id: employeeDocuments.id, key: employeeDocuments.fileKey }).from(employeeDocuments).where(and(eq(employeeDocuments.employeeId, e.id), notInArray(employeeDocuments.type, COMPANY_ISSUED_DOCS)));
  for (const d of docs) await deleteFile(env, d.key).catch(() => {});
  if (docs.length) await db.delete(employeeDocuments).where(inArray(employeeDocuments.id, docs.map((d) => d.id)));
  summary.documents = docs.length;

  if (e.photoKey) await deleteFile(env, e.photoKey).catch(() => {});
  summary.photo = e.photoKey ? 1 : 0;

  const punched = await db
    .select({ id: attendanceRecords.id, a: attendanceRecords.checkInSelfieKey, b: attendanceRecords.checkOutSelfieKey })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, e.id), or(isNotNull(attendanceRecords.checkInSelfieKey), isNotNull(attendanceRecords.checkOutSelfieKey))));
  for (const r of punched) for (const k of [r.a, r.b]) if (k) await deleteFile(env, k).catch(() => {});
  summary.selfies = punched.reduce((n, r) => n + (r.a ? 1 : 0) + (r.b ? 1 : 0), 0);
  const located = await db
    .update(attendanceRecords)
    .set({ lat: null, lng: null, checkOutLat: null, checkOutLng: null, ip: null, checkInSelfieKey: null, checkOutSelfieKey: null })
    .where(and(eq(attendanceRecords.employeeId, e.id), or(isNotNull(attendanceRecords.lat), isNotNull(attendanceRecords.checkOutLat), isNotNull(attendanceRecords.ip), isNotNull(attendanceRecords.checkInSelfieKey), isNotNull(attendanceRecords.checkOutSelfieKey))))
    .returning({ id: attendanceRecords.id });
  summary.punchLocations = located.length;

  summary.onboarding = (await db.delete(onboardingInvites).where(eq(onboardingInvites.employeeId, e.id)).returning({ id: onboardingInvites.id })).length;

  // the sign-in for this company; the login itself goes too if it isn't used anywhere else
  const ms = await db.delete(memberships).where(and(eq(memberships.employeeId, e.id), eq(memberships.tenantId, tenantId))).returning({ userId: memberships.userId });
  for (const m of ms) {
    const [other] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, m.userId)).limit(1);
    if (!other) await db.delete(user).where(eq(user.id, m.userId));
  }
  summary.signIns = ms.length;

  await db
    .update(employees)
    .set({
      userId: null,
      personalEmail: null,
      phone: null,
      dateOfBirth: null,
      maritalStatus: null,
      bloodGroup: null,
      currentAddress: null,
      emergencyContactName: null,
      emergencyContactRelation: null,
      emergencyContactPhone: null,
      photoKey: null,
      biometricId: null,
      aadhaarLast4: null,
      accountHolderName: null,
      bankName: null,
      accountNumberEnc: null,
      accountLast4: null,
      ifsc: null,
      bankVerified: false,
      // the work mailbox is the company's; keep it unique but unusable for sign-in
      workEmail: `erased.${e.id}@erased.invalid`,
      erasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(employees.id, e.id));
  return { summary, before: e };
}

/** Open loans and an unfinished F&F block erasure. */
export async function erasureState(db: Database, tenantId: string, employeeId: string) {
  const [l] = await db.select({ n: sql<number>`count(*)::int` }).from(employeeLoans).where(and(eq(employeeLoans.tenantId, tenantId), eq(employeeLoans.employeeId, employeeId), inArray(employeeLoans.status, ["approved", "active"])));
  const [x] = await db.select({ n: sql<number>`count(*)::int` }).from(employeeExits).where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId), notInArray(employeeExits.status, ["settled", "cancelled"])));
  return { openLoans: l?.n ?? 0, fnfOpen: (x?.n ?? 0) > 0 };
}

export const PRIVACY_TEXT = { erased: ERASED_DATA, kept: KEPT_DATA };
