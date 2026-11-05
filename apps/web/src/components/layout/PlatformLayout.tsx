import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import * as D from "@radix-ui/react-dialog";
import { useSession } from "@/lib/session";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PLATFORM_NAV } from "./nav";
import { crumbFor } from "./AdminLayout";

/** Separate SaaS operator console with its own sidebar and header. */
export function PlatformLayout() {
  const { me, tenant } = useSession();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);
  if (!me?.platformRole) return <Navigate to="/" replace />;
  const props = { groups: PLATFORM_NAV, subtitle: "Platform console", footer: tenant?.roleId ? { to: "/", label: "Exit to tenant view", kind: "admin" as const } : null };
  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="hidden lg:block">
        <Sidebar {...props} collapsed={false} />
      </div>
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className="dialog-backdrop lg:hidden" style={{ zIndex: 40 }} />
          <D.Content className="fixed inset-y-0 left-0 lg:hidden" style={{ zIndex: 41 }}>
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Platform navigation</D.Description>
            <Sidebar {...props} collapsed={false} onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header crumb={crumbFor(loc.pathname, PLATFORM_NAV)} org="Strats360 People · Platform" searchPlaceholder="Search tenants…" onMenu={() => setDrawer(true)} roleLabel={me.platformRole.replace("_", " ")} palette={false} />
        <main className="flex w-full max-w-[1440px] flex-col gap-5 px-4 pb-12 pt-6 sm:px-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
