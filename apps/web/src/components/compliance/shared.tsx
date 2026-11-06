import type { Obligation } from "@/lib/types";
import { Tag } from "@/components/ui/tag";

export function dueText(o: Pick<Obligation, "status" | "daysLeft">) {
  if (o.status === "paid") return "Paid";
  if (o.daysLeft < 0) return `${-o.daysLeft} day${o.daysLeft === -1 ? "" : "s"} overdue`;
  if (o.daysLeft === 0) return "Due today";
  return `${o.daysLeft} day${o.daysLeft === 1 ? "" : "s"}`;
}

export function ObligationTag({ o }: { o: Pick<Obligation, "status" | "daysLeft"> }) {
  const tone = o.status === "paid" ? "ok" : o.status === "overdue" ? "bad" : o.status === "due_soon" ? "warn" : "neutral";
  return <Tag tone={tone}>{dueText(o)}</Tag>;
}
