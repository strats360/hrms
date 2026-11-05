import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hoursMinutes(mins: number) {
  if (!mins) return "—";
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}
