import { useEffect } from "react";
import { Navigate, NavLink, Outlet } from "react-router";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { queuedPunches, sendQueuedPunches } from "@/lib/offline";
import { useOnline } from "@/lib/pwa";
import { CalendarDays, Clock, Home, LayoutDashboard, LogOut, Percent, ShieldCheck, Receipt, User, Wallet } from "lucide-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./Header";
import { Brand } from "./Sidebar";

const TABS = [
  { to: "/me", label: "Home", icon: Home, end: true },
  { to: "/me/attendance", label: "Attendance", icon: Clock },
  { to: "/me/leave", label: "Leave", icon: CalendarDays },
  { to: "/me/payslips", label: "Payslips", icon: Wallet },
  { to: "/me/tax", label: "Tax", icon: Percent, feature: "module.tds" },
  { to: "/me/claims", label: "Claims", icon: Receipt, feature: "module.reimbursements" },
  { to: "/me/profile", label: "Profile", icon: User },
];

/** Employee self-service: top bar on desktop, bottom tab bar on phones. */
export function EssLayout() {
  const { tenant, me, signOut, has } = useSession();
  const tabs = TABS.filter((t) => !("feature" in t) || has((t as { feature: string }).feature));
  const online = useOnline();
  const eid = tenant?.employeeId ?? null;
  // send punches saved offline as soon as there's a connection
  useEffect(() => {
    if (!online || !eid || !queuedPunches(eid).length) return;
    void sendQueuedPunches(eid).then((r) => {
      if (r.sent) toast.success(`${r.sent} punch${r.sent === 1 ? "" : "es"} saved offline ${r.sent === 1 ? "was" : "were"} sent`);
      for (const f of r.failed) toast.error(`A punch saved offline wasn't accepted: ${f}`);
    });
  }, [online, eid]);
  if (!tenant?.employeeId) return <Navigate to={tenant?.roleId ? "/" : "/login"} replace />;
  return (
    <div className="min-h-screen pb-20 md:pb-10" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="sticky top-0 z-10 border-b border-[var(--color-divider)]" style={{ paddingTop: "env(safe-area-inset-top)", background: "color-mix(in srgb, var(--color-bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-2.5">
          <div className="-mb-[18px]">
            <Brand subtitle={tenant.tenantName} />
          </div>
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Self-service">
            {tabs.map((t) => (
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
            <NavLink to="/account/security" className="btn btn-secondary btn-icon" aria-label="Your account" title="Your account: sign-in, security and email settings">
              <ShieldCheck size={17} />
            </NavLink>
            <span className="hidden text-[13px] font-medium sm:inline">{me?.user.name}</span>
            <Button icon onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </Button>
          </div>
        </div>
      </header>
      {!online ? (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }} role="status">
          <WifiOff size={14} /> You're offline. Punches are saved on this phone and sent when you reconnect.
        </div>
      ) : null}
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid border-t border-[var(--color-divider)] md:hidden" aria-label="Self-service" style={{ background: "var(--color-surface)", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10.5px] no-underline" style={({ isActive }) => ({ color: isActive ? "var(--sel-fg)" : "var(--muted)" })}>
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
