import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { countLeaveDays, todayIST } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import type { Holiday, LeaveType } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useLookups } from "@/components/attendance/shared";
import { SearchSelect } from "@/components/ui/search-select";

export function ApplyOnBehalfDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const types = useQuery({ queryKey: ["leave", "types"], queryFn: () => api.get<LeaveType[]>("/admin/leave/types"), enabled: open });
  const empty = { employeeId: "", leaveTypeId: "", startDate: todayIST(), endDate: todayIST(), halfDay: false, reason: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const year = f.startDate.slice(0, 4);
  const hol = useQuery({ queryKey: ["leave", "holidays", year], queryFn: () => api.get<Holiday[]>(`/admin/leave/holidays?year=${year}`), enabled: open });
  const active = (types.data ?? []).filter((t) => t.active);
  const type = active.find((t) => t.id === f.leaveTypeId);

  const days = useMemo(() => {
    if (!f.startDate || !f.endDate || f.endDate < f.startDate) return 0;
    return countLeaveDays(f.startDate, f.endDate, { halfDay: f.halfDay, holidays: (hol.data ?? []).map((h) => h.date) });
  }, [f.startDate, f.endDate, f.halfDay, hol.data]);

  const m = useMutation({
    mutationFn: () => api.post("/admin/leave/requests", { ...f, reason: f.reason || null }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Leave request created. It now waits for approval.");
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setF(empty);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setErr(null);
        onOpenChange(v);
      }}
      title="Apply leave on behalf"
      description="Use this when an employee can't apply themselves. The request still goes through approval."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.employeeId || !f.leaveTypeId || days <= 0} onClick={() => m.mutate()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" span>
          <SearchSelect value={f.employeeId} onChange={(v) => setF((s) => ({ ...s, employeeId: v }))} placeholder="Select an employee" searchPlaceholder="Search by name or employee ID" options={(lookups.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }))} />
        </Field>
        <Field label="Leave type" span>
          <Select value={f.leaveTypeId} onChange={(e) => setF((s) => ({ ...s, leaveTypeId: e.target.value, halfDay: false }))}>
            <option value="">Select a leave type</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isPaid ? "" : " (unpaid)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={f.startDate} onChange={(e) => setF((s) => ({ ...s, startDate: e.target.value, endDate: s.endDate < e.target.value || s.halfDay ? e.target.value : s.endDate }))} />
        </Field>
        <Field label="To">
          <Input type="date" value={f.endDate} min={f.startDate} disabled={f.halfDay} onChange={(e) => setF((s) => ({ ...s, endDate: e.target.value }))} />
        </Field>
        {type?.allowHalfDay !== false ? (
          <div className="col-span-full">
            <Checkbox checked={f.halfDay} onChange={(v) => setF((s) => ({ ...s, halfDay: v, endDate: v ? s.startDate : s.endDate }))} label="Half day" />
          </div>
        ) : null}
        <Field label="Reason" span>
          <Textarea value={f.reason} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} maxLength={500} placeholder="Optional" />
        </Field>
      </div>
      <div className="text-muted text-[13px]">
        {days > 0 ? `${days} day${days === 1 ? "" : "s"} will be charged. Weekly offs and holidays are not counted.` : "Those dates have no working days."}
      </div>
      {err ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      ) : null}
    </Dialog>
  );
}
