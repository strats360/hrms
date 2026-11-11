import { and, eq, inArray, sql } from "drizzle-orm";
import { applicationEvents, applications, candidates, jobOpenings, tenants, type Database } from "@hrms/db";

export type Job = typeof jobOpenings.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Application = typeof applications.$inferSelect;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** PDF or Word, judged by the file's first bytes. */
export function resumeType(b: Uint8Array): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/msword" | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "application/msword";
  return null;
}

export async function nextJobCode(db: Database, tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(jobOpenings).where(eq(jobOpenings.tenantId, tenantId));
  return `JOB-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

export interface CareersSettings {
  slug: string | null;
  intro: string;
}
export async function careersSettings(db: Database, tenantId: string): Promise<CareersSettings> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const s = (t?.settings as { careers?: Partial<CareersSettings> } | null)?.careers;
  return { slug: s?.slug ?? null, intro: s?.intro ?? "" };
}
export async function tenantBySlug(db: Database, slug: string) {
  const [t] = await db.select().from(tenants).where(sql`${tenants.settings} -> 'careers' ->> 'slug' = ${slug.toLowerCase()}`);
  return t ?? null;
}

/** Candidate counts per stage for each job. */
export async function pipelineCounts(db: Database, jobIds: string[]) {
  const out = new Map<string, Record<string, number>>();
  if (!jobIds.length) return out;
  const rows = await db
    .select({ jobId: applications.jobId, stage: applications.stage, n: sql<number>`count(*)::int` })
    .from(applications)
    .where(inArray(applications.jobId, jobIds))
    .groupBy(applications.jobId, applications.stage);
  for (const r of rows) out.set(r.jobId, { ...(out.get(r.jobId) ?? {}), [r.stage]: r.n });
  return out;
}

/** Find a candidate by email or add them; fills in details we didn't have. */
export async function upsertCandidate(db: Database, tenantId: string, input: Partial<Candidate> & { name: string; email: string }) {
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(candidates).where(and(eq(candidates.tenantId, tenantId), eq(candidates.email, email)));
  if (!existing) {
    const [row] = await db.insert(candidates).values({ ...input, email, tenantId } as typeof candidates.$inferInsert).returning();
    return { candidate: row!, created: true };
  }
  const fill = Object.fromEntries(Object.entries(input).filter(([k, v]) => v != null && v !== "" && (existing as Record<string, unknown>)[k] == null)) as Partial<Candidate>;
  if (!Object.keys(fill).length) return { candidate: existing, created: false };
  const [row] = await db.update(candidates).set({ ...fill, updatedAt: new Date() }).where(eq(candidates.id, existing.id)).returning();
  return { candidate: row!, created: false };
}

export async function logEvent(db: Database, tenantId: string, applicationId: string, e: { kind: string; fromStage?: string | null; toStage?: string | null; note?: string | null; byName?: string | null }) {
  await db.insert(applicationEvents).values({ tenantId, applicationId, ...e });
}
