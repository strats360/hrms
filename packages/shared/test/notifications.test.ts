import { describe, expect, it } from "vitest";
import { NOTIFICATION_KEYS, NOTIFICATIONS, notificationOn } from "../src/notifications";
import { notificationPrefsSchema } from "../src/schemas";

describe("notification settings", () => {
  it("is on unless the company or the person turned it off", () => {
    expect(notificationOn("leave_decision", null, null)).toBe(true);
    expect(notificationOn("leave_decision", { leave_decision: false }, { leave_decision: true })).toBe(false);
    expect(notificationOn("leave_decision", {}, { leave_decision: false })).toBe(false);
    expect(notificationOn("leave_decision", { payslip_published: false }, {})).toBe(true);
  });
  it("describes every key once", () => {
    expect(NOTIFICATIONS.map((n) => n.key).sort()).toEqual([...NOTIFICATION_KEYS].sort());
  });
  it("accepts some keys and rejects unknown ones", () => {
    expect(notificationPrefsSchema.safeParse({ leave_decision: false }).success).toBe(true);
    expect(notificationPrefsSchema.safeParse({ nope: false }).success).toBe(false);
  });
});
