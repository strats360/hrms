import { NavLink, Outlet } from "react-router";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page";

const ITEMS = [
  { to: "/settings", label: "Organization", end: true },
  { to: "/settings/structure", label: "Branches & departments" },
  { to: "/attendance/policies", label: "Shifts & attendance policies" },
  { to: "/leave/policies", label: "Leave policies" },
  { to: "/leave/holidays", label: "Holiday calendar" },
  { to: "/settings/access", label: "Admin users & access", perm: "users" as const },
  { to: "/settings/billing", label: "Billing & invoices", perm: "billing" as const },
  { to: "/settings/audit", label: "Audit log" },
];

export default function SettingsLayout() {
  const { can } = useSession();
  return (
    <>
      <PageHeader title="Settings" sub="Organization, policies and access" />
      <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav className="card !gap-px !p-2.5 lg:sticky lg:top-[90px]" aria-label="Settings">
          {ITEMS.filter((i) => !i.perm || can(i.perm)).map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className="rounded-[var(--radius-md)] px-3 py-2 text-[13.5px] no-underline hover:bg-[var(--tint-1)]"
              style={({ isActive }) => ({ background: isActive ? "var(--sel-bg)" : undefined, color: isActive ? "var(--sel-fg)" : "var(--color-text)", fontWeight: isActive ? 600 : 400 })}
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <Outlet />
        </div>
      </div>
    </>
  );
}
