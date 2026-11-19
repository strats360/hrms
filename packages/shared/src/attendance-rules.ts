import type { AttendanceStatus } from "./constants";
import { localMinutes } from "./format";

export interface ShiftRule {
  startTime: string; // HH:MM IST
  endTime: string; // HH:MM IST
  graceMinutes: number;
  halfDayMinutes: number; // minimum worked minutes for a half day
  fullDayMinutes: number; // minimum worked minutes for a full day
}

export const DEFAULT_SHIFT: ShiftRule = {
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
};

export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export interface AttendanceEvaluation {
  status: AttendanceStatus;
  workMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
}

/**
 * Derive the attendance status for one day from punches and the employee's shift.
 * - Arrival after start + grace is late.
 * - Once checked out: below the half-day threshold is absent, below full-day is a half day.
 * - Overtime is time worked beyond the scheduled shift length, counted in 30 minute blocks.
 */
export function evaluateAttendance(
  shift: ShiftRule,
  checkIn: Date | null,
  checkOut: Date | null,
  /** timeZone: the employee's zone (their entity's), for reading shift times. Defaults to the site's. */
  opts: { wfh?: boolean; timeZone?: string } = {},
): AttendanceEvaluation {
  if (!checkIn) {
    return { status: "absent", workMinutes: 0, lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0 };
  }
  const start = hhmmToMinutes(shift.startTime);
  let end = hhmmToMinutes(shift.endTime);
  if (end <= start) end += 24 * 60; // overnight shift
  const inMin = localMinutes(checkIn, opts.timeZone);
  const lateMinutes = Math.max(0, inMin - start - shift.graceMinutes) > 0 ? inMin - start : 0;

  if (!checkOut) {
    return {
      status: opts.wfh ? "wfh" : lateMinutes > 0 ? "late" : "present",
      workMinutes: 0,
      lateMinutes,
      earlyMinutes: 0,
      overtimeMinutes: 0,
    };
  }

  const workMinutes = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000));
  let outMin = localMinutes(checkOut, opts.timeZone);
  if (outMin < inMin) outMin += 24 * 60;
  const earlyMinutes = Math.max(0, end - outMin);
  const scheduled = end - start;
  const extra = workMinutes - scheduled;
  const overtimeMinutes = extra >= 30 ? Math.floor(extra / 30) * 30 : 0;

  let status: AttendanceStatus;
  if (workMinutes < shift.halfDayMinutes) status = "absent";
  else if (workMinutes < shift.fullDayMinutes) status = "half_day";
  else if (opts.wfh) status = "wfh";
  else status = lateMinutes > 0 ? "late" : "present";

  return { status, workMinutes, lateMinutes, earlyMinutes, overtimeMinutes };
}

/** Paid-day weight of a status for payroll: present=1, half=0.5, absent=0. */
export function paidDayWeight(status: AttendanceStatus, leaveIsPaid = true): number {
  switch (status) {
    case "absent":
      return 0;
    case "half_day":
      return 0.5;
    case "on_leave":
      return leaveIsPaid ? 1 : 0;
    default:
      return 1;
  }
}
