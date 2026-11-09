import { CompOffCard } from "@/components/leave/CompOffCard";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { countLeaveDays, fmtDate, leaveApplySchema, todayIST } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import type { Holiday, LeaveBalance, LeaveRequest, LeaveType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";
import { zodErrors } from "@/components/onboarding/form";

interface EssLeave {
  year: number;
  balances: LeaveBalance[];
  types: LeaveType[];
  requests: (LeaveRequest & { typeName: string; typeCode: string })[];
}

export default function EssLeavePage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("apply") === "1");
  const year = Number(todayIST().slice(0, 4));
  const q = useQuery({ queryKey: ["ess", "leave"], queryFn: () => api.get<EssLeave>("/ess/leave") });
  const hq = useQuery({ queryKey: ["ess", "holidays", year], queryFn: () => api.get<Holiday[]>(`/ess/holidays${qs({ year })}`) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/ess/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["ess"] });
    },
  });
  useEffect(() => {
    if (!open && params.get("apply")) setParams({}, { replace: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const today = todayIST();
  const shown = d.balances.filter((b) => b.isPaid);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="!mb-0 !text-[24px]">Leave</h1>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          Apply
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shown.map((b) => (
          <Card key={b.leaveTypeId} padded={false} className="!gap-1 !p-3">
            <div className="text-[12px]" style={{ color: "var(--muted-2)" }}>{b.name}</div>
            <div className="text-[22px] font-medium num">{b.available}</div>
            <div className="card-meta">
              {b.used} used{b.pending ? ` · ${b.pending} pending` : ""}
              {b.annualQuota ? ` · ${b.annualQuota}/yr` : ""}
            </div>
          </Card>
        ))}
      </div>
      <Card className="!gap-0">
        <CardHeader title="My requests" sub={`${d.year}`} className="mb-2" />
        {d.requests.length === 0 ? <div className="text-muted py-3 text-[13px]">You haven't applied for leave yet.</div> : null}
        {d.requests.map((r) => {
          const cancellable = r.status === "pending" || (r.status === "approved" && r.startDate > today);
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2.5 text-[13.5px] last:border-0">
              <div className="min-w-0">
                <div className="font-semibold">{r.typeName} · {Number(r.days)} day{Number(r.days) === 1 ? "" : "s"}{r.halfDay ? " (half day)" : ""}</div>
                <div className="text-muted text-[12px]">
                  {r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate, false)} to ${fmtDate(r.endDate)}`} · {r.code}
                  {r.reason ? ` · ${r.reason}` : ""}
                </div>
                {r.decisionNote ? <div className="text-[12px]" style={{ color: r.status === "rejected" ? "var(--bad)" : "var(--muted-2)" }}>Note: {r.decisionNote}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusTag status={r.status} />
                {r.status === "pending" && r.waitingOn ? <div className="text-muted text-[11.5px]">With {r.waitingOn.label}{r.waitingOn.of > 1 ? ` (${r.waitingOn.at} of ${r.waitingOn.of})` : ""}</div> : null}
                {cancellable ? (
                  <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={() => { if (confirm(`Cancel ${r.code}?`)) cancel.mutate(r.id); }}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>
      <CompOffCard />
      <Card className="!gap-1.5">
        <CardHeader title={`Holidays ${year}`} />
        {(hq.data ?? []).map((h) => (
          <div key={h.id} className="flex justify-between gap-2 text-[13px]" style={{ opacity: h.date < today ? 0.55 : 1 }}>
            <span>{fmtDate(h.date)} · {h.name}</span>
            <span className="text-muted capitalize">{h.type}</span>
          </div>
        ))}
      </Card>
      <ApplyDialog open={open} onOpenChange={setOpen} data={d} holidays={hq.data ?? []} />
    </>
  );
}

function ApplyDialog({ open, onOpenChange, data, holidays }: { open: boolean; onOpenChange: (v: boolean) => void; data: EssLeave; holidays: Holiday[] }) {
  const qc = useQueryClient();
  const first = data.types.find((t) => t.code === "CL") ?? data.types[0];
  const blank = () => ({ leaveTypeId: first?.id ?? "", startDate: todayIST(), endDate: todayIST(), halfDay: false, reason: "" });
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF(blank());
      setErrors({});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = data.types.find((t) => t.id === f.leaveTypeId);
  const bal = data.balances.find((b) => b.leaveTypeId === f.leaveTypeId);
  const days = useMemo(() => {
    if (!f.startDate || !f.endDate || f.endDate < f.startDate) return 0;
    return countLeaveDays(f.startDate, f.endDate, { halfDay: f.halfDay, holidays: holidays.map((h) => h.date) });
  }, [f.startDate, f.endDate, f.halfDay, holidays]);
  const free = bal ? bal.available - bal.pending : 0;

  const m = useMutation({
    mutationFn: (b: unknown) => api.post("/ess/leave", b),
    onSuccess: () => {
      toast.success("Leave request sent to your manager");
      qc.invalidateQueries({ queryKey: ["ess"] });
      onOpenChange(false);
    },
  });
  const submit = () => {
    const parsed = leaveApplySchema.safeParse(f);
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    m.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Apply for leave"
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={days <= 0} onClick={submit}>Send request</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field span label="Leave type" error={errors.leaveTypeId}>
          <Select value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value, halfDay: false })}>
            {data.types.map((t) => {
              const b = data.balances.find((x) => x.leaveTypeId === t.id);
              return <option key={t.id} value={t.id}>{t.name}{t.isPaid ? ` (${b ? b.available - b.pending : 0} available)` : ""}</option>;
            })}
          </Select>
        </Field>
        <Field label="From" error={errors.startDate}>
          <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value || f.halfDay ? e.target.value : f.endDate })} />
        </Field>
        <Field label="To" error={errors.endDate}>
          <Input type="date" value={f.endDate} min={f.startDate} disabled={f.halfDay} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </Field>
        {type?.allowHalfDay ? (
          <div className="col-span-full">
            <Checkbox checked={f.halfDay} onChange={(v) => setF({ ...f, halfDay: v, endDate: v ? f.startDate : f.endDate })} label={<span className="text-[13px]">Half day</span>} />
            {errors.halfDay ? <div className="mt-1 text-[12px]" style={{ color: "var(--bad)" }}>{errors.halfDay}</div> : null}
          </div>
        ) : null}
        <Field span label="Reason" error={errors.reason}>
          <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} placeholder="Optional, but it helps your manager" />
        </Field>
      </div>
      <Notice tone={type?.isPaid && days > free ? "bad" : "sel"}>
        {days > 0 ? `${days} working day${days === 1 ? "" : "s"}` : "Those dates are weekly offs or holidays"}
        {type?.isPaid && days > 0 ? ` · ${free} available` : ""}
        {type && !type.isPaid ? " · unpaid, deducted from salary" : ""}
        {type?.isPaid && days > free ? ". Not enough balance. Try unpaid leave instead." : ""}
      </Notice>
    </Dialog>
  );
}
