import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { payrollAdjustments, payrollItems, payrollRuns, tenants } from "@hrms/db";
import { buildPayrollJournal, journalTotals, periodLabel, tallyJournalXml, type JournalSettings, type PayFrequency, JOURNAL_ACCOUNT_DEFAULTS } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { toCsv } from "../lib/csv";
import { entityOf } from "../services/entities";

/** The accounting journal for a payroll run, to post in Zoho Books, Tally or any ledger. */
export const journalRoutes = new Hono<AppEnv>();

async function journalFor(c: Context<AppEnv>) {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, c.req.param("id")!), eq(payrollRuns.tenantId, tid)));
  if (!run) throw notFound("Payroll run");
  if (run.status === "draft") throw badRequest("Calculate the payroll first");
  const [items, loans, [t], ent] = await Promise.all([
    db.select().from(payrollItems).where(eq(payrollItems.runId, run.id)),
    db.select({ label: payrollAdjustments.label }).from(payrollAdjustments).where(and(eq(payrollAdjustments.runId, run.id), eq(payrollAdjustments.source, "loan"))),
    db.select({ s: tenants.settings, name: tenants.name, legalName: tenants.legalName }).from(tenants).where(eq(tenants.id, tid)),
    entityOf(db, tid, run.entityId),
  ]);
  const settings = (t?.s as { journal?: JournalSettings } | null)?.journal;
  // held payslips aren't paid, so they stay out of the journal until they are
  const paid = items.filter((i) => !i.onHold);
  const lines = buildPayrollJournal(
    paid.map((i) => ({ department: i.snapshot.department, earnings: i.earnings, deductions: i.deductions, employer: i.employer, reimbursement: Number(i.reimbursement), net: Number(i.net) })),
    { settings, loanLabels: new Set(loans.map((l) => l.label)) },
  );
  const date = run.payDate ?? run.periodEnd;
  const period = periodLabel({ frequency: run.frequency as PayFrequency, periodStart: run.periodStart, periodEnd: run.periodEnd, month: run.month });
  const narration = run.kind === "off_cycle" ? `${run.label ?? "Off-cycle pay"} (${period})` : `Salary for ${period}`;
  return { run, lines, date, narration, currency: ent.currency, held: items.length - paid.length, company: t?.legalName ?? t?.name ?? "", entity: ent.name };
}

journalRoutes.get("/runs/:id/journal", requirePerm("payroll", "view"), async (c) => {
  const j = await journalFor(c);
  return c.json({ date: j.date, narration: j.narration, currency: j.currency, lines: j.lines, totals: journalTotals(j.lines), held: j.held, accounts: JOURNAL_ACCOUNT_DEFAULTS });
});

journalRoutes.get("/runs/:id/journal.csv", requirePerm("payroll", "export"), async (c) => {
  const j = await journalFor(c);
  const format = c.req.query("format") === "zoho" ? "zoho" : "plain";
  const ref = `PAY-${j.run.month}${j.run.kind === "off_cycle" ? "-OC" : ""}`;
  const csv =
    format === "zoho"
      ? // Zoho Books: Accountant, Manual Journals, Import Journals
        toCsv(
          ["Journal Date", "Reference Number", "Notes", "Journal Type", "Currency", "Account", "Description", "Debit", "Credit"],
          j.lines.map((l) => [j.date, ref, j.narration, "both", j.currency, l.account, l.description, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : ""]),
        )
      : toCsv(
          ["Date", "Reference", "Account", "Description", "Debit", "Credit", "Narration"],
          j.lines.map((l) => [j.date, ref, l.account, l.description, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : "", j.narration]),
        );
  await audit(c, { action: "payroll.journal_export", entity: "payroll_run", entityId: j.run.id, summary: `Exported the ${j.narration} journal (${format === "zoho" ? "Zoho Books" : "CSV"})` });
  return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${j.run.month}${format === "zoho" ? "-zoho" : ""}.csv"` });
});

journalRoutes.get("/runs/:id/journal.xml", requirePerm("payroll", "export"), async (c) => {
  const j = await journalFor(c);
  const xml = tallyJournalXml(j.lines, { date: j.date, narration: j.narration, company: j.company });
  await audit(c, { action: "payroll.journal_export", entity: "payroll_run", entityId: j.run.id, summary: `Exported the ${j.narration} journal (Tally)` });
  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${j.run.month}-tally.xml"` });
});
