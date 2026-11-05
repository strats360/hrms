import { useState } from "react";
import { NavLink } from "react-router";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Smartphone, LayoutDashboard } from "lucide-react";
import type { NavGroup } from "./nav";
import { cn } from "@/lib/utils";

function loadGroups(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("navGroups") ?? "{}");
  } catch {
    return {};
  }
}

export function Brand({ collapsed, subtitle }: { collapsed?: boolean; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-[18px] pt-1">
      <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[var(--radius-md)] text-[17px] font-semibold" style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}>
        S
      </div>
      {!collapsed ? (
        <div className="min-w-0 leading-tight">
          <div className="whitespace-nowrap text-[17px] font-medium">Strats360 People</div>
          {subtitle ? <div className="text-[10.5px] uppercase tracking-[0.1em]" style={{ color: "var(--sel-fg)" }}>{subtitle}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  groups,
  collapsed,
  onToggleCollapse,
  badges,
  footer,
  subtitle,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  onToggleCollapse?: () => void;
  badges?: Record<string, number>;
  footer?: { to: string; label: string; kind: "ess" | "admin" } | null;
  subtitle?: string;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(loadGroups);
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = { ...s, [k]: !(s[k] ?? true) };
      try {
        localStorage.setItem("navGroups", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <aside
      className="scroll-thin sticky top-0 flex h-screen flex-none flex-col overflow-y-auto overflow-x-hidden border-r border-[var(--color-divider)] px-3 py-[18px] transition-[width] duration-200"
      style={{ width: collapsed ? 72 : 244, background: "var(--color-bg)" }}
      aria-label="Main navigation"
    >
      <Brand collapsed={collapsed} subtitle={subtitle} />
      {groups.map((g) => {
        const isOpen = (open[g.key] ?? true) || collapsed;
        return (
          <div key={g.key} className="mb-2">
            {!collapsed ? (
              <button
                onClick={() => toggle(g.key)}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.1em]"
                style={{ color: "var(--muted)" }}
              >
                <span className="truncate">{g.label}</span>
                <ChevronDown size={14} style={{ transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
              </button>
            ) : null}
            {isOpen ? (
              <div className="flex flex-col gap-0.5">
                {g.items.map((it) => {
                  const badge = it.badgeKey ? badges?.[it.badgeKey] : undefined;
                  return (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === "/" || it.to === "/platform" || it.to === "/me"}
                      title={it.label}
                      onClick={onNavigate}
                      className={({ isActive }) => cn("flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[9px] text-[14px] no-underline hover:bg-[var(--tint-1)]", isActive && "!bg-[var(--sel-bg)] font-semibold")}
                      style={({ isActive }) => ({ color: isActive ? "var(--sel-fg)" : "var(--color-text)" })}
                    >
                      <it.icon size={18} className="flex-none" strokeWidth={2} />
                      {!collapsed ? <span className="flex-1 whitespace-nowrap">{it.label}</span> : null}
                      {!collapsed && it.soon ? <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>Soon</span> : null}
                      {!collapsed && badge ? (
                        <span className="rounded-[var(--radius-md)] px-[7px] py-px text-[11px]" style={{ background: "var(--sel-bg)", color: "var(--sel-fg)", boxShadow: "inset 0 0 0 1px var(--color-accent)" }}>
                          {badge}
                        </span>
                      ) : null}
                    </NavLink>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="mt-auto flex flex-col gap-0.5">
        {footer ? (
          <NavLink to={footer.to} onClick={onNavigate} className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-[9px] text-[14px] no-underline" style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }} title={footer.label}>
            {footer.kind === "ess" ? <Smartphone size={18} /> : <LayoutDashboard size={18} />}
            {!collapsed ? <span className="whitespace-nowrap">{footer.label}</span> : null}
          </NavLink>
        ) : null}
        {onToggleCollapse ? (
          <button onClick={onToggleCollapse} className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] border-0 bg-transparent px-2.5 py-[9px] text-[13px] hover:bg-[var(--tint-1)]" style={{ color: "var(--muted-2)" }}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed ? <span>Collapse</span> : null}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
