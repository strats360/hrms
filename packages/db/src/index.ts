import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };
export * from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client. On Cloudflare Workers pass the Hyperdrive
 * connection string; Hyperdrive pools connections, so keep `max` small.
 */
export function createDb(connectionString: string, opts: { max?: number } = {}) {
  const client = postgres(connectionString, {
    max: opts.max ?? 5,
    fetch_types: false,
    prepare: true,
  });
  return drizzle(client, { schema, casing: undefined });
}
