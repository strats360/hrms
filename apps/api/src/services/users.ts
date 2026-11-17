import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { badRequest } from "../lib/errors";
import { account, user, type Database } from "@hrms/db";

/**
 * Create (or update the password of) an email/password login.
 * Better Auth stores credentials in auth_account with provider "credential".
 */
export async function upsertLogin(db: Database, input: { email: string; name: string; password: string; verified?: boolean }) {
  const email = input.email.toLowerCase();
  const hash = await hashPassword(input.password);
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    const [acct] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")));
    if (acct) {
      await db.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.id, acct.id));
    } else {
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: existing.id,
        providerId: "credential",
        userId: existing.id,
        password: hash,
      });
    }
    if (input.verified && !existing.emailVerified) {
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, existing.id));
    }
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, email, name: input.name, emailVerified: input.verified ?? false });
  await db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash });
  return id;
}

/**
 * For invite links: create the login if it's new. If the email already has a password,
 * the person must type that password. An invite link never replaces it, because the link
 * could have been forwarded and the login may be shared with other companies.
 */
export async function claimLogin(db: Database, input: { email: string; name: string; password: string; verified?: boolean }) {
  const email = input.email.toLowerCase();
  const [existing] = await db.select().from(user).where(eq(user.email, email));
  if (existing) {
    const [acct] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")));
    if (acct?.password && !(await verifyPassword({ hash: acct.password, password: input.password }))) {
      throw badRequest("You already have a login with this email. Enter your current password, or reset it from the sign in page first.");
    }
  }
  return upsertLogin(db, input);
}

export async function findUserByEmail(db: Database, email: string) {
  const [u] = await db.select().from(user).where(eq(user.email, email.toLowerCase()));
  return u ?? null;
}
