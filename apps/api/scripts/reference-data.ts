/**
 * Reference data every environment needs (production included): SaaS plans, the
 * statutory master's current rules and the plan feature flags. Idempotent: only
 * adds what's missing, never overwrites edits made in the platform console.
 *
 *   DATABASE_URL=... pnpm --filter @hrms/api bootstrap
 */
import { createDb, featureFlags, plans, statutoryRules, type Database } from "@hrms/db";
import { builtInValue } from "@hrms/shared";

export async function seedReferenceData(db: Database) {
  const [anyPlan] = await db.select({ id: plans.id }).from(plans).limit(1);
  if (!anyPlan) {
    await db.insert(plans).values([
      { key: "starter", name: "Starter", pricePerEmployee: 99, minSeats: 10, maxEmployees: 100, includedAdmins: 2, sortOrder: 1, description: "Per employee / month · up to 100 employees", features: ["Employees, attendance, leave", "Payroll + payslips", "PF / ESI / PT reports", "2 admin users"] },
      { key: "growth", name: "Growth", pricePerEmployee: 149, minSeats: 50, maxEmployees: 1000, includedAdmins: 10, sortOrder: 2, description: "Per employee / month · 100 to 1,000 employees", features: ["Everything in Starter", "TDS, Form 16, reimbursements", "Bank files & reconciliation", "10 admin users · custom roles"] },
      { key: "enterprise", name: "Enterprise", pricePerEmployee: null, minSeats: 500, includedAdmins: null, sortOrder: 3, description: "1,000+ employees · annual contract", features: ["Multi-entity & multi-state", "SSO, audit export, API", "Dedicated success manager", "99.9% SLA"] },
    ]);
  }
  // statutory master from the design: live versions match the built-in rules, plus two drafts
  const [anyRule] = await db.select({ id: statutoryRules.id }).from(statutoryRules).limit(1);
  if (!anyRule) {
    const live = (category: string, scope: string, key: string, effectiveFrom: string, source: string) => ({ key, category, scope, value: builtInValue(category as "pf", scope)!, effectiveFrom, status: "live", source, publishedAt: new Date() });
    await db.insert(statutoryRules).values([
      live("pf", "All India", "pf", "2014-09-01", "EPF Scheme 1952, wage ceiling ₹15,000 from 01 Sep 2014"),
      live("esi", "All India", "esi", "2019-07-01", "ESI rates 0.75% / 3.25% from 01 Jul 2019, ceiling ₹21,000 from 01 Jan 2017"),
      live("pt", "Gujarat", "pt:Gujarat", "2022-04-01", "Gujarat Panchayats, Municipalities, Municipal Corporations and State Tax on Professions Act"),
      live("pt", "Maharashtra", "pt:Maharashtra", "2023-04-01", "Maharashtra State Tax on Professions Act"),
      live("lwf", "Gujarat", "lwf:Gujarat", "2020-01-01", "Gujarat Labour Welfare Fund Act"),
      live("tax", "2025-26", "tax:2025-26", "2025-04-01", "Finance Act 2025"),
      live("tax", "2026-27", "tax:2026-27", "2026-04-01", "Carried forward from FY 2025-26. Confirm against the Finance Act 2026"),
      { key: "pt:Karnataka", category: "pt", scope: "Karnataka", value: { none: false, slabs: [{ upTo: 25000, amount: 0 }, { upTo: null, amount: 200 }], femaleSlabs: null, februaryTop: 300 }, effectiveFrom: "2027-04-01", status: "draft", source: "Karnataka Tax on Professions (Amendment), threshold ₹25,000", notes: "Revision effective 1 Apr 2027, not yet published" },
      { key: "minwage:Gujarat", category: "minwage", scope: "Gujarat", value: { monthly: 12870, zone: "Zone II", skill: "Skilled" }, effectiveFrom: "2026-10-01", status: "draft", source: "Gujarat minimum wage notification, Oct 2026" },
    ]);
  }
  // plan gates from the design: Starter has no TDS, claims or bank files
  await db
    .insert(featureFlags)
    .values([
      { key: "module.tds", name: "TDS declarations and Form 16", description: "TDS module, employee tax declarations and Form 16", rollout: "plans", plans: ["trial", "growth", "enterprise"] },
      { key: "module.reimbursements", name: "Reimbursements", description: "Expense claims with receipts and approvals", rollout: "plans", plans: ["trial", "growth", "enterprise"] },
      { key: "module.payments", name: "Payment batches and bank files", description: "Bank files, reconciliation and failed payments", rollout: "plans", plans: ["trial", "growth", "enterprise"] },
      { key: "module.reports", name: "Reports", description: "Downloadable reports with filters", rollout: "all" },
      { key: "module.compliance", name: "Statutory compliance", description: "EPF, ESI, PT, LWF liabilities and return files", rollout: "all" },
    ])
    .onConflictDoNothing();
}

if (process.argv[1]?.endsWith("reference-data.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = createDb(url, { max: 1 });
  await seedReferenceData(db);
  await db.$client.end();
  console.log("Reference data ready (plans, statutory master, feature flags)");
}
