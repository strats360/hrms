import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inr } from "@hrms/shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api, errorMessage } from "@/lib/api";

interface OtRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  days: number;
  hours: number;
  ratePerHour: number;
  amount: number;
  overLimit: boolean;
  paid: { hours: number; amount: number } | null;
}
interface Ot {
  settings: { multiplier: number; basis: "gross" | "basic"; daysPerMonth: number; hoursPerDay: number; monthlyLimitHours: number };
  rows: OtRow[];
}

/** Approve the month's overtime hours (as recorded in attendance) and pay them in this run. */
export function OvertimeDialog({ runId, open, onClose }: { runId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payroll", "overtime", runId], queryFn: () => api.get<Ot>(`/admin/payroll/runs/${runId}/overtime`), enabled: open });
  const [hours, setHours] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setHours(Object.fromEntries(q.data.rows.map((r) => [r.employeeId, String(r.paid?.hours ?? r.hours)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put<{ employees: number; total: number }>(`/admin/payroll/runs/${runId}/overtime`, { rows: Object.entries(hours).map(([employeeId, h]) => ({ employeeId, hours: Number(h) || 0 })) }),
    onSuccess: (r) => {
      toast.success(r.employees ? `Overtime added for ${r.employees} employee${r.employees === 1 ? "" : "s"}: ${inr(r.total)}` : "Overtime removed from this payroll");
      qc.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data?.settings;
  const rows = q.data?.rows ?? [];
  const total = rows.reduce((sum, r) => sum + Math.round(r.ratePerHour * (Number(hours[r.employeeId]) || 0)), 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Overtime"
      description={s ? `Hours beyond the shift, from attendance. Paid at ${s.multiplier}× the ordinary rate (${s.basis === "gross" ? "monthly gross" : "basic"} / ${s.daysPerMonth} days / ${s.hoursPerDay} hours). Change the hours to what was approved; 0 pays nothing.` : undefined}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!rows.length} loading={save.isPending} onClick={() => save.mutate()}>
            Pay {inr(total)}
          </Button>
        </>
      }
    >
      {q.isLoading ? <div className="text-muted text-[13px]">Loading…</div> : null}
      {q.data && !rows.length ? <Notice tone="sel">No overtime is recorded for anyone in this payroll's period.</Notice> : null}
      {rows.length ? (
        <div className="scroll-thin max-h-[360px] min-w-0 overflow-auto">
          <table className="table text-[13px]">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Recorded</th>
                <th className="text-right">Rate / hour</th>
                <th>Hours to pay</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const h = Number(hours[r.employeeId]) || 0;
                return (
                  <tr key={r.employeeId}>
                    <td className="whitespace-nowrap">
                      {r.name} <span className="text-muted">· {r.employeeCode}</span>
                    </td>
                    <td className="num text-right">
                      {r.hours} h<span className="text-muted"> · {r.days} day{r.days === 1 ? "" : "s"}</span>
                      {r.overLimit ? <Tag tone="warn" className="ml-1">Over {s?.monthlyLimitHours} h</Tag> : null}
                    </td>
                    <td className="num text-right">{inr(r.ratePerHour)}</td>
                    <td>
                      <Input className="!w-[90px]" type="number" min={0} step={0.5} value={hours[r.employeeId] ?? ""} onChange={(e) => setHours({ ...hours, [r.employeeId]: e.target.value })} aria-label={`Hours for ${r.name}`} />
                    </td>
                    <td className="num text-right">{inr(Math.round(r.ratePerHour * h))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Dialog>
  );
}
