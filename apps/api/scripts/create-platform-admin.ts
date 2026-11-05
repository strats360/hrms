/**
 * Create (or promote) a platform super admin login.
 *
 *   DATABASE_URL=... pnpm --filter @hrms/api platform-admin -- --email you@company.in --name "Your Name"
 *
 * Prompts for the password (or reads PLATFORM_ADMIN_PASSWORD).
 */
import { createInterface } from "node:readline/promises";
import { createDb, platformStaff } from "@hrms/db";
import { upsertLogin } from "../src/services/users";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const email = arg("email");
const name = arg("name") ?? email;
const role = arg("role") ?? "super_admin";
if (!email || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... platform-admin --email you@company.in --name 'Your Name' [--role super_admin|support|finance]");
  process.exit(1);
}
let password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (min 10 chars): ");
  rl.close();
}
if (!password || password.length < 10) {
  console.error("Password must be at least 10 characters");
  process.exit(1);
}
const db = createDb(process.env.DATABASE_URL, { max: 1 });
const userId = await upsertLogin(db, { email, name: name!, password, verified: true });
await db.insert(platformStaff).values({ userId, role }).onConflictDoUpdate({ target: platformStaff.userId, set: { role, status: "active" } });
await db.$client.end();
console.log(`${email} is now a platform ${role}.`);
