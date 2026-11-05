import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, elev, padded = true, ...p }: HTMLAttributes<HTMLDivElement> & { elev?: "sm" | "md" | "lg"; padded?: boolean }) {
  return <div className={cn("card min-w-0", elev && `elev-${elev}`, padded && "!p-[22px]", className)} {...p} />;
}

export function CardHeader({ title, sub, actions, icon, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <div className="card-title text-[17px]">{title}</div>
        </div>
        {sub ? <div className="text-muted mt-0.5 text-[13px]">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** KPI tile used across dashboards. */
export function StatCard({ label, value, meta, onClick, className }: { label: ReactNode; value: ReactNode; meta?: ReactNode; onClick?: () => void; className?: string }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn("card min-w-0 border-0 text-left text-[var(--color-text)]", onClick && "cursor-pointer hover:shadow-[var(--shadow-sm)]", className)}
      style={{ padding: "14px 16px", font: "inherit" }}
    >
      <div className="card-kicker">{label}</div>
      <div className="stat-value">{value}</div>
      {meta ? <div className="card-meta">{meta}</div> : null}
    </Comp>
  );
}

/** Table wrapper card used by every list screen. */
export function TableCard({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card min-w-0 bg-[var(--color-surface)] !px-4 !pb-4 !pt-2", className)} {...p} />;
}
