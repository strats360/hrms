import { describe, expect, it } from "vitest";
import { applySchema, canMove, daysSince } from "../src/recruitment";

describe("recruitment rules", () => {
  it("only hires from an offer, and reopens closed applications at screening", () => {
    expect(canMove("applied", "interview")).toBe(true);
    expect(canMove("interview", "hired")).toBe(false);
    expect(canMove("offer", "hired")).toBe(true);
    expect(canMove("rejected", "screening")).toBe(true);
    expect(canMove("rejected", "offer")).toBe(false);
    expect(canMove("hired", "screening")).toBe(false);
    expect(canMove("screening", "screening")).toBe(false);
  });
  it("counts whole days in a stage", () => {
    expect(daysSince("2026-11-01T10:00:00Z", new Date("2026-11-04T09:00:00Z"))).toBe(2);
  });
  it("rejects bot-filled or unconsented applications", () => {
    const ok = { name: "Riya Joshi", email: "riya@example.com", phone: "+91 98250 11111", consent: "yes" };
    expect(applySchema.safeParse(ok).success).toBe(true);
    expect(applySchema.safeParse({ ...ok, website: "x" }).success).toBe(false);
    expect(applySchema.safeParse({ ...ok, consent: "" }).success).toBe(false);
  });
});
