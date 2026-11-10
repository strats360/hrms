import { describe, expect, it } from "vitest";
import { readTwoFactorPolicy, twoFactorRequired } from "../src/security";

describe("two-factor policy", () => {
  it("reads the setting, defaulting to off", () => {
    expect(readTwoFactorPolicy(null)).toBe("off");
    expect(readTwoFactorPolicy({ security: { twoFactor: "bogus" } })).toBe("off");
    expect(readTwoFactorPolicy({ security: { twoFactor: "admins" } })).toBe("admins");
  });
  it("applies to admins or everyone", () => {
    expect(twoFactorRequired("off", true)).toBe(false);
    expect(twoFactorRequired("admins", true)).toBe(true);
    expect(twoFactorRequired("admins", false)).toBe(false);
    expect(twoFactorRequired("everyone", false)).toBe(true);
  });
});
