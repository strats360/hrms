import { Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Play } from "lucide-react";
import { fmtDate, todayIST } from "@hrms/shared";
import { api, ApiError, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { monthLabel } from "@/components/payroll/Payslip";

export function usePayrollRuns() {
  return useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.get<PayrollRun[]>("/admin/payroll/runs") });
}

/** Open the current month's run, creating it if needed. */
export function useStartCurrentRun() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const runs = usePayrollRuns();
  const month = todayIST().slice(0, 7);
  return useMutation({
    mutationFn: async () => {
      const existing = runs.data?.find((r) => r.month === month);
      if (existing) return existing;
      return api.post<PayrollRun>("/admin/payroll/runs", { month });
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
            {can("payroll", "edit") ? (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
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
        ]}
      />
      <Outlet />
    </>
  );
}
