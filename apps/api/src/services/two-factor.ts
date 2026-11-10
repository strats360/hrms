import { and, eq, like } from "drizzle-orm";
import { session, twoFactor, user, verification, type Database } from "@hrms/db";

/**
 * Turn off someone's two-factor sign-in (lost phone, no backup codes). Also forgets their
 * trusted devices and signs them out everywhere, so whoever has the old device can't carry on.
 */
export async function resetTwoFactor(db: Database, userId: string) {
  await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await db.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, userId));
  await db.delete(verification).where(and(eq(verification.value, userId), like(verification.identifier, "trust-device-%")));
  await db.delete(session).where(eq(session.userId, userId));
}
