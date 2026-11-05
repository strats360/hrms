import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/Header";

/** Brand mark used on public and full-page screens. */
export function BrandMark({ size = 34, name = "Strats360 People" }: { size?: number; name?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid flex-none place-items-center rounded-[var(--radius-md)] font-semibold" style={{ width: size, height: size, background: "var(--color-accent)", color: "var(--color-bg)", fontSize: size * 0.45 }}>
        {name.charAt(0)}
      </div>
      <div className="text-[17px] font-medium">{name}</div>
    </div>
  );
}

/** Centered single-column public page with a theme toggle. */
export function CenteredPage({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="relative min-h-screen px-4 py-8" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mx-auto flex flex-col gap-4" style={{ width: `min(${width}px, 100%)` }}>
        {children}
      </div>
    </div>
  );
}

export interface RailStep {
  label: string;
  hint?: string;
  state: "done" | "current" | "todo";
  onClick?: () => void;
}

/** Left step rail from the company onboarding design. */
export function StepRail({ steps }: { steps: RailStep[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      {steps.map((s, i) => (
        <button
          key={s.label}
          type="button"
          onClick={s.onClick}
          disabled={!s.onClick}
          className="flex items-center gap-2.5 rounded-[var(--radius-md)] border-0 px-2.5 py-2 text-left text-[13.5px] disabled:cursor-default"
          style={{ background: s.state === "current" ? "var(--sel-bg)" : "transparent", color: "var(--color-text)", cursor: s.onClick ? "pointer" : "default" }}
          aria-current={s.state === "current" ? "step" : undefined}
        >
          <span
            className="grid h-6 w-6 flex-none place-items-center rounded-full text-[11.5px] font-semibold"
            style={{
              background: s.state === "done" ? "var(--ok-bg)" : s.state === "current" ? "var(--color-accent)" : "var(--tint-2)",
              color: s.state === "done" ? "var(--ok-fg)" : s.state === "current" ? "var(--color-bg)" : "var(--color-text)",
            }}
          >
            {s.state === "done" ? "✓" : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block" style={{ fontWeight: s.state === "current" ? 600 : 400 }}>{s.label}</span>
            {s.hint ? <span className="text-muted block text-[12px]">{s.hint}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Two-panel wizard frame: left rail + right content (company signup / setup). */
export function WizardFrame({ rail, children, footnote }: { rail: ReactNode; children: ReactNode; footnote?: ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-[minmax(260px,340px)_1fr]" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="flex flex-col gap-6 p-6 md:p-8" style={{ background: "var(--color-surface)" }}>
        <div className="flex items-center justify-between">
          <BrandMark />
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </div>
        {rail}
        {footnote ? <div className="text-muted mt-auto text-[12.5px]">{footnote}</div> : null}
      </div>
      <div className="relative w-full max-w-[860px] px-4 py-8 sm:px-12 sm:py-10">
        <div className="absolute right-4 top-4 hidden md:block">
          <ThemeToggle />
        </div>
        <div className="flex flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

export const COMPANY_STEPS = [
  { label: "Account", hint: "Email and password" },
  { label: "Company details", hint: "GSTIN, PAN, address" },
  { label: "Statutory", hint: "PF, ESI, PT, LWF, TDS" },
  { label: "Branches & payroll", hint: "Pay cycle and policies" },
  { label: "Import employees", hint: "Excel or invite" },
  { label: "Invite admins & go live", hint: "Checklist" },
];
