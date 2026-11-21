import { z } from "zod";

/**
 * Workplace committees under Indian law:
 * - POSH Internal Committee (Sexual Harassment of Women at Workplace Act 2013, section 4): a senior
 *   woman employee presides, at least two employee members, one external member from an NGO or
 *   someone familiar with the issues, at least half the members women, and a term of at most
 *   three years. Needed with 10 or more employees.
 * - Grievance Redressal Committee (Industrial Relations Code 2020, section 4): equal numbers from
 *   the employer and the workers, at most 10 members, women in proportion to the women workers,
 *   and a chairperson who alternates between the two sides each year. Needed with 20 or more workers.
 */
export const COMMITTEE_KINDS = ["posh_ic", "grc"] as const;
export type CommitteeKind = (typeof COMMITTEE_KINDS)[number];
export const COMMITTEE_LABELS: Record<CommitteeKind, string> = { posh_ic: "POSH Internal Committee", grc: "Grievance Redressal Committee" };

export const MEMBER_ROLES = ["presiding", "chair", "member", "external"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const committeeMemberSchema = z
  .object({
    employeeId: z.string().min(1).nullable().optional(),
    /** For an external member, who isn't an employee. */
    name: z.string().trim().max(120).nullable().optional(),
    organisation: z.string().trim().max(120).nullable().optional(),
    role: z.enum(MEMBER_ROLES),
    gender: z.enum(["female", "male", "other"]),
    /** GRC only: which side the member speaks for. */
    side: z.enum(["employer", "worker"]).nullable().optional(),
  })
  .refine((m) => !!m.employeeId || !!m.name, "Pick an employee or enter the external member's name");
export type CommitteeMember = z.infer<typeof committeeMemberSchema>;

export const committeeSchema = z.object({
  kind: z.enum(COMMITTEE_KINDS),
  entityId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  constitutedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  members: z.array(committeeMemberSchema).min(1).max(20),
  /** Awareness sessions and workshops held, for the POSH annual report. */
  workshops: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().trim().min(1).max(160) })).max(100).default([]),
});
export type CommitteeInput = z.infer<typeof committeeSchema>;

const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

/** What the law asks of the committee that this one doesn't meet. Empty means it's properly constituted. */
export function committeeProblems(c: Pick<CommitteeInput, "kind" | "members" | "constitutedOn" | "termEndsOn">, opts: { today?: string; seniorWomanIds?: Set<string> } = {}): string[] {
  const out: string[] = [];
  const m = c.members;
  const women = m.filter((x) => x.gender === "female").length;
  if (c.kind === "posh_ic") {
    const presiding = m.filter((x) => x.role === "presiding");
    if (presiding.length !== 1) out.push("Name one presiding officer");
    else if (presiding[0]!.gender !== "female" || !presiding[0]!.employeeId) out.push("The presiding officer must be a senior woman employee");
    else if (opts.seniorWomanIds && !opts.seniorWomanIds.has(presiding[0]!.employeeId!)) out.push("Check the presiding officer is at a senior level");
    if (m.filter((x) => x.role === "member" && x.employeeId).length < 2) out.push("Add at least two employee members");
    if (m.filter((x) => x.role === "external").length < 1) out.push("Add an external member from an NGO or someone familiar with sexual harassment issues");
    if (women * 2 < m.length) out.push("At least half the members must be women");
    const end = c.termEndsOn ?? addYears(c.constitutedOn, 3);
    if (end > addYears(c.constitutedOn, 3)) out.push("A member's term can be at most three years");
  } else {
    if (m.length > 10) out.push("The committee can have at most 10 members");
    const er = m.filter((x) => x.side === "employer").length;
    const wk = m.filter((x) => x.side === "worker").length;
    if (er + wk !== m.length) out.push("Say which side each member represents");
    else if (er !== wk) out.push("It needs the same number of members from the employer and the workers");
    if (m.filter((x) => x.role === "chair").length !== 1) out.push("Name one chairperson; the role alternates between the two sides each year");
    if (!women) out.push("Include women, in proportion to the women workers");
  }
  const end = c.termEndsOn ?? (c.kind === "posh_ic" ? addYears(c.constitutedOn, 3) : null);
  if (end && opts.today && end < opts.today) out.push("The committee's term has ended; reconstitute it");
  return out;
}

export const CASE_STATUSES = ["received", "conciliation", "inquiry", "report", "action", "closed", "withdrawn"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  received: "Received",
  conciliation: "Conciliation",
  inquiry: "Inquiry",
  report: "Report written",
  action: "With the employer for action",
  closed: "Closed",
  withdrawn: "Withdrawn",
};
export const caseFileSchema = z.object({
  kind: z.enum(COMMITTEE_KINDS),
  subject: z.string().trim().min(3, "Say briefly what happened").max(160),
  description: z.string().trim().min(10, "Describe what happened").max(8000),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** The person complained about, when they work here. */
  respondentEmployeeId: z.string().min(1).nullable().optional(),
  respondentName: z.string().trim().max(120).nullable().optional(),
});

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The dates a case has to meet.
 * POSH: complaint within 3 months of the incident (the committee can allow 3 more); inquiry done
 * within 90 days of the complaint; report within 10 days after; the employer acts within 60 days.
 * GRC: the grievance within a year of the cause; the committee decides within 30 days; an appeal
 * to the employer is decided within 30 days.
 */
export function caseDeadlines(kind: CommitteeKind, c: { filedOn: string; incidentDate?: string | null; reportOn?: string | null }) {
  if (kind === "posh_ic") {
    const inquiry = addDays(c.filedOn, 90);
    return {
      lateFiling: c.incidentDate ? c.filedOn > addDays(c.incidentDate, 91) : false,
      filingNote: c.incidentDate && c.filedOn > addDays(c.incidentDate, 91) ? (c.filedOn > addDays(c.incidentDate, 183) ? "Filed more than six months after the incident" : "Filed over three months after the incident; the committee can accept it for reasons it records") : null,
      inquiryBy: inquiry,
      reportBy: addDays(c.reportOn ?? inquiry, c.reportOn ? 0 : 10),
      actionBy: c.reportOn ? addDays(c.reportOn, 60) : addDays(inquiry, 70),
    };
  }
  return {
    lateFiling: c.incidentDate ? c.filedOn > addDays(c.incidentDate, 365) : false,
    filingNote: c.incidentDate && c.filedOn > addDays(c.incidentDate, 365) ? "Filed more than a year after the cause" : null,
    inquiryBy: addDays(c.filedOn, 30),
    reportBy: addDays(c.filedOn, 30),
    actionBy: c.reportOn ? addDays(c.reportOn, 30) : addDays(c.filedOn, 60),
  };
}

/** The POSH annual report for a calendar year (section 21 and rule 14). */
export function poshAnnualReport(year: number, cases: { filedOn: string; status: CaseStatus; closedOn?: string | null }[], workshops: { date: string }[]) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const filed = cases.filter((c) => c.filedOn >= from && c.filedOn <= to);
  const done = (c: { status: CaseStatus; closedOn?: string | null }) => (c.status === "closed" || c.status === "withdrawn") && !!c.closedOn && c.closedOn <= to;
  const open = cases.filter((c) => c.filedOn <= to && !done(c));
  return {
    year,
    received: filed.length,
    disposed: cases.filter((c) => done(c) && c.closedOn! >= from).length,
    pending: open.length,
    pendingOver90Days: open.filter((c) => addDays(c.filedOn, 90) < to).length,
    workshops: workshops.filter((w) => w.date >= from && w.date <= to).length,
  };
}
