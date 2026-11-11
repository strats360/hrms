import { z } from "zod";
import { EMPLOYMENT_TYPES } from "./constants";

/** Recruitment: openings, candidates moving through stages, interviews, and hiring into onboarding. */
export const JOB_STATUSES = ["draft", "open", "on_hold", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { draft: "Draft", open: "Open", on_hold: "On hold", closed: "Closed" };

export const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected", withdrawn: "Withdrawn" };
/** Stages a candidate moves through, in order, before they're hired. */
export const PIPELINE: Stage[] = ["applied", "screening", "interview", "offer"];
export const CLOSED_STAGES: Stage[] = ["hired", "rejected", "withdrawn"];

export const SOURCES = ["careers_page", "referral", "job_portal", "linkedin", "agency", "campus", "walk_in", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { careers_page: "Careers page", referral: "Employee referral", job_portal: "Job portal", linkedin: "LinkedIn", agency: "Agency", campus: "Campus", walk_in: "Walk-in", other: "Other" };

export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = { strong_yes: "Strong yes", yes: "Yes", no: "No", strong_no: "Strong no" };

export const INTERVIEW_MODES = ["in_person", "video", "phone"] as const;
export const INTERVIEW_MODE_LABEL: Record<(typeof INTERVIEW_MODES)[number], string> = { in_person: "In person", video: "Video call", phone: "Phone" };

/** Can a candidate move from one stage to another? Anything open can close; closed ones only reopen to screening. */
export function canMove(from: Stage, to: Stage) {
  if (from === to) return false;
  if (to === "hired") return from === "offer";
  if (CLOSED_STAGES.includes(from)) return from !== "hired" && to === "screening";
  return true;
}

/** Days since a date, for "in this stage for N days". */
export const daysSince = (iso: string | Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const money = z.number().min(0).max(1e9);
const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a phone number").nullable().default(null);

export const jobSchema = z
  .object({
    title: z.string().trim().min(2, "Give the job a title").max(120),
    departmentId: z.string().nullable().default(null),
    designationId: z.string().nullable().default(null),
    branchId: z.string().nullable().default(null),
    location: z.string().trim().max(120).nullable().default(null),
    employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
    openings: z.number().int().min(1).max(500).default(1),
    minExperience: z.number().min(0).max(50).nullable().default(null),
    maxExperience: z.number().min(0).max(50).nullable().default(null),
    minCtc: money.nullable().default(null),
    maxCtc: money.nullable().default(null),
    description: z.string().trim().max(10000).default(""),
    hiringManagerId: z.string().nullable().default(null),
    status: z.enum(JOB_STATUSES).default("draft"),
    /** Listed on the public careers page while open. */
    published: z.boolean().default(false),
  })
  .refine((j) => j.minCtc == null || j.maxCtc == null || j.maxCtc >= j.minCtc, { message: "The top of the range is below the bottom", path: ["maxCtc"] })
  .refine((j) => j.minExperience == null || j.maxExperience == null || j.maxExperience >= j.minExperience, { message: "The top of the range is below the bottom", path: ["maxExperience"] });

export const candidateSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(120),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  phone,
  currentCompany: z.string().trim().max(120).nullable().default(null),
  currentTitle: z.string().trim().max(120).nullable().default(null),
  experienceYears: z.number().min(0).max(60).nullable().default(null),
  currentCtc: money.nullable().default(null),
  expectedCtc: money.nullable().default(null),
  noticeDays: z.number().int().min(0).max(365).nullable().default(null),
  location: z.string().trim().max(120).nullable().default(null),
  source: z.enum(SOURCES).default("other"),
  referredById: z.string().nullable().default(null),
  notes: z.string().trim().max(4000).default(""),
});
/** Add a candidate to a job in one go. */
export const addCandidateSchema = candidateSchema.extend({ jobId: z.string() });

export const moveSchema = z.object({ stage: z.enum(STAGES), note: z.string().trim().max(2000).default(""), reason: z.string().trim().max(200).default("") });

export const interviewSchema = z.object({
  round: z.string().trim().min(2, "Name the round, e.g. Technical").max(80),
  scheduledAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(10).max(480).default(45),
  mode: z.enum(INTERVIEW_MODES).default("video"),
  location: z.string().trim().max(500).nullable().default(null),
  interviewerIds: z.array(z.string()).min(1, "Pick at least one interviewer").max(8),
});
export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  recommendation: z.enum(RECOMMENDATIONS),
  notes: z.string().trim().min(10, "Write a few lines about how it went").max(4000),
});

export const offerSchema = z.object({
  offeredCtc: money.refine((n) => n > 0, "Enter the offered CTC"),
  joiningDate: isoDate,
  designationId: z.string().nullable().default(null),
  note: z.string().trim().max(2000).default(""),
});
export const hireSchema = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  workEmail: z.email(),
  dateOfJoining: isoDate,
  sendOnboardingInvite: z.boolean().default(true),
});

export const careersSettingsSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,40}$/, "Use 3 to 40 letters, numbers or dashes")
    .nullable(),
  intro: z.string().trim().max(2000).default(""),
});

/** The public application form (resume is a separate file field). */
export const applySchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email"),
  phone: z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a phone number"),
  currentCompany: z.string().trim().max(120).default(""),
  experienceYears: z.coerce.number().min(0).max(60).optional(),
  noticeDays: z.coerce.number().int().min(0).max(365).optional(),
  note: z.string().trim().max(2000).default(""),
  /** Spam trap: people leave it empty, bots fill it in. */
  website: z.string().max(0, "Leave this empty").default(""),
  consent: z.literal("yes", "Please agree to us keeping your details for this application"),
});
