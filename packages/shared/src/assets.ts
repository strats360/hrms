import { z } from "zod";

/** Company assets: the register, who holds what, and returns. */
export const ASSET_CATEGORIES = ["laptop", "desktop", "monitor", "phone", "tablet", "sim", "id_card", "access_card", "headset", "vehicle", "furniture", "other"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  laptop: "Laptop",
  desktop: "Desktop",
  monitor: "Monitor",
  phone: "Phone",
  tablet: "Tablet",
  sim: "SIM card",
  id_card: "ID card",
  access_card: "Access card",
  headset: "Headset",
  vehicle: "Vehicle",
  furniture: "Furniture",
  other: "Other",
};

export const ASSET_STATUSES = ["available", "assigned", "in_repair", "retired", "lost"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = { available: "Available", assigned: "Assigned", in_repair: "In repair", retired: "Retired", lost: "Lost" };

export const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = { new: "New", good: "Good", fair: "Fair", poor: "Poor", damaged: "Damaged" };

/** Warranty state for the register: expired, ending within 30 days, or fine. */
export function warrantyState(until: string | null | undefined, today: string) {
  if (!until) return null;
  if (until < today) return "expired" as const;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 30 ? ("ending" as const) : ("ok" as const);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const assetSchema = z.object({
  tag: z.string().trim().max(40).default(""),
  name: z.string().trim().min(2, "Name it, e.g. Dell Latitude 5440").max(120),
  category: z.enum(ASSET_CATEGORIES),
  serialNumber: z.string().trim().max(80).nullable().default(null),
  purchaseDate: isoDate.nullable().default(null),
  purchaseCost: z.number().min(0).max(1e9).nullable().default(null),
  vendor: z.string().trim().max(120).nullable().default(null),
  invoiceNumber: z.string().trim().max(60).nullable().default(null),
  warrantyUntil: isoDate.nullable().default(null),
  branchId: z.string().nullable().default(null),
  condition: z.enum(CONDITIONS).default("good"),
  notes: z.string().trim().max(2000).default(""),
});
export const assignSchema = z.object({
  employeeId: z.string(),
  date: isoDate,
  condition: z.enum(CONDITIONS).default("good"),
  expectedReturn: isoDate.nullable().default(null),
  note: z.string().trim().max(1000).default(""),
});
export const returnSchema = z.object({
  date: isoDate,
  condition: z.enum(CONDITIONS),
  /** Where it goes next. */
  status: z.enum(["available", "in_repair", "retired", "lost"]).default("available"),
  note: z.string().trim().max(1000).default(""),
});
export const assetStatusSchema = z.object({ status: z.enum(["available", "in_repair", "retired", "lost"]), note: z.string().trim().max(1000).default("") });
export const reportIssueSchema = z.object({ kind: z.enum(["damaged", "lost", "not_received", "other"]), note: z.string().trim().min(5, "Tell HR what happened").max(1000) });
export const ISSUE_LABEL = { damaged: "Damaged", lost: "Lost or stolen", not_received: "Haven't received it", other: "Something else" } as const;
