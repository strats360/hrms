import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inr } from "@hrms/shared";
import { monthLabel } from "@/components/payroll/Payslip";
import { CardHeader, TableCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LeaveBalance } from "@/lib/types";

interface LeaveType {
  id: string;
  name: string;
  encashable: boolean;
  carryForwardMax: number;
}
interface Encashment {
  id: string;
  employeeCode: string;
  employeeName: string;
  leaveType: string;
  year: number;
  days: number;
  perDay: number;
  amount: number;
  reason: "request" | "year_end";
  state: "pending" | "in_payroll" | "paid" | "cancelled";
  payrollMonth: string | null;
  createdAt: string;
}
interface CloseResult {
  year: number;
  employees: number;
  carriedDays: number;
  lapsedDays: number;
  encashDays: number;
  encashAmount: number;
  rows: { employeeCode: string; name: string; type: string; left: number; carried: number; lapsed: number; encashed: number }[];
}

const useTypes = () => useQuery({ queryKey: ["leave", "types"], queryFn: () => api.get<LeaveType[]>("/admin/leave/types") });
const STATE: Record<Encashment["state"], { tone: Tone; label: string }> = {
  pending: { tone: "warn", label: "Waiting for payroll" },
  in_payroll: { tone: "accent", label: "In payroll" },
  paid: { tone: "ok", label: "Paid" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function EncashDialog({ row, onClose }: { row: { employeeId: string; name: string; balances: LeaveBalance[] }; onClose: () => void }) {
  const qc = useQueryClient();
  const types = useTypes();
  const encashable = (types.data ?? []).filter((t) => t.encashable);
  const [typeId, setTypeId] = useState("");
  const [days, setDays] = useState("");
  const tid = typeId || encashable[0]?.id || "";
  const bal = row.balances.find((b) => b.leaveTypeId === tid);
  const free = bal ? Math.max(0, bal.available - bal.pending) : 0;
  const m = useMutation({
    mutationFn: () => api.post<{ amount: number }>("/admin/leave/encashments", { employeeId: row.employeeId, leaveTypeId: tid, days: Number(days) }),
    onSuccess: (r) => {
      toast.success(`${inr(r.amount)} will be paid with the next payroll`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Encash leave for ${row.name}`}
      description="Paid at basic / 26 a day as a one-time earning in the next payroll. It's taxable, and not part of ESI or PF wages. The days come off the balance now."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!tid || !(Number(days) > 0) || Number(days) > free} loading={m.isPending} onClick={() => m.mutate()}>
            Encash
          </Button>
        </>
      }
    >
      {encashable.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Leave type">
            <Select value={tid} onChange={(e) => setTypeId(e.target.value)}>
              {encashable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Days" hint={`${free} available`} error={Number(days) > free ? `Only ${free} available` : null}>
            <Input type="number" min={0.5} step={0.5} max={free} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
      ) : (
        <Notice tone="warn">No leave type allows encashment. Turn it on for a type under Leave › Policies.</Notice>
      )}
    </Dialog>
  );
}

export function YearCloseDialog({ year, onClose }: { year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [encash, setEncash] = useState(false);
  const [preview, setPreview] = useState<CloseResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<CloseResult>("/admin/leave/year-close", { year, encashLapsed: encash, dryRun }),
    onSuccess: (r, dryRun) => {
      if (dryRun) return setPreview(r);
      toast.success(`${year} closed: ${r.carriedDays} days carried into ${year + 1}`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const shown = preview?.rows.filter((r) => r.carried || r.lapsed || r.encashed).slice(0, 200) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Close leave year ${year}`}
      description={`Unused leave moves into ${year + 1} as the opening balance, up to each type's carry-forward limit. The rest lapses. You can run this again if late leave is approved for ${year}.`}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {preview ? (
            <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(false)}>
              Close {year}
            </Button>
          ) : (
            <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(true)}>
              Preview
            </Button>
          )}
        </>
      }
    >
      <Checkbox
        checked={encash}
        onChange={(v) => {
          setEncash(v);
          setPreview(null);
        }}
        label={<span className="text-[13px]">Pay out lapsing days of encashable leave (added to the next payroll)</span>}
      />
      {preview ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone="neutral">{preview.employees} employees</Tag>
            <Tag tone="ok">{preview.carriedDays} days carried</Tag>
            <Tag tone="warn">{preview.lapsedDays} days lapse</Tag>
            {preview.encashDays ? <Tag tone="accent">{preview.encashDays} days encashed · {inr(preview.encashAmount)}</Tag> : null}
          </div>
          <div className="scroll-thin max-h-[300px] min-w-0 overflow-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th className="text-right">Unused</th>
                  <th className="text-right">Carried</th>
                  <th className="text-right">Lapses</th>
                  <th className="text-right">Encashed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.employeeCode}-${r.type}`}>
                    <td className="whitespace-nowrap">
                      {r.name} <span className="text-muted">· {r.employeeCode}</span>
                    </td>
                    <td>{r.type}</td>
                    <td className="num text-right">{r.left}</td>
                    <td className="num text-right">{r.carried}</td>
                    <td className="num text-right">{r.lapsed || "—"}</td>
                    <td className="num text-right">{r.encashed || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

export function EncashmentsCard() {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["leave", "encashments"], queryFn: () => api.get<Encashment[]>("/admin/leave/encashments") });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/admin/leave/encashments/${id}/cancel`),
    onSuccess: () => {
      toast.success("Encashment cancelled");
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = (q.data ?? []).filter((e) => e.state !== "cancelled").slice(0, 50);
  if (!rows.length) return null;
  return (
    <TableCard>
      <CardHeader className="py-2" title="Leave encashments" sub="Waiting ones are added from Payroll › Review › Leave encashment." />
      <div className="scroll-thin min-w-0 overflow-auto">
        <table className="table text-[13px]">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Leave</th>
              <th className="text-right">Days</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">
                  {e.employeeName} <span className="text-muted">· {e.employeeCode}</span>
                </td>
                <td>
                  {e.leaveType}
                  {e.reason === "year_end" ? <span className="text-muted"> · lapsed {e.year}</span> : null}
                </td>
                <td className="num text-right">{e.days}</td>
                <td className="num text-right">{inr(e.amount)}</td>
                <td>
                  <Tag tone={STATE[e.state].tone}>{STATE[e.state].label}</Tag>
                  {e.payrollMonth ? <span className="text-muted"> {monthLabel(e.payrollMonth)}</span> : null}
                </td>
                <td className="text-right">
                  {e.state === "pending" && can("leave", "configure") ? (
                    <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === e.id} onClick={() => cancel.mutate(e.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  );
}
