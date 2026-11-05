import type { ReactNode } from "react";
import { inr } from "@hrms/shared";
import type { PayrollRun, RunTotals } from "@/lib/types";
import { Tag, type Tone } from "@/components/ui/tag";

export const STEPS = ["Payroll month", "Fetch inputs", "Attendance & LOP", "Calculate", "Review", "Approve & lock", "Payslips & bank file"];

/** Furthest step a run can be on, by status. */
export const MAX_STEP: Record<string, number> = { draft: 4, calculated: 6, approved: 7, paid: 7 };
/** Step to open on first load, by status. */
export const START_STEP: Record<string, number> = { draft: 2, calculated: 5, approved: 7, paid: 7 };
/** Steps considered complete, by status. */
export const DONE_UPTO: Record<string, number> = { draft: 1, calculated: 4, approved: 6, paid: 7 };

export const isLocked = (r: PayrollRun) => r.status === "approved" || r.status === "paid";

export function Row({ title, sub, tag, tone = "ok", children }: { title: ReactNode; sub?: ReactNode; tag?: ReactNode; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] px-3.5 py-3" style={{ background: "var(--tint-1)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {sub ? <div className="text-muted text-[12.5px]">{sub}</div> : null}
        </div>
        {tag ? <Tag tone={tone}>{tag}</Tag> : null}
      </div>
      {children}
    </div>
  );
}

export function Money({ label, value, meta, accent }: { label: string; value: number; meta?: ReactNode; accent?: boolean }) {
  return (
    <div className="card min-w-0 !gap-1 !px-4 !py-3.5" style={accent ? { background: "var(--ok-bg)", color: "var(--ok-fg)" } : { background: "var(--tint-1)" }}>
      <div className="card-kicker" style={accent ? { color: "var(--ok-fg)" } : undefined}>{label}</div>
      <div className="num text-[22px] font-medium tracking-tight">{inr(value)}</div>
      {meta ? <div className="card-meta" style={accent ? { color: "var(--ok-fg)" } : undefined}>{meta}</div> : null}
    </div>
  );
}

export function pctChange(now: number, before: number | undefined | null) {
  if (!before) return null;
  const p = ((now - before) / before) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}% vs last month`;
}

export function statutoryOutflow(t: RunTotals) {
  return t.pfEmployee + t.pfEmployer + t.esiEmployee + t.esiEmployer + t.pt + t.lwf + t.tds;
}

export function names(list: { name: string }[], max = 4) {
  if (!list.length) return "None";
  const shown = list.slice(0, max).map((x) => x.name).join(", ");
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}
