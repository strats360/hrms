import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { can as canDo, MODULES, type Action, type Module, type PermissionMatrix } from "@hrms/shared";
import { api, ApiError, getActiveTenant, setActiveTenant } from "./api";
import { clearOffline, isNetworkError, saveMe, savedMe } from "./offline";

export interface Membership {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  tenantStatus: string;
  setupComplete: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: PermissionMatrix;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  plan?: string;
  /** Feature flags for this company (plan gates and staged rollouts). */
  features?: Record<string, boolean>;
  /** The company requires two-factor sign-in for this person. */
  twoFactorRequired?: boolean;
  /** Set when platform support is viewing the company read-only. */
  support?: { ticketId: string; ticketNumber: number; accessId: string; expiresAt: string } | null;
}
export interface SupportSession {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  tenantStatus: string;
  plan: string;
  features: Record<string, boolean>;
  ticketId: string;
  ticketNumber: number;
  accessId: string;
  expiresAt: string;
}
export interface Me {
  user: { id: string; name: string; email: string; twoFactorEnabled?: boolean };
  platformRole: string | null;
  memberships: Membership[];
  supportSessions?: SupportSession[];
}

/** A running support session, shaped like a view-only membership. */
const SUPPORT_VIEW = Object.fromEntries(MODULES.map((m) => [m, ["view"]])) as PermissionMatrix;
function supportMembership(s: SupportSession): Membership {
  return {
    tenantId: s.tenantId,
    tenantName: s.tenantName,
    tenantCode: s.tenantCode,
    tenantStatus: s.tenantStatus,
    setupComplete: true,
    roleId: "support",
    roleName: "Support (read-only)",
    permissions: SUPPORT_VIEW,
    employeeId: null,
    employeeName: null,
    employeeCode: null,
    plan: s.plan,
    features: s.features,
    support: { ticketId: s.ticketId, ticketNumber: s.ticketNumber, accessId: s.accessId, expiresAt: s.expiresAt },
  };
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  tenant: Membership | null;
  isAdmin: boolean;
  isEmployee: boolean;
  /** The active company requires two-factor sign-in and it isn't set up yet. */
  needsTwoFactor: boolean;
  can: (m: Module, a?: Action) => boolean;
  /** Is a feature flag on for this company? Unknown flags count as on. */
  has: (feature: string) => boolean;
  switchTenant: (id: string) => void;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

/** Modules that a feature flag (or the plan) can switch off. */
const MODULE_FEATURE: Partial<Record<Module, string>> = {
  tds: "module.tds",
  reimbursements: "module.reimbursements",
  payments: "module.payments",
  reports: "module.reports",
  compliance: "module.compliance",
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        // null means signed out
        const me = await api.get<Me | null>("/me");
        saveMe(me);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          saveMe(null);
          return null;
        }
        // no connection: carry on as the person last signed in on this phone
        const saved = isNetworkError(e) ? savedMe<Me>() : null;
        if (saved) return saved;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = q.data ?? null;
  const tenant = useMemo(() => {
    if (!me) return null;
    const active = getActiveTenant();
    // support sessions are only used when explicitly opened, never as the default company
    const support = (me.supportSessions ?? []).find((x) => x.tenantId === active);
    return me.memberships.find((m) => m.tenantId === active) ?? (support ? supportMembership(support) : null) ?? me.memberships[0] ?? null;
  }, [me]);

  useEffect(() => {
    if (tenant && tenant.tenantId !== getActiveTenant()) setActiveTenant(tenant.tenantId);
  }, [tenant]);

  const value: SessionValue = {
    me,
    loading: q.isLoading,
    tenant,
    isAdmin: !!tenant?.roleId,
    isEmployee: !!tenant?.employeeId,
    needsTwoFactor: !!tenant?.twoFactorRequired && !me?.user.twoFactorEnabled && !tenant.support,
    can: (m, a = "view") => canDo(tenant?.permissions, m, a) && tenant?.features?.[MODULE_FEATURE[m] ?? ""] !== false,
    has: (f) => tenant?.features?.[f] !== false,
    switchTenant: (id) => {
      setActiveTenant(id);
      qc.invalidateQueries();
    },
    refresh: () => q.refetch(),
    signOut: async () => {
      try {
        await api.post("/auth/sign-out");
      } finally {
        setActiveTenant(null);
        clearOffline();
        qc.clear();
        window.location.href = "/login";
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
