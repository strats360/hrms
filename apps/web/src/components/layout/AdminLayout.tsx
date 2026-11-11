import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import * as D from "@radix-ui/react-dialog";
import { api, setActiveTenant } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { ADMIN_NAV, type NavGroup } from "./nav";

interface DashboardBadges {
  pendingLeaveCount: number;
  pendingCorrections: number;
  pendingClaimCount?: number;
  awaitingVerification: number;
  probationDue?: number;
}

function useCollapsed(key: string) {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return [
    v,
    () =>
      setV((x) => {
        try {
          localStorage.setItem(key, x ? "0" : "1");
        } catch {
          /* ignore */
        }
        return !x;
      }),
  ] as const;
}

/** Breadcrumb from the first two path segments. */
export function crumbFor(path: string, groups: NavGroup[]) {
  const items = groups.flatMap((g) => g.items);
  const seg = path.split("/").filter(Boolean);
  const base = items.find((i) => i.to !== "/" && path.startsWith(i.to)) ?? items[0];
  const ID_LABEL: Record<string, string> = { "/employees": "Profile", "/performance": "Cycle", "/assets": "Asset", "/helpdesk": "Ticket" };
  if (base?.to === "/recruitment" && seg[1]) return `Recruitment / ${seg[1] === "jobs" ? "Job" : seg[2] ? "Candidate" : "Candidates"}`;
  const sub = seg[1] === "reviews" && base?.to === "/performance" ? "Review" : seg[1] && !/^[0-9a-f-]{36}$/.test(seg[1]) ? seg[1].replace(/-/g, " ") : seg[1] ? (ID_LABEL[base?.to ?? ""] ?? "Details") : "";
  return base ? base.label + (sub ? " / " + sub.charAt(0).toUpperCase() + sub.slice(1) : "") : "";
}

export function AdminLayout() {
  const { tenant, can, has, isEmployee } = useSession();
  const loc = useLocation();
  const [collapsed, toggle] = useCollapsed("sidebarCollapsed");
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);

  const badges = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardBadges>("/admin/dashboard"),
    enabled: !!tenant?.roleId,
    staleTime: 30_000,
  });

  if (!tenant?.roleId) return <Navigate to={isEmployee ? "/me" : "/login"} replace />;
  if (!tenant.setupComplete && can("settings", "configure") && !sessionStorageGet("skipSetup") && loc.pathname !== "/setup") return <Navigate to="/setup" replace />;

  const groups = ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => (!i.perm || can(i.perm[0], i.perm[1])) && (!i.feature || has(i.feature))) })).filter((g) => g.items.length);
  const b = badges.data;
  const sidebarProps = {
    groups,
    badges: { leave: b?.pendingLeaveCount ?? 0, corrections: b?.pendingCorrections ?? 0, claims: b?.pendingClaimCount ?? 0 },
    footer: isEmployee ? { to: "/me", label: "Employee self-service", kind: "ess" as const } : null,
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="hidden lg:block">
        <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapse={toggle} />
      </div>
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className="dialog-backdrop lg:hidden" style={{ zIndex: 40 }} />
          <D.Content className="fixed inset-y-0 left-0 lg:hidden" style={{ zIndex: 41 }}>
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <Sidebar {...sidebarProps} collapsed={false} onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          crumb={crumbFor(loc.pathname, ADMIN_NAV)}
          org={tenant.tenantName}
          searchPlaceholder="Search employees, pages…"
          onMenu={() => setDrawer(true)}
          roleLabel={tenant.roleName}
          alerts={[
            { label: "Leave requests", to: "/leave", count: b?.pendingLeaveCount ?? 0 },
            { label: "Attendance corrections", to: "/attendance/corrections", count: b?.pendingCorrections ?? 0 },
            { label: "Expense claims", to: "/reimbursements", count: b?.pendingClaimCount ?? 0 },
            { label: "Onboarding to verify", to: "/employees/onboarding", count: b?.awaitingVerification ?? 0 },
            { label: "Probation reviews due", to: "/employees/probation", count: b?.probationDue ?? 0 },
          ]}
        />
        <main className="flex w-full max-w-[1440px] flex-col gap-5 px-4 pb-12 pt-6 sm:px-7">
          {tenant?.support ? <SupportBanner name={tenant.tenantName} s={tenant.support} /> : null}
          {tenant?.tenantStatus === "past_due" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3 text-[13.5px]" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }} role="alert">
              <span>Your subscription invoice is overdue. Please pay it to avoid the account being suspended.</span>
              {can("billing") ? (
                <Link to="/settings/billing" className="font-medium" style={{ color: "inherit" }}>
                  View invoice
                </Link>
              ) : null}
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function sessionStorageGet(k: string) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}

/** Shown while platform support is viewing a company read-only. */
function SupportBanner({ name, s }: { name: string; s: NonNullable<ReturnType<typeof useSession>["tenant"]>["support"] & object }) {
  const exit = async () => {
    try {
      await api.post(`/platform/support/access/${s.accessId}/end`);
    } catch {
      /* already ended or expired */
    }
    setActiveTenant(null);
    window.location.href = `/platform/tickets/${s.ticketId}`;
  };
  useEffect(() => {
    const ms = Date.parse(s.expiresAt) - Date.now();
    const t = setTimeout(exit, Math.max(0, ms));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.expiresAt]);
  const until = new Date(s.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3 text-[13.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }} role="status">
      <span>
        <strong>Read-only support view</strong> of {name} for ticket #{s.ticketNumber}. You can't change or download anything. Ends at {until}.
      </span>
      <button type="button" className="btn btn-secondary !py-1 !text-[13px]" onClick={exit}>
        Exit support view
      </button>
    </div>
  );
}
