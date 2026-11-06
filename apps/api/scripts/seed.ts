/**
 * Demo data seed (development / staging only).
 *
 *   pnpm --filter @hrms/api seed            # uses DATABASE_URL from apps/api/.dev.vars or env
 *
 * Creates the "Strats360 Technolabs LLP" tenant from the design, 250 employees,
 * two months of attendance, leave requests, onboarding invites and demo logins.
 * Refuses to run when ENVIRONMENT=production.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  attendanceCorrections,
  branches,
  createDb,
  departments,
  designations,
  employeeDocuments,
  employees,
  holidays,
  leaveRequests,
  leaveTypes,
  memberships,
  onboardingInvites,
  platformStaff,
  roles,
  tenants,
  attendanceRecords,
} from "@hrms/db";
import { countLeaveDays, dateRange, encryptField, evaluateAttendance, sha256Hex, todayIST, weekday, DEFAULT_SHIFT } from "@hrms/shared";
import { upsertLogin } from "../src/services/users";
import { provisionTenant } from "../src/services/provisioning";
import { applyUsage, ensureBalances } from "../src/services/leave";
import { calculateRun, defaultPayDate, monthBounds } from "../src/services/payroll";
import { payrollItems, payrollRuns, statutoryChallans, user } from "@hrms/db";
import { inArray } from "drizzle-orm";
import { dueDate } from "@hrms/shared";
import { obligationsForRun } from "../src/routes/compliance";

// ---- env ----
const vars: Record<string, string> = {};
const devVars = join(dirname(fileURLToPath(import.meta.url)), "..", ".dev.vars");
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) vars[m[1]!] = m[2]!;
  }
}
const env = (k: string) => process.env[k] ?? vars[k];
if (env("ENVIRONMENT") === "production" && !process.argv.includes("--force")) {
  console.error("Refusing to seed demo data into production. Pass --force if you really mean it.");
  process.exit(1);
}
const DATABASE_URL = env("DATABASE_URL");
const ENCRYPTION_KEY = env("ENCRYPTION_KEY");
if (!DATABASE_URL || !ENCRYPTION_KEY) throw new Error("DATABASE_URL and ENCRYPTION_KEY are required");
const PASSWORD = env("SEED_PASSWORD") ?? "Demo@12345";

const db = createDb(DATABASE_URL, { max: 1 });

// deterministic pseudo-random
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

const today = todayIST();
const year = Number(today.slice(0, 4));

async function main() {
  const [existing] = await db.select().from(tenants).where(eq(tenants.code, "TN-0142"));
  if (existing) {
    const added = await seedPayroll(existing.id);
    await seedChallans(existing.id);
    console.log(added ? `Added ${added} months of payroll history to the existing demo tenant.` : "Demo tenant already exists. To reseed, drop and recreate the database, then run migrations.");
    await db.$client.end();
    return;
  }

  // ---- logins ----
  const platformUser = await upsertLogin(db, { email: "platform@strats360people.in", name: "Meera Iyer", password: PASSWORD, verified: true });
  await db.insert(platformStaff).values({ userId: platformUser, role: "super_admin" });
  const kunal = await upsertLogin(db, { email: "kunal.shah@strats360.com", name: "Kunal Shah", password: PASSWORD, verified: true });

  // ---- tenant ----
  const { tenant, roles: roleRows } = await provisionTenant(db, { name: "Strats360 Technolabs LLP", legalName: "Strats360 Technolabs LLP", state: "Gujarat", ownerUserId: kunal, plan: "growth", status: "active", code: "TN-0142" });
  const tid = tenant.id;
  const role = (k: string) => roleRows.find((r) => r.key === k)!.id;
  await db
    .update(tenants)
    .set({
      entityType: "LLP",
      industry: "IT services & software",
      gstin: "24ABCFS1234K1Z5",
      pan: "ABCFS1234K",
      tan: "AHMS12345B",
      llpinCin: "AAB-1234",
      registeredAddress: "Plot 12, Waghawadi Road, Bhavnagar 364002, Gujarat",
      contactEmail: "people@strats360.com",
      contactPhone: "+91 278 252 0000",
      setupStep: "6",
      setupCompletedAt: new Date(),
      settings: { payrollCycle: "calendar_month", payDay: "last_working_day", paidDaysBasis: "calendar", weeklyOffs: [0, 6], employeeCodePrefix: "STL", financialYearStartMonth: 4 },
      statutory: {
        epf: { enabled: true, registration: "GJAHD1234567000" },
        esi: { enabled: true, registration: "37000123450001001" },
        pt: { enabled: true, registration: "PT/BVN/2019/1123" },
        lwf: { enabled: true, registration: "LWF/GJ/88231" },
        tds: { enabled: true, registration: "AHMS12345B" },
        bonus: { enabled: false },
      },
    })
    .where(eq(tenants.id, tid));

  const [hq, ahd] = await db
    .insert(branches)
    .values([
      { tenantId: tid, name: "Bhavnagar HQ", code: "BVN", state: "Gujarat", city: "Bhavnagar", address: "Plot 12, Waghawadi Road, Bhavnagar 364002", isHeadOffice: true, ptRegistration: "PT/BVN/2019/1123" },
      { tenantId: tid, name: "Ahmedabad", code: "AMD", state: "Gujarat", city: "Ahmedabad", address: "804, Shivalik Shilp, Iscon Cross Road, Ahmedabad 380015", esiSubCode: "37000123450011" },
    ])
    .returning();
  const deptNames = ["Engineering", "Sales", "Human Resources", "Support", "Finance", "Design", "Operations"];
  const deptRows = await db.insert(departments).values(deptNames.map((name) => ({ tenantId: tid, name }))).returning();
  const dept = (n: string) => deptRows.find((d) => d.name === n)!.id;
  const desigByDept: Record<string, string[]> = {
    Engineering: ["Software Engineer", "Senior Software Engineer", "QA Engineer", "Engineering Manager", "DevOps Engineer", "Tech Lead"],
    Sales: ["Business Development Executive", "Regional Sales Manager", "Inside Sales Executive"],
    "Human Resources": ["HR Business Partner", "Recruiter", "HR Executive"],
    Support: ["Support Specialist", "Support Team Lead"],
    Finance: ["Accounts Executive", "Finance Controller"],
    Design: ["Product Designer", "UI Designer"],
    Operations: ["Office Administrator", "Operations Executive"],
  };
  const desigRows = await db
    .insert(designations)
    .values([...new Set(Object.values(desigByDept).flat())].map((name) => ({ tenantId: tid, name })))
    .returning();
  const desig = (n: string) => desigRows.find((d) => d.name === n)!.id;

  // ---- holidays (Gujarat, demo; HR should confirm the official list) ----
  await db.insert(holidays).values(
    [
      [`${year}-01-14`, "Uttarayan (Makar Sankranti)", "festival"],
      [`${year}-03-04`, "Holi (Dhuleti)", "festival"],
      [`${year}-08-28`, "Raksha Bandhan", "festival"],
      [`${year}-10-20`, "Dussehra", "festival"],
      [`${year}-11-09`, "Diwali", "festival"],
      [`${year}-11-10`, "Gujarati New Year", "festival"],
      [`${year}-12-25`, "Christmas", "optional"],
    ].map(([date, name, type]) => ({ tenantId: tid, date: date!, name: name!, type: type! })),
  );

  // ---- employees ----
  type E = { code: string; first: string; last: string; dept: string; desig: string; loc: "B" | "A"; status: string; ctc: number; doj: string; dob: string; gender: string; mgr?: string; pan: string; uan: string; bank: string; acct: string; ifsc: string; regime: string; type?: string };
  const named: E[] = [
    { code: "STL-0001", first: "Hardik", last: "Mehta", dept: "Engineering", desig: "Engineering Manager", loc: "B", status: "active", ctc: 2400000, doj: "2020-11-10", dob: "1988-03-14", gender: "male", mgr: "STL-0171", pan: "AXBPM4821K", uan: "100923456781", bank: "HDFC Bank", acct: "50100234567812", ifsc: "HDFC0000412", regime: "new" },
    { code: "STL-0042", first: "Priya", last: "Vaghela", dept: "Engineering", desig: "Senior Software Engineer", loc: "B", status: "active", ctc: 1440000, doj: "2022-01-02", dob: "1994-11-07", gender: "female", mgr: "STL-0001", pan: "BNQPV7712C", uan: "100887654321", bank: "ICICI Bank", acct: "034501512345", ifsc: "ICIC0000345", regime: "old" },
    { code: "STL-0057", first: "Ravi", last: "Gohil", dept: "Sales", desig: "Business Development Executive", loc: "A", status: "active", ctc: 660000, doj: "2022-06-15", dob: "1996-08-22", gender: "male", mgr: "STL-0152", pan: "CKRPG3391M", uan: "100776543210", bank: "State Bank of India", acct: "31234567890", ifsc: "SBIN0001234", regime: "new" },
    { code: "STL-0063", first: "Nisha", last: "Trivedi", dept: "Human Resources", desig: "HR Business Partner", loc: "B", status: "active", ctc: 900000, doj: "2021-08-01", dob: "1991-05-30", gender: "female", mgr: "STL-0171", pan: "AGHPT5567R", uan: "100665432109", bank: "HDFC Bank", acct: "50100345678923", ifsc: "HDFC0000412", regime: "new" },
    { code: "STL-0078", first: "Jignesh", last: "Parmar", dept: "Support", desig: "Support Specialist", loc: "B", status: "probation", ctc: 420000, doj: "2026-08-18", dob: "2000-01-11", gender: "male", mgr: "STL-0118", pan: "DLJPP8821Q", uan: "101223344556", bank: "Bank of Baroda", acct: "29870100012345", ifsc: "BARB0BHAVNA", regime: "new" },
    { code: "STL-0091", first: "Krupa", last: "Joshi", dept: "Finance", desig: "Accounts Executive", loc: "B", status: "active", ctc: 540000, doj: "2023-11-15", dob: "1997-09-03", gender: "female", mgr: "STL-0171", pan: "AQKPJ2210F", uan: "100554321098", bank: "Axis Bank", acct: "917010045678901", ifsc: "UTIB0000567", regime: "old" },
    { code: "STL-0104", first: "Mitesh", last: "Chauhan", dept: "Engineering", desig: "QA Engineer", loc: "A", status: "active", ctc: 780000, doj: "2023-04-04", dob: "1995-12-19", gender: "male", mgr: "STL-0001", pan: "BXMPC6654L", uan: "100443210987", bank: "Kotak Mahindra Bank", acct: "7811234567", ifsc: "KKBK0000812", regime: "new" },
    { code: "STL-0118", first: "Dhara", last: "Patel", dept: "Design", desig: "Product Designer", loc: "B", status: "active", ctc: 1100000, doj: "2022-02-20", dob: "1993-06-25", gender: "female", mgr: "STL-0001", pan: "AZDPP4432H", uan: "100332109876", bank: "HDFC Bank", acct: "50100456789034", ifsc: "HDFC0000412", regime: "new" },
    { code: "STL-0133", first: "Sagar", last: "Rathod", dept: "Operations", desig: "Office Administrator", loc: "B", status: "active", ctc: 360000, doj: "2019-11-12", dob: "1990-11-12", gender: "male", mgr: "STL-0063", pan: "CSRPR1198D", uan: "100221098765", bank: "State Bank of India", acct: "32109876543", ifsc: "SBIN0060123", regime: "new" },
    { code: "STL-0152", first: "Amit", last: "Dave", dept: "Sales", desig: "Regional Sales Manager", loc: "A", status: "active", ctc: 1500000, doj: "2021-03-09", dob: "1986-10-16", gender: "male", mgr: "STL-0171", pan: "ABEPD9087J", uan: "100110987654", bank: "HDFC Bank", acct: "50100567890145", ifsc: "HDFC0001133", regime: "old" },
    { code: "STL-0160", first: "Pooja", last: "Bhatt", dept: "Support", desig: "Support Specialist", loc: "B", status: "notice", ctc: 450000, doj: "2024-05-22", dob: "1998-07-27", gender: "female", mgr: "STL-0118", pan: "BPTPB3345E", uan: "100998877665", bank: "Bank of Baroda", acct: "29870100098765", ifsc: "BARB0BHAVNA", regime: "new" },
    { code: "STL-0171", first: "Kunal", last: "Shah", dept: "Finance", desig: "Finance Controller", loc: "B", status: "active", ctc: 1800000, doj: "2020-01-06", dob: "1984-04-05", gender: "male", pan: "AMKPS2231B", uan: "100887766554", bank: "Axis Bank", acct: "917010098765432", ifsc: "UTIB0000567", regime: "old" },
    { code: "STL-0183", first: "Hetal", last: "Makwana", dept: "Human Resources", desig: "Recruiter", loc: "B", status: "inactive", ctc: 500000, doj: "2025-07-14", dob: "1996-02-21", gender: "female", mgr: "STL-0063", pan: "CHMPM5512G", uan: "101112233445", bank: "HDFC Bank", acct: "50100678901256", ifsc: "HDFC0000412", regime: "new", type: "contract" },
  ];
  const onboardingNamed: (E & { inv: string; pct: number; steps: string[] })[] = [
    { code: "STL-0147", first: "Bhavna", last: "Solanki", dept: "Engineering", desig: "Software Engineer", loc: "B", status: "onboarding", ctc: 840000, doj: "2026-12-01", dob: "1999-02-08", gender: "female", mgr: "STL-0042", pan: "", uan: "", bank: "", acct: "", ifsc: "", regime: "new", inv: "in_progress", pct: 47, steps: ["account", "personal", "address"] },
    { code: "STL-0251", first: "Tanvi", last: "Desai", dept: "Engineering", desig: "QA Engineer", loc: "B", status: "onboarding", ctc: 600000, doj: "2026-11-16", dob: "", gender: "female", mgr: "STL-0001", pan: "", uan: "", bank: "", acct: "", ifsc: "", regime: "new", inv: "invited", pct: 0, steps: [] },
    { code: "STL-0252", first: "Yash", last: "Pandya", dept: "Sales", desig: "Inside Sales Executive", loc: "A", status: "onboarding", ctc: 480000, doj: "2026-11-16", dob: "", gender: "male", mgr: "STL-0152", pan: "", uan: "", bank: "", acct: "", ifsc: "", regime: "new", inv: "opened", pct: 0, steps: [] },
    { code: "STL-0253", first: "Riya", last: "Kothari", dept: "Human Resources", desig: "HR Executive", loc: "B", status: "onboarding", ctc: 420000, doj: "2026-12-01", dob: "2001-04-18", gender: "female", mgr: "STL-0063", pan: "FKRPK4471N", uan: "", bank: "HDFC Bank", acct: "50100778899001", ifsc: "HDFC0000412", regime: "new", inv: "submitted", pct: 100, steps: ["account", "personal", "address", "bank", "tax", "documents"] },
  ];

  const firstM = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Shaurya", "Dhruv", "Kabir", "Ritesh", "Nirav", "Chirag", "Parth", "Darshan", "Bhavin", "Jay", "Meet", "Harsh", "Kishan", "Viral", "Rahul", "Tejas", "Mihir", "Pratik", "Kaushal", "Sanjay", "Hemal"];
  const firstF = ["Aanya", "Diya", "Saanvi", "Ananya", "Pari", "Kavya", "Riddhi", "Siddhi", "Foram", "Hetvi", "Khushi", "Mansi", "Nidhi", "Payal", "Rutvi", "Shruti", "Twinkle", "Urvi", "Vidhi", "Zeel", "Janvi", "Krisha", "Drashti", "Heena", "Komal", "Sejal", "Bansari", "Jinal", "Nirali", "Pooja"];
  const lasts = ["Patel", "Shah", "Mehta", "Desai", "Joshi", "Trivedi", "Bhatt", "Pandya", "Vyas", "Parmar", "Solanki", "Chauhan", "Rathod", "Gohil", "Jadeja", "Vaghela", "Makwana", "Dave", "Thakkar", "Modi", "Raval", "Upadhyay", "Kothari", "Sheth", "Dalal"];
  const banks = [["HDFC Bank", "HDFC0000412"], ["ICICI Bank", "ICIC0000345"], ["State Bank of India", "SBIN0001234"], ["Axis Bank", "UTIB0000567"], ["Bank of Baroda", "BARB0BHAVNA"], ["Kotak Mahindra Bank", "KKBK0000812"]] as const;
  const deptWeights = ["Engineering", "Engineering", "Engineering", "Engineering", "Sales", "Sales", "Support", "Support", "Design", "Operations", "Finance", "Human Resources"];
  const mgrFor: Record<string, string> = { Engineering: "STL-0001", Sales: "STL-0152", Support: "STL-0118", Design: "STL-0118", Operations: "STL-0063", Finance: "STL-0171", "Human Resources": "STL-0063" };
  const ctcFor: Record<string, [number, number]> = { Engineering: [480000, 1800000], Sales: [360000, 1100000], Support: [300000, 600000], Design: [500000, 1400000], Operations: [280000, 500000], Finance: [420000, 1000000], "Human Resources": [400000, 900000] };
  const used = new Set([...named, ...onboardingNamed].map((e) => e.code));
  const generated: E[] = [];
  let n = 2;
  while (named.length + generated.length < 246) {
    const code = `STL-${String(n++).padStart(4, "0")}`;
    if (used.has(code)) continue;
    const female = rnd() < 0.42;
    const d = pick(deptWeights);
    const [lo, hi] = ctcFor[d]!;
    const [bank, ifsc] = pick(banks);
    const dy = 2017 + Math.floor(rnd() * 9);
    const doj = `${dy}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
    const r = rnd();
    generated.push({
      code,
      first: pick(female ? firstF : firstM),
      last: pick(lasts),
      dept: d,
      desig: pick(desigByDept[d]!.filter((x) => !/Manager|Controller|Lead/.test(x))),
      loc: rnd() < 0.15 ? "A" : "B",
      status: r < 0.03 ? "exited" : r < 0.06 ? "notice" : doj > `${year}-05-01` ? "probation" : "active",
      ctc: Math.round((lo + rnd() * (hi - lo)) / 12000) * 12000,
      doj: doj > today ? `${year - 1}-06-01` : doj,
      dob: `${1975 + Math.floor(rnd() * 27)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
      gender: female ? "female" : "male",
      mgr: mgrFor[d],
      pan: `${"ABCDEFGHJK"[Math.floor(rnd() * 10)]}${"LMNPQRSTUV"[Math.floor(rnd() * 10)]}${"WXYZABCDEF"[Math.floor(rnd() * 10)]}P${"ABCDEFGHJKLMNPRST"[Math.floor(rnd() * 17)]}${String(1000 + Math.floor(rnd() * 8999))}${"ABCDEFGHJKLMN"[Math.floor(rnd() * 13)]}`,
      uan: String(100000000000 + Math.floor(rnd() * 999999999)),
      bank,
      ifsc,
      acct: String(Math.floor(10_000_000_000 + rnd() * 89_999_999_999)),
      regime: rnd() < 0.7 ? "new" : "old",
    });
  }

  const all = [...named, ...generated, ...onboardingNamed];
  const codeToId = new Map<string, string>();
  for (const e of all) {
    const [row] = await db
      .insert(employees)
      .values({
        tenantId: tid,
        employeeCode: e.code,
        firstName: e.first,
        lastName: e.last,
        fullName: `${e.first} ${e.last}`,
        workEmail: `${e.first}.${e.last}${used.has(e.code) ? "" : e.code.slice(-3)}@strats360.com`.toLowerCase(),
        personalEmail: e.dob ? `${e.first.toLowerCase()}.${e.dob.slice(2, 4)}@gmail.com` : null,
        phone: `+91 98${String(Math.floor(rnd() * 1e8)).padStart(8, "0").replace(/(\d{3})(\d{5})/, "$1 $2")}`,
        dateOfBirth: e.dob || null,
        gender: e.gender,
        maritalStatus: rnd() < 0.5 ? "Married" : "Single",
        bloodGroup: pick(["A+", "B+", "O+", "AB+", "B-", "O-"]),
        currentAddress: e.loc === "B" ? `${Math.floor(rnd() * 300)}, ${pick(["Kaliyabid", "Sardarnagar", "Ghogha Circle", "Waghawadi Road", "Vidhyanagar"])}, Bhavnagar 364002, Gujarat` : `${Math.floor(rnd() * 900)}, ${pick(["Satellite", "Bopal", "Vastrapur", "Navrangpura", "Maninagar"])}, Ahmedabad 380015, Gujarat`,
        permanentAddress: "Same as current",
        emergencyContactName: `${pick(firstM)} ${e.last}`,
        emergencyContactRelation: pick(["Father", "Mother", "Spouse", "Brother"]),
        emergencyContactPhone: `+91 94${String(Math.floor(rnd() * 1e8)).padStart(8, "0").replace(/(\d{3})(\d{5})/, "$1 $2")}`,
        dateOfJoining: e.doj,
        departmentId: dept(e.dept),
        designationId: desig(e.desig),
        branchId: e.loc === "B" ? hq!.id : ahd!.id,
        employmentType: e.type ?? "full_time",
        workLocation: e.loc === "B" ? "Bhavnagar HQ office" : "Ahmedabad office",
        status: e.status,
        probationMonths: 6,
        resignationDate: e.status === "notice" ? `${year}-10-20` : e.status === "exited" ? `${year}-06-15` : null,
        lastWorkingDay: e.status === "notice" ? `${year}-12-19` : e.status === "exited" ? `${year}-07-15` : null,
        annualCtc: e.ctc,
        accountHolderName: e.acct ? `${e.first} ${e.last}` : null,
        bankName: e.bank || null,
        accountNumberEnc: e.acct ? await encryptField(e.acct, ENCRYPTION_KEY!) : null,
        accountLast4: e.acct ? e.acct.slice(-4) : null,
        ifsc: e.ifsc || null,
        bankVerified: !!e.acct && e.status !== "onboarding",
        pan: e.pan || null,
        aadhaarLast4: e.pan ? String(1000 + Math.floor(rnd() * 8999)) : null,
        uan: e.uan || null,
        pfApplicable: true,
        esiApplicable: e.ctc / 12 <= 21000,
        ptApplicable: true,
        taxRegime: e.regime,
      })
      .returning({ id: employees.id });
    codeToId.set(e.code, row!.id);
  }
  for (const e of all) if (e.mgr) await db.update(employees).set({ managerId: codeToId.get(e.mgr)! }).where(eq(employees.id, codeToId.get(e.code)!));
  console.log(`Employees: ${all.length}`);

  // ---- logins & admin roles ----
  const login = async (code: string, email: string, name: string, roleKey: string | null, scope?: string) => {
    const uid = await upsertLogin(db, { email, name, password: PASSWORD, verified: true });
    const empId = codeToId.get(code)!;
    await db.update(employees).set({ userId: uid }).where(eq(employees.id, empId));
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, tid), eq(memberships.userId, uid)));
    if (m) await db.update(memberships).set({ employeeId: empId, roleId: roleKey ? role(roleKey) : m.roleId, scope: scope ?? m.scope }).where(eq(memberships.id, m.id));
    else await db.insert(memberships).values({ tenantId: tid, userId: uid, employeeId: empId, roleId: roleKey ? role(roleKey) : null, scope: scope ?? null });
  };
  await login("STL-0171", "kunal.shah@strats360.com", "Kunal Shah", "super_admin", "All branches");
  await login("STL-0063", "nisha.trivedi@strats360.com", "Nisha Trivedi", "hr_admin", "All branches");
  await login("STL-0091", "krupa.joshi@strats360.com", "Krupa Joshi", "payroll_admin", "All branches");
  await login("STL-0001", "hardik.mehta@strats360.com", "Hardik Mehta", "manager", "Engineering, Design");
  await login("STL-0152", "amit.dave@strats360.com", "Amit Dave", "manager", "Sales · Ahmedabad");
  await login("STL-0042", "priya.vaghela@strats360.com", "Priya Vaghela", null);

  // ---- attendance: last month + this month up to today ----
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const prev = tm === 1 ? `${ty - 1}-12-01` : `${ty}-${String(tm - 1).padStart(2, "0")}-01`;
  const hol = new Set((await db.select({ d: holidays.date }).from(holidays).where(eq(holidays.tenantId, tid))).map((h) => h.d));
  const active = all.filter((e) => !["onboarding", "inactive"].includes(e.status));
  const recs: (typeof attendanceRecords.$inferInsert)[] = [];
  const at = (d: string, mins: number) => new Date(`${d}T${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00+05:30`);
  for (const d of dateRange(prev, today)) {
    if ([0, 6].includes(weekday(d)) || hol.has(d)) continue;
    for (const e of active) {
      if (d < e.doj) continue;
      if (e.status === "exited" && d > `${year}-07-15`) continue;
      const r = rnd();
      if (r < 0.03) continue; // absent
      const isToday = d === today;
      const wfh = r > 0.94;
      const inM = 9 * 60 + (r < 0.1 ? 20 + Math.floor(rnd() * 70) : Math.floor(rnd() * 14));
      const outM = r > 0.9 && r <= 0.94 ? 13 * 60 + 30 : 18 * 60 + Math.floor(rnd() * 75);
      const ci = at(d, inM);
      const co = isToday ? null : at(d, outM);
      if (isToday && rnd() < 0.12) continue; // not yet in
      const ev = evaluateAttendance(DEFAULT_SHIFT, ci, co, { wfh });
      recs.push({ tenantId: tid, employeeId: codeToId.get(e.code)!, date: d, checkIn: ci, checkOut: co, source: wfh ? "wfh" : pick(["biometric", "biometric", "gps", "ip", "web"]), status: ev.status, workMinutes: ev.workMinutes, lateMinutes: ev.lateMinutes, earlyMinutes: ev.earlyMinutes, overtimeMinutes: ev.overtimeMinutes });
    }
  }
  for (let i = 0; i < recs.length; i += 1000) await db.insert(attendanceRecords).values(recs.slice(i, i + 1000));
  console.log(`Attendance records: ${recs.length}`);

  // ---- leave ----
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.tenantId, tid));
  const lt = (code: string) => types.find((t) => t.code === code)!.id;
  for (const e of active) await ensureBalances(db, tid, codeToId.get(e.code)!, year);
  const addDays = (iso: string, nDays: number) => {
    const dt = new Date(iso + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + nDays);
    return dt.toISOString().slice(0, 10);
  };
  const leaves: [string, string, number, number, string, string][] = [
    ["STL-0042", "EL", 12, 16, "Family function in Surat", "pending"],
    ["STL-0057", "SL", 1, 1, "Fever", "pending"],
    ["STL-0104", "CL", 8, 8, "Personal work", "pending"],
    ["STL-0118", "CL", 19, 19, "Personal errand", "pending"],
    ["STL-0152", "EL", 26, 30, "Vacation", "pending"],
    ["STL-0091", "LOP", 22, 23, "No balance, personal", "pending"],
    ["STL-0133", "SL", -1, 0, "Viral infection", "approved"],
    ["STL-0001", "CL", -6, -6, "Diwali shopping", "rejected"],
    ["STL-0063", "EL", -20, -18, "Trip to Somnath", "approved"],
  ];
  let lv = 2300;
  for (const [code, t, s, en, reason, status] of leaves) {
    const start = addDays(today, s);
    const end = addDays(today, en);
    if (start.slice(0, 4) !== end.slice(0, 4)) continue;
    const days = countLeaveDays(start, end, { holidays: hol });
    if (days <= 0) continue;
    const empId = codeToId.get(code)!;
    await db.insert(leaveRequests).values({ tenantId: tid, code: `LV-${lv++}`, employeeId: empId, leaveTypeId: lt(t), startDate: start, endDate: end, days, reason, status, decidedAt: status === "pending" ? null : new Date(), decisionNote: status === "rejected" ? "Release planned that week. Please pick another day." : null });
    if (status === "approved") await applyUsage(db, tid, empId, lt(t), Number(start.slice(0, 4)), days);
  }

  // ---- attendance corrections ----
  await db.insert(attendanceCorrections).values([
    { tenantId: tid, employeeId: codeToId.get("STL-0078")!, date: addDays(today, -2), issue: "Biometric failed", requestedCheckIn: "09:02", requestedCheckOut: "18:15", reason: "Device didn't read my finger" },
    { tenantId: tid, employeeId: codeToId.get("STL-0104")!, date: addDays(today, -1), issue: "Missed punch-out", requestedCheckOut: "18:40", reason: "Left in a hurry for a client call" },
    { tenantId: tid, employeeId: codeToId.get("STL-0057")!, date: addDays(today, -3), issue: "WFH not marked", requestedStatus: "wfh", reason: "Worked from home, forgot to select WFH" },
  ]);

  // ---- onboarding invites ----
  const links: string[] = [];
  for (const e of onboardingNamed) {
    const token = `demo-invite-${e.code.toLowerCase()}-${"x".repeat(24)}`;
    const empId = codeToId.get(e.code)!;
    await db.insert(onboardingInvites).values({
      tenantId: tid,
      employeeId: empId,
      email: `${e.first}.${e.last}@strats360.com`.toLowerCase(),
      tokenHash: await sha256Hex(token),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      status: e.inv,
      progress: e.pct,
      completedSteps: e.steps,
      openedAt: e.inv !== "invited" ? new Date() : null,
      submittedAt: e.inv === "submitted" ? new Date() : null,
    });
    if (e.inv === "submitted") {
      for (const t of ["pan", "aadhaar", "bank_proof"]) {
        await db.insert(employeeDocuments).values({ tenantId: tid, employeeId: empId, type: t, name: `${t}.pdf`, fileKey: `demo/${e.code}/${t}.pdf`, mimeType: "application/pdf", sizeBytes: 420_000, status: "pending" });
      }
    }
    if (e.inv === "invited") links.push(`${env("APP_URL") ?? "http://localhost:5173"}/onboarding/${token}`);
  }

  const months = await seedPayroll(tid);
  await seedChallans(tid);
  console.log(`Payroll history: ${months} locked months`);

  console.log("\nDemo data ready. All demo logins use the password:", PASSWORD);
  console.table([
    { login: "kunal.shah@strats360.com", role: "Tenant super admin" },
    { login: "nisha.trivedi@strats360.com", role: "HR admin" },
    { login: "krupa.joshi@strats360.com", role: "Payroll admin" },
    { login: "hardik.mehta@strats360.com", role: "Manager (Engineering)" },
    { login: "priya.vaghela@strats360.com", role: "Employee (self-service only)" },
    { login: "platform@strats360people.in", role: "Platform super admin" },
  ]);
  console.log("Try employee self-onboarding with:", links[0]);
  await db.$client.end();
}

/**
 * Locked, paid payroll from April of the current FY up to last month, so TDS
 * year-to-date and month-on-month comparisons are realistic. The current month
 * is left for you to run through the wizard.
 */
