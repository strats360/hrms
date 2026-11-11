import { describe, expect, it } from "vitest";
import { inAudience, isLive } from "../src/announcements";

describe("announcements", () => {
  it("matches the audience", () => {
    const e = { departmentId: "eng", branchId: "ahd" };
    expect(inAudience({ departmentIds: [], branchIds: [] }, e)).toBe(true);
    expect(inAudience({ departmentIds: ["eng"], branchIds: [] }, e)).toBe(true);
    expect(inAudience({ departmentIds: ["hr"], branchIds: [] }, e)).toBe(false);
    expect(inAudience({ departmentIds: ["eng"], branchIds: ["bvn"] }, e)).toBe(false);
    expect(inAudience({ departmentIds: [], branchIds: ["ahd"] }, { departmentId: null, branchId: "ahd" })).toBe(true);
  });
  it("is live between publish time and end date", () => {
    const now = new Date("2026-11-11T10:00:00Z");
    expect(isLive({ status: "published", publishAt: "2026-11-11T09:00:00Z" }, now, "2026-11-11")).toBe(true);
    expect(isLive({ status: "published", publishAt: "2026-11-11T11:00:00Z" }, now, "2026-11-11")).toBe(false);
    expect(isLive({ status: "published", publishAt: "2026-11-01T09:00:00Z", expiresAt: "2026-11-10" }, now, "2026-11-11")).toBe(false);
    expect(isLive({ status: "draft", publishAt: "2026-11-01T09:00:00Z" }, now, "2026-11-11")).toBe(false);
  });
});
