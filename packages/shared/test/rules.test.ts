import { describe, expect, it } from "vitest";
import {
  accruedLeave,
  can,
  countLeaveDays,
  decryptField,
  DEFAULT_ROLES,
  DEFAULT_SHIFT,
  encryptField,
  evaluateAttendance,
  financialYear,
  fmtDate,
  inr,
  inrCompact,
  sanitizeMatrix,
  todayIST,
} from "../src";

// 09:00 IST == 03:30 UTC
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe("attendance rules", () => {
  it("marks on-time full day as present", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "09:05"), ist("2026-11-05", "18:10"));
    expect(r.status).toBe("present");
    expect(r.lateMinutes).toBe(0);
    expect(r.workMinutes).toBe(545);
  });
  it("marks arrival after grace as late", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "10:24"), null);
    expect(r.status).toBe("late");
    expect(r.lateMinutes).toBe(84);
  });
  it("marks short day as half day and early departure", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "09:05"), ist("2026-11-05", "13:30"));
    expect(r.status).toBe("half_day");
    expect(r.earlyMinutes).toBe(270);
  });
  it("marks very short day as absent", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "09:00"), ist("2026-11-05", "11:00"));
    expect(r.status).toBe("absent");
  });
  it("counts overtime in 30 minute blocks", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "09:00"), ist("2026-11-05", "19:45"));
    expect(r.overtimeMinutes).toBe(90);
  });
  it("keeps WFH status", () => {
    const r = evaluateAttendance(DEFAULT_SHIFT, ist("2026-11-05", "09:00"), ist("2026-11-05", "18:00"), { wfh: true });
    expect(r.status).toBe("wfh");
  });
});

describe("leave rules", () => {
  it("skips weekends and holidays", () => {
    // 2026-11-09 Mon .. 2026-11-15 Sun, holiday on 10th
    expect(countLeaveDays("2026-11-09", "2026-11-15", { holidays: ["2026-11-10"] })).toBe(4);
  });
  it("half day counts as 0.5", () => {
    expect(countLeaveDays("2026-11-09", "2026-11-09", { halfDay: true })).toBe(0.5);
  });
  it("accrues monthly", () => {
    expect(accruedLeave({ annualQuota: 18, accrual: "monthly" }, 2026, "2026-11-05")).toBe(16.5);
  });
  it("prorates yearly quota for joiners", () => {
    expect(accruedLeave({ annualQuota: 12, accrual: "yearly" }, 2026, "2026-11-05", "2026-09-01")).toBe(4);
    expect(accruedLeave({ annualQuota: 12, accrual: "yearly" }, 2026, "2026-11-05", "2026-09-20")).toBe(3);
  });
});

describe("permissions", () => {
  it("super admin can do everything", () => {
    expect(can(DEFAULT_ROLES[0]!.permissions, "payroll", "configure")).toBe(true);
  });
  it("manager cannot edit payroll", () => {
    const mgr = DEFAULT_ROLES.find((r) => r.key === "manager")!;
    expect(can(mgr.permissions, "payroll", "view")).toBe(false);
    expect(can(mgr.permissions, "leave", "approve")).toBe(true);
  });
  it("sanitizes unknown modules and actions", () => {
    expect(sanitizeMatrix({ leave: ["view", "hack"], nope: ["view"] })).toEqual({ leave: ["view"] });
  });
});

describe("format", () => {
  it("formats INR in Indian grouping", () => {
    expect(inr(14236480)).toBe("₹1,42,36,480");
    expect(inrCompact(14236480)).toBe("₹1.42 Cr");
    expect(inrCompact(1440000)).toBe("₹14.40 L");
  });
  it("formats dates", () => {
    expect(fmtDate("2026-11-05")).toBe("05 Nov 2026");
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });
  it("uses IST for today", () => {
    expect(todayIST(new Date("2026-11-04T19:00:00Z"))).toBe("2026-11-05");
  });
});

describe("field encryption", () => {
  it("round-trips", async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const c = await encryptField("50100234567812", key);
    expect(c.startsWith("v1:")).toBe(true);
    expect(await decryptField(c, key)).toBe("50100234567812");
  });
});
