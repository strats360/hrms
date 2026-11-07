import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { can as canDo, type Action, type Module, type PermissionMatrix } from "@hrms/shared";
import { api, ApiError, getActiveTenant, setActiveTenant } from "./api";

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
  /** Set when platform support is viewing the company read-only. */
  support?: { ticketId: string; ticketNumber: number; accessId: string; expiresAt: string } | null;
}
export interface Me {
  user: { id: string; name: string; email: string };
  platformRole: string | null;
  memberships: Membership[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  tenant: Membership | null;
  isAdmin: boolean;
  isEmployee: boolean;
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
        return await api.get<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = q.data ?? null;
  const tenant = useMemo(() => {
    if (!me) return null;
    return me.memberships.find((m) => m.tenantId === getActiveTenant()) ?? me.memberships[0] ?? null;
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
