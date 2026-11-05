import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "bad" | "neutral" | "accent" | "outline";

export function Tag({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("tag", `tag-${tone}`, className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  active: "ok",
  approved: "ok",
  present: "ok",
  verified: "ok",
  paid: "ok",
  wfh: "accent",
  probation: "neutral",
  onboarding: "accent",
  invited: "neutral",
  opened: "neutral",
  in_progress: "accent",
  submitted: "warn",
  pending: "warn",
  late: "warn",
  half_day: "warn",
  notice: "warn",
  not_marked: "neutral",
  on_leave: "neutral",
  holiday: "neutral",
  weekly_off: "neutral",
  trial: "accent",
  past_due: "warn",
  rejected: "bad",
  absent: "bad",
  inactive: "bad",
  exited: "bad",
  expired: "bad",
  suspended: "bad",
  disabled: "bad",
  cancelled: "neutral",
};

const LABELS: Record<string, string> = {
  in_progress: "In progress",
  submitted: "Awaiting verification",
  half_day: "Half day",
  not_marked: "Not marked",
  on_leave: "On leave",
  weekly_off: "Weekly off",
  wfh: "WFH",
  notice: "Notice period",
  past_due: "Past due",
};

export const statusLabel = (s: string) => LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export function StatusTag({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Tag tone={STATUS_TONE[status] ?? "neutral"}>{label ?? statusLabel(status)}</Tag>;
}
