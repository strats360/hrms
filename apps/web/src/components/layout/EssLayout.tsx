import { Navigate, NavLink, Outlet } from "react-router";
import { CalendarDays, Clock, Home, LayoutDashboard, LogOut, Percent, User, Wallet } from "lucide-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./Header";
import { Brand } from "./Sidebar";

const TABS = [
  { to: "/me", label: "Home", icon: Home, end: true },
  { to: "/me/attendance", label: "Attendance", icon: Clock },
  { to: "/me/leave", label: "Leave", icon: CalendarDays },
  { to: "/me/payslips", label: "Payslips", icon: Wallet },
  { to: "/me/tax", label: "Tax", icon: Percent },
  { to: "/me/profile", label: "Profile", icon: User },
];

/** Employee self-service: top bar on desktop, bottom tab bar on phones. */
export function EssLayout() {
  const { tenant, me, signOut } = useSession();
  if (!tenant?.employeeId) return <Navigate to={tenant?.roleId ? "/" : "/login"} replace />;
  return (
    <div className="min-h-screen pb-20 md:pb-10" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="sticky top-0 z-10 border-b border-[var(--color-divider)]" style={{ background: "color-mix(in srgb, var(--color-bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-2.5">
          <div className="-mb-[18px]">
            <Brand subtitle={tenant.tenantName} />
          </div>
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Self-service">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className="rounded-[var(--radius-md)] px-3 py-2 text-[14px] no-underline hover:bg-[var(--tint-1)]" style={({ isActive }) => ({ background: isActive ? "var(--sel-bg)" : undefined, color: isActive ? "var(--sel-fg)" : "var(--color-text)", fontWeight: isActive ? 600 : 400 })}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {tenant.roleId ? (
              <NavLink to="/" className="btn btn-secondary hidden !text-[13px] sm:inline-flex">
                <LayoutDashboard size={15} /> Admin console
              </NavLink>
            ) : null}
            <ThemeToggle />
            <span className="hidden text-[13px] font-medium sm:inline">{me?.user.name}</span>
            <Button icon onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-[var(--color-divider)] md:hidden" style={{ background: "var(--color-surface)" }} aria-label="Self-service">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="flex flex-col items-center gap-0.5 py-2 text-[11px] no-underline" style={({ isActive }) => ({ color: isActive ? "var(--sel-fg)" : "var(--muted)" })}>
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
