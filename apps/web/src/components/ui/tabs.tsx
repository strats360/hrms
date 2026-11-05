import { NavLink } from "react-router";
import type { ReactNode } from "react";

/** Underline page tabs. Each tab is a route. */
export function RouteTabs({ tabs }: { tabs: { to: string; label: ReactNode; end?: boolean }[] }) {
  return (
    <nav className="scroll-thin flex gap-1 overflow-x-auto overflow-y-hidden border-b border-[var(--color-divider)]" aria-label="Sections">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className="-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[14px] no-underline"
          style={({ isActive }) => ({
            color: isActive ? "var(--sel-fg)" : "var(--muted-2)",
            fontWeight: isActive ? 600 : 400,
            borderColor: isActive ? "var(--color-accent)" : "transparent",
          })}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Pill tabs inside a card (employee profile). */
export function PillTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-[var(--radius-md)] bg-[var(--color-surface)] p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className="cursor-pointer rounded-[var(--radius-md)] border-0 px-4 py-[7px] text-[13px]"
          style={{ background: value === t.value ? "var(--sel-bg)" : "transparent", color: value === t.value ? "var(--sel-fg)" : "var(--color-text)" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
