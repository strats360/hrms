import { describe, expect, it } from "vitest";
import { erasureBlocker } from "../src/privacy";

describe("erasureBlocker", () => {
  const left = { status: "exited", lastWorkingDay: "2026-07-15" };
  it("allows erasure once someone has left and everything is settled", () => {
    expect(erasureBlocker(left, "2026-11-11")).toBeNull();
    expect(erasureBlocker({ status: "inactive", lastWorkingDay: null }, "2026-11-11")).toBeNull();
  });
  it("says why it has to wait", () => {
    expect(erasureBlocker({ status: "active", lastWorkingDay: null }, "2026-11-11")).toMatch(/still work here/);
    expect(erasureBlocker({ status: "notice", lastWorkingDay: "2026-12-01" }, "2026-11-11")).toMatch(/still work here/);
    expect(erasureBlocker({ status: "exited", lastWorkingDay: "2026-12-01" }, "2026-11-11")).toMatch(/last working day/);
    expect(erasureBlocker(left, "2026-11-11", 0, true)).toMatch(/full and final/);
    expect(erasureBlocker(left, "2026-11-11", 1)).toMatch(/loan/);
    expect(erasureBlocker({ ...left, erasedAt: new Date() }, "2026-11-11")).toMatch(/already been erased/);
  });
});
