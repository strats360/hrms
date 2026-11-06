import { useSearchParams } from "react-router";
import { todayIST } from "@hrms/shared";

export function currentFy() {
  const [y, m] = todayIST().split("-").map(Number) as [number, number];
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}

export function fyOptions() {
  const s = Number(currentFy().slice(0, 4));
  return [s, s - 1, s - 2].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}

/** FY from ?fy=, defaulting to the current FY. */
export function useFy() {
  const [params] = useSearchParams();
  return params.get("fy") ?? currentFy();
}

export const DECL_STATUS_LABEL: Record<string, string> = { not_started: "Not started", draft: "Draft", submitted: "Submitted", verified: "Verified" };
export const DECL_STATUS_TONE: Record<string, "ok" | "warn" | "neutral" | "accent"> = { not_started: "neutral", draft: "neutral", submitted: "warn", verified: "ok" };
