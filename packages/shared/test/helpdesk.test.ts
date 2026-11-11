import { describe, expect, it } from "vitest";
import { helpdeskSettingsSchema, responseDue, DEFAULT_HELPDESK } from "../src/helpdesk";

describe("helpdesk", () => {
  it("scales the reply deadline by priority", () => {
    const t = new Date("2026-11-11T10:00:00Z");
    expect(responseDue(t, 24, "normal").toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(responseDue(t, 24, "high").toISOString()).toBe("2026-11-11T22:00:00.000Z");
    expect(responseDue(t, 24, "urgent").toISOString()).toBe("2026-11-11T16:00:00.000Z");
    expect(responseDue(t, 2, "urgent").toISOString()).toBe("2026-11-11T11:00:00.000Z"); // at least an hour
  });
  it("accepts the defaults and rejects duplicate category keys", () => {
    expect(helpdeskSettingsSchema.safeParse(DEFAULT_HELPDESK).success).toBe(true);
    const dup = { ...DEFAULT_HELPDESK, categories: [DEFAULT_HELPDESK.categories[0], DEFAULT_HELPDESK.categories[0]] };
    expect(helpdeskSettingsSchema.safeParse(dup).success).toBe(false);
  });
});
