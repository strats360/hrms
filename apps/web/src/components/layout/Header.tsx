import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bell, LogOut, Menu as MenuIcon, Moon, Search, Sun } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/session";
import { CommandPalette } from "./CommandPalette";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button icon onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </Button>
  );
}

export interface Alert {
  label: string;
  to: string;
  count: number;
}

export function Header({ crumb, org, searchPlaceholder, onMenu, alerts = [], roleLabel, palette = true }: { crumb: string; org: string; searchPlaceholder: string; onMenu?: () => void; alerts?: Alert[]; roleLabel?: string | null; palette?: boolean }) {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const total = alerts.reduce((a, b) => a + b.count, 0);

  useEffect(() => {
    if (!palette) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [palette]);

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--color-divider)] px-4 py-3.5 sm:gap-4 sm:px-7" style={{ background: "color-mix(in srgb, var(--color-bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
      {onMenu ? (
        <Button icon className="lg:hidden" onClick={onMenu} aria-label="Open menu">
          <MenuIcon size={18} />
        </Button>
      ) : null}
      <div className="min-w-0">
        <div className="text-[12px]" style={{ color: "var(--muted)" }}>{crumb}</div>
        <div className="truncate text-[15px] font-semibold">{org}</div>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {palette ? (
          <button
            onClick={() => setOpen(true)}
            className="hidden h-9 min-w-[140px] max-w-[260px] flex-[1_1_160px] cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-divider)] bg-[var(--color-surface)] px-3.5 md:flex"
            style={{ color: "var(--muted)" }}
          >
            <Search size={16} />
            <span className="flex-1 truncate text-left text-[13px]">{searchPlaceholder}</span>
            <span className="rounded-md border border-[var(--color-divider)] px-1.5 text-[11px]">⌘K</span>
          </button>
        ) : null}
        <ThemeToggle />
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button icon className="relative" aria-label={`Notifications${total ? `: ${total} pending` : ""}`}>
              <Bell size={17} />
              {total ? <span className="absolute right-2 top-[7px] h-2 w-2 rounded-full" style={{ background: "var(--color-accent)" }} /> : null}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="card elev-md z-50 w-[280px] !p-2">
              <div className="px-2 py-1 text-[12px]" style={{ color: "var(--muted)" }}>Waiting on you</div>
              {alerts.filter((a) => a.count).length === 0 ? (
                <div className="text-muted px-2 py-3 text-[13px]">You're all caught up.</div>
              ) : (
                alerts
                  .filter((a) => a.count)
                  .map((a) => (
                    <Popover.Close asChild key={a.to}>
                      <Link to={a.to} className="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-2 text-[13px] no-underline hover:bg-[var(--tint-1)]" style={{ color: "var(--color-text)" }}>
                        {a.label}
                        <span className="tag tag-warn">{a.count}</span>
                      </Link>
                    </Popover.Close>
                  ))
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="flex items-center gap-2.5 pl-1.5">
          <Link to="/account/security" title="Sign-in and security" className="flex items-center gap-2.5 rounded-[var(--radius-md)] no-underline" style={{ color: "var(--color-text)" }}>
            <div className="hidden h-9 w-9 place-items-center rounded-full text-[13px] font-bold sm:grid" style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }}>
              {me?.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </div>
            <div className="hidden min-w-0 leading-tight sm:block">
              <div className="text-[13px] font-semibold">{me?.user.name}</div>
              <div className="text-[11.5px]" style={{ color: "var(--muted)" }}>{roleLabel}</div>
            </div>
          </Link>
          <Button icon onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </div>
      </div>
      {palette ? <CommandPalette open={open} onOpenChange={setOpen} onGo={(to) => nav(to)} /> : null}
    </header>
  );
}
