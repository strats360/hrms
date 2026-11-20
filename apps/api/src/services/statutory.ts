import { eq } from "drizzle-orm";
import { statutoryRules, type Database } from "@hrms/db";
import { daysInMonth, resolveRules, resolveRulesForPeriod, type RuleVersion, type StatutoryRules } from "@hrms/shared";

/** Live rule versions per country, cached per isolate. Publishing clears the cache. */
let cache: { at: number; rows: (RuleVersion & { country: string })[] } | null = null;
const TTL = 60_000;

export function invalidateRules() {
  cache = null;
}

/** Live rule versions for a country (default India). */
export async function liveRules(db: Database, country = "IN"): Promise<RuleVersion[]> {
  if (!cache || Date.now() - cache.at >= TTL) cache = { at: Date.now(), rows: await db.select().from(statutoryRules).where(eq(statutoryRules.status, "live")) };
  return cache.rows.filter((r) => r.country === country);
}

/** A country's rules in force for a payroll month ("YYYY-MM"): versions effective on or before the 1st. */
export async function rulesFor(db: Database, month: string, country = "IN"): Promise<StatutoryRules> {
  // a ceiling that changes mid month (EPF, 17 Sep 2026) is split by days
  const end = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}`;
  return resolveRulesForPeriod(await liveRules(db, country), `${month}-01`, end);
}
