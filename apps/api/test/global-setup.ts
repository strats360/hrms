import { execSync } from "node:child_process";
import postgres from "postgres";

/**
 * Recreate the test database, run migrations and load the demo seed.
 * Requires a local Postgres; set TEST_DATABASE_URL to override.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://hrms:hrms@localhost:5432/hrms_test";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await sql.end();
  const env = { ...process.env, DATABASE_URL: url, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? btoa("k".repeat(32)), ENVIRONMENT: "test" };
  execSync("pnpm --filter @hrms/db migrate", { env, stdio: "inherit", cwd: new URL("../../..", import.meta.url).pathname });
  execSync("npx tsx scripts/seed.ts", { env, stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
  process.env.TEST_DATABASE_URL = url;
}
