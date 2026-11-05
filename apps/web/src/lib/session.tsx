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
  switchTenant: (id: string) => void;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

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
    can: (m, a = "view") => canDo(tenant?.permissions, m, a),
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