async function seedPayroll(tid: string) {
  const [any] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(eq(payrollRuns.tenantId, tid)).limit(1);
  if (any) return 0;
  const [krupa] = await db.select({ id: user.id }).from(user).where(eq(user.email, "krupa.joshi@strats360.com"));
  const [kunal] = await db.select({ id: user.id }).from(user).where(eq(user.email, "kunal.shah@strats360.com"));
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const fyStartYear = tm >= 4 ? ty : ty - 1;
  const months: string[] = [];
  for (let d = new Date(Date.UTC(fyStartYear, 3, 1)); d < new Date(Date.UTC(ty, tm - 1, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const attendanceFrom = (tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, "0")}`);
  for (const month of months) {
    const { start, end } = monthBounds(month);
    const [run] = await db.insert(payrollRuns).values({ tenantId: tid, month, periodStart: start, periodEnd: end, payDate: defaultPayDate(month), preparedBy: krupa?.id }).returning();
    await calculateRun(db, tid, run!.id, krupa?.id ?? null, { assumePresent: month < attendanceFrom });
    const paidAt = new Date(defaultPayDate(month) + "T12:00:00+05:30");
    await db
      .update(payrollRuns)
      .set({ status: "paid", approvedBy: kunal?.id, approvedAt: paidAt, publishedAt: paidAt, bankFileExportedAt: paidAt, paidAt, paidBy: kunal?.id, paymentReference: `HDFC-${month.replace("-", "")}-SAL` })
      .where(eq(payrollRuns.id, run!.id));
  }
  return months.length;
}

/** Statutory payments for every locked month except the latest (left open so it shows as due). */
async function seedChallans(tid: string) {
  const [any] = await db.select({ id: statutoryChallans.id }).from(statutoryChallans).where(eq(statutoryChallans.tenantId, tid)).limit(1);
  if (any) return;
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tid), inArray(payrollRuns.status, ["approved", "paid"]))).orderBy(payrollRuns.month);
  const [kunal] = await db.select({ id: user.id }).from(user).where(eq(user.email, "kunal.shah@strats360.com"));
  for (const run of runs.slice(0, -1)) {
    const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, run.id));
    for (const o of obligationsForRun(run, items)) {
      const due = dueDate(o.statute, o.period, o.jurisdiction || null);
      const paidOn = new Date(Date.parse(due + "T00:00:00Z") - 2 * 86400000).toISOString().slice(0, 10);
      const ref = { epf: "TRRN", esi: "ESIC", pt: "PTRC", lwf: "LWF", tds: "CIN" }[o.statute] + "-" + o.period.replace("-", "") + "-" + Math.floor(rnd() * 90000 + 10000);
      await db.insert(statutoryChallans).values({ tenantId: tid, statute: o.statute, period: o.period, jurisdiction: o.jurisdiction, amountDue: o.amount, amountPaid: o.amount, reference: ref, paidOn, createdBy: kunal?.id });
    }
  }
}

main().catch(async (e) => {
  console.error(e);
  await db.$client.end();
  process.exit(1);
});
