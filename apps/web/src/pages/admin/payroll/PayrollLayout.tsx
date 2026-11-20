import { useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Play } from "lucide-react";
import { fmtDate, todayLocal } from "@hrms/shared";
import { api, ApiError, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { monthLabel } from "@/components/payroll/Payslip";
import { useLookups } from "@/components/attendance/shared";

export function usePayrollRuns() {
  return useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.get<PayrollRun[]>("/admin/payroll/runs") });
}

/** Open the current month's run for a legal entity (the default one if none is given), creating it if needed. */
export function useStartCurrentRun() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const runs = usePayrollRuns();
  const lookups = useLookups();
  const month = todayLocal().slice(0, 7);
  return useMutation({
    mutationFn: async (entityId?: string | void) => {
      const ent = lookups.data?.entities?.find((x) => (entityId ? x.id === entityId : x.isDefault));
      // entities paid more often than monthly: the server opens the current run or the next period
      if (ent?.payFrequency && ent.payFrequency !== "monthly") return api.post<PayrollRun>("/admin/payroll/runs", { entityId: ent.id });
      const existing = runs.data?.find((r) => r.month === month && (!entityId || r.entityId === entityId));
      if (existing && (entityId || runs.data?.filter((r) => r.month === month).length === 1)) return existing;
      return api.post<PayrollRun>("/admin/payroll/runs", { month, entityId: entityId || null });
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      nav(`/payroll/run/${run.id}`);
    },
    meta: { silent: true },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't start the payroll run"),
  });
}

export default function PayrollLayout() {
  const { can } = useSession();
  const runs = usePayrollRuns();
  const start = useStartCurrentRun();
  const lookups = useLookups();
  const entities = lookups.data?.entities ?? [];
  const [picked, setEntityId] = useState("");
  const entityId = picked || entities.find((x) => x.isDefault)?.id || "";
  const latest = runs.data?.[0];
  const exportable = runs.data?.find((r) => r.status !== "draft");
  const sub = latest
    ? `${monthLabel(latest.month)} · ${latest.totals?.employees ?? "No"} employees · cycle closes ${fmtDate(latest.periodEnd, false)}`
    : "Salary structures, monthly runs, payslips and bank files";
  return (
    <>
      <PageHeader
        title="Payroll"
        sub={sub}
        actions={
          <>
            {can("payroll", "export") && exportable ? (
              <Button onClick={() => download(`/admin/payroll/runs/${exportable.id}/register.csv`, `salary-register-${exportable.month}.csv`).catch((e) => toast.error(e.message))}>
                <Download size={16} /> Salary register
              </Button>
            ) : null}
            {can("payroll", "edit") && entities.length > 1 ? (
              <Select aria-label="Legal entity to run payroll for" value={entityId} onChange={(e) => setEntityId(e.target.value)} className="!w-auto">
                {entities.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </Select>
            ) : null}
            {can("payroll", "edit") ? (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate(entities.length > 1 ? entityId : undefined)}>
                <Play size={16} /> Run payroll
              </Button>
            ) : null}
          </>
        }
      />
      <RouteTabs
        tabs={[
          { to: "/payroll", label: "Run payroll", end: true },
          { to: "/payroll/structure", label: "Salary structure" },
          { to: "/payroll/review", label: "Review & approve" },
          { to: "/payroll/payslips", label: "Payslips" },
          { to: "/payroll/loans", label: "Loans & advances" },
          { to: "/payroll/contractors", label: "Contractors" },
        ]}
      />
      <Outlet />
    </>
  );
}
