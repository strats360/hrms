import { describe, expect, it } from "vitest";
import { addWeeks, hoursLabel, parseHours, timesheetProblem, weekDates, weekStart } from "../src/timesheets";

describe("timesheets", () => {
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekDates("2026-11-09")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(addWeeks("2026-11-09", -1)).toBe("2026-11-02");
  });
  it("reads hours the way people type them", () => {
    expect(parseHours("7.5")).toBe(450);
    expect(parseHours("7:30")).toBe(450);
    expect(parseHours("7h30")).toBe(450);
    expect(parseHours("8h")).toBe(480);
    expect(parseHours("")).toBe(0);
    expect(parseHours("7:75")).toBeNull();
    expect(parseHours("lots")).toBeNull();
    expect(hoursLabel(450)).toBe("7h 30m");
    expect(hoursLabel(480)).toBe("8h");
  });
  it("checks a week before it's saved", () => {
    const dates = weekDates("2026-11-09");
    expect(timesheetProblem([{ projectId: "a", note: "", minutes: { "2026-11-09": 900 } }, { projectId: "b", note: "", minutes: { "2026-11-09": 600 } }], dates, false)).toMatch(/24 hours/);
    expect(timesheetProblem([{ projectId: "a", note: "", minutes: { "2026-11-20": 60 } }], dates, false)).toMatch(/outside/);
    expect(timesheetProblem([], dates, true)).toMatch(/Add some hours/);
    expect(timesheetProblem([{ projectId: "a", note: "", minutes: { "2026-11-09": 480 } }], dates, true)).toBeNull();
  });
});
