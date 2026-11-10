/**
 * Two-factor sign-in policy for a company. "admins" covers anyone with an admin role
 * (any access to the admin console); "everyone" also covers self-service-only employees.
 */
export const TWO_FACTOR_POLICIES = ["off", "admins", "everyone"] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];
export const TWO_FACTOR_POLICY_LABELS: Record<TwoFactorPolicy, string> = {
  off: "Optional for everyone",
  admins: "Required for admins",
  everyone: "Required for everyone",
};

export const readTwoFactorPolicy = (settings: unknown): TwoFactorPolicy => {
  const p = (settings as { security?: { twoFactor?: string } } | null | undefined)?.security?.twoFactor;
  return (TWO_FACTOR_POLICIES as readonly string[]).includes(p ?? "") ? (p as TwoFactorPolicy) : "off";
};

/** Does this company's policy require two-factor for this person? */
export const twoFactorRequired = (policy: TwoFactorPolicy, isAdmin: boolean) => policy === "everyone" || (policy === "admins" && isAdmin);
