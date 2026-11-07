import { featureFlags, type Database } from "@hrms/db";
import { evaluateFlags, type FlagRule } from "@hrms/shared";

/** Flags change rarely; cache them per isolate for a short time. Writes clear the cache. */
let cache: { at: number; flags: FlagRule[] } | null = null;
const TTL = 30_000;

export function invalidateFlags() {
  cache = null;
}

export async function loadFlags(db: Database): Promise<FlagRule[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.flags;
  const rows = await db.select().from(featureFlags);
  cache = { at: Date.now(), flags: rows };
  return rows;
}

export async function featuresFor(db: Database, tenant: { id: string; plan: string }) {
  return evaluateFlags(await loadFlags(db), tenant);
}
