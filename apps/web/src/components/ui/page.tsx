import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Spinner } from "./spinner";
import { Button } from "./button";
import { errorMessage } from "@/lib/api";

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="!mb-1 text-[28px] sm:text-[34px]">{title}</h1>
        {sub ? <div className="text-[14px]" style={{ color: "var(--muted-2)" }}>{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="text-muted flex items-center gap-2 py-10 text-[13px]" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 text-[13px]" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }} role="alert">
      <AlertTriangle size={16} />
      <span>{errorMessage(error)}</span>
      {retry ? (
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Empty({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-10">
      <div className="font-medium">{title}</div>
      {sub ? <div className="text-muted text-[13px]">{sub}</div> : null}
      {action}
    </div>
  );
}

export function Notice({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad" | "sel"; children: ReactNode }) {
  const bg = tone === "sel" ? "var(--sel-bg)" : `var(--${tone}-bg)`;
  const fg = tone === "sel" ? "var(--color-text)" : `var(--${tone}-fg)`;
  return (
    <div className="rounded-[var(--radius-md)] px-3.5 py-3 text-[13px]" style={{ background: bg, color: fg }}>
      {children}
    </div>
  );
}

export function KV({ label, children, span }: { label: ReactNode; children: ReactNode; span?: boolean }) {
  return (
    <div className={span ? "col-span-full min-w-0" : "min-w-0"}>
      <div className="text-muted text-[12px]">{label}</div>
      <div className="break-words">{children ?? "—"}</div>
    </div>
  );
}
