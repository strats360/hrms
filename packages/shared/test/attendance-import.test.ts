import { describe, expect, it } from "vitest";
import { istDateOf, matchImportColumns, parseImportDate, parseImportStatus, parseImportTime, parsePunchTime } from "../src/attendance-import";

describe("attendance import parsing", () => {
  it("reads Indian and ISO dates", () => {
    expect(parseImportDate("2026-11-05")).toBe("2026-11-05");
    expect(parseImportDate("05-11-2026")).toBe("2026-11-05");
    expect(parseImportDate("5/11/2026")).toBe("2026-11-05");
    expect(parseImportDate("05.11.26")).toBe("2026-11-05");
    expect(parseImportDate("05-Nov-2026")).toBe("2026-11-05");
    expect(parseImportDate("5 November 2026")).toBe("2026-11-05");
    expect(parseImportDate("31-02-2026")).toBeNull();
    expect(parseImportDate("tomorrow")).toBeNull();
  });

  it("reads 12 and 24 hour times", () => {
    expect(parseImportTime("9:05")).toBe("09:05");
    expect(parseImportTime("0905")).toBe("09:05");
    expect(parseImportTime("09:05:41")).toBe("09:05");
    expect(parseImportTime("6:30 PM")).toBe("18:30");
    expect(parseImportTime("12:10 am")).toBe("00:10");
    expect(parseImportTime("9.15pm")).toBe("21:15");
    expect(parseImportTime("")).toBe("");
    expect(parseImportTime("--:--")).toBe("");
    expect(parseImportTime("25:00")).toBeNull();
    expect(parseImportTime("13:00 pm")).toBeNull();
  });

  it("reads status codes from attendance sheets", () => {
    expect(parseImportStatus("P")).toBe("present");
    expect(parseImportStatus("HD")).toBe("half_day");
    expect(parseImportStatus("WFH")).toBe("wfh");
    expect(parseImportStatus("W/O")).toBe("weekly_off");
    expect(parseImportStatus("on leave")).toBe("on_leave");
    expect(parseImportStatus("")).toBe("");
    expect(parseImportStatus("maybe")).toBeNull();
  });

  it("finds columns by their usual names", () => {
    expect(matchImportColumns(["Emp Code", "Date", "In Time", "Out Time", "Status", "Remarks"])).toEqual({ employee: 0, date: 1, checkIn: 2, checkOut: 3, status: 4, note: 5 });
    expect(matchImportColumns(["employee_id", "date"]).checkIn).toBe(-1);
  });

  it("takes device times without an offset as IST", () => {
    const d = parsePunchTime("2026-11-05 09:02:10")!;
    expect(d.toISOString()).toBe("2026-11-05T03:32:10.000Z");
    expect(parsePunchTime("2026-11-05T03:32:10Z")!.getTime()).toBe(d.getTime());
    expect(istDateOf(parsePunchTime("2026-11-05 23:50")!)).toBe("2026-11-05");
    expect(parsePunchTime("yesterday")).toBeNull();
  });
});
