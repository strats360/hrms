import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Lookups } from "@/lib/types";

export function useLookups() {
  return useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
}

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayOf(iso: string) {
  return new Date(iso + "T00:00:00Z").getUTCDay();
}

export function minsLabel(m: number) {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

export const SOURCE_LABELS: Record<string, string> = {
  web: "Web",
  mobile: "Mobile",
  biometric: "Biometric",
  gps: "GPS",
  ip: "Office IP",
  wfh: "WFH",
  manual: "Manual",
  import: "Import",
};
