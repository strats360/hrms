import { eq } from "drizzle-orm";
import { statutoryRules, type Database } from "@hrms/db";
import { resolveRules, type RuleVersion, type StatutoryRules } from "@hrms/shared";

/** Live rule versions, cached per isolate. Publishing clears the cache. */
let cache: { at: number; rows: RuleVersion[] } | null = null;
const TTL = 60_000;

export function invalidateRules() {
  cache = null;
}

export async function liveRules(db: Database): Promise<RuleVersion[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const rows = await db.select().from(statutoryRules).where(eq(statutoryRules.status, "live"));
  cache = { at: Date.now(), rows };
  return rows;
}

/** Rules in force for a payroll month ("YYYY-MM"): versions effective on or before the 1st. */
export async function rulesFor(db: Database, month: string): Promise<StatutoryRules> {
  return resolveRules(await liveRules(db), `${month}-01`);
}
