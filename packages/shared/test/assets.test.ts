import { describe, expect, it } from "vitest";
import { warrantyState } from "../src/assets";

describe("warrantyState", () => {
  it("flags warranties ending within 30 days", () => {
    expect(warrantyState(null, "2026-11-11")).toBeNull();
    expect(warrantyState("2026-11-10", "2026-11-11")).toBe("expired");
    expect(warrantyState("2026-12-11", "2026-11-11")).toBe("ending");
    expect(warrantyState("2026-12-12", "2026-11-11")).toBe("ok");
  });
});
