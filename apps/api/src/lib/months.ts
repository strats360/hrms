/** "2026-11" -> "November 2026" */
export function monthLabel(month: string) {
  return new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
