import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { offCycleRunSchema, todayLocal } from "@hrms/shared";
import { api } from "@/lib/api";
import type { PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/page";
import { SearchSelect } from "@/components/ui/search-select";
import { useLookups } from "@/components/attendance/shared";

interface Line {
  employeeId: string;
  amount: string;
  taxable: boolean;
}

/** One-off payments (a bonus, arrears, an incentive) outside the regular payroll. */
export function OffCycleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const [label, setLabel] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [lines, setLines] = useState<Line[]>([{ employeeId: "", amount: "", taxable: true }]);
  const [err, setErr] = useState<string | null>(null);
  const people = (lookups.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }));
  const save = useMutation({
    mutationFn: async () => {
      const body = { label, payDate, lines: lines.filter((l) => l.employeeId).map((l) => ({ employeeId: l.employeeId, amount: Number(l.amount.replace(/[,₹\s]/g, "")), taxable: l.taxable })) };
      const parsed = offCycleRunSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return api.post<PayrollRun>("/admin/payroll/runs/off-cycle", parsed.data);
    },
    meta: { silent: true },
    onSuccess: (run) => {
      toast.success("Off-cycle run calculated. Review and approve it like any payroll.");
      qc.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
      nav(`/payroll/run/${run.id}`);
    },
    onError: (e) => setErr(e.message),
  });
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Off-cycle payment"
      description="Pay a bonus, arrears or an incentive outside the regular payroll. TDS is the extra tax the payment adds to the person's year; there's no PF, ESI or PT on it."
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { setErr(null); save.mutate(); }}>Calculate</Button>
        </>
      }
    >
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it's for"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Diwali bonus" autoFocus /></Field>
        <Field label="Pay date"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
      </div>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <SearchSelect className="min-w-[220px] flex-1" value={l.employeeId} onChange={(v) => setLine(i, { employeeId: v })} options={people} placeholder="Employee" aria-label="Employee" />
            <Input className="!w-[140px]" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="Amount" aria-label="Amount" />
            <Checkbox checked={l.taxable} onChange={(v) => setLine(i, { taxable: v })} label="Taxable" />
            <Button icon size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : ls))}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button className="self-start" size="sm" onClick={() => setLines((ls) => [...ls, { employeeId: "", amount: "", taxable: true }])}>
          <Plus size={14} /> Add a person
        </Button>
      </div>
    </Dialog>
  );
}
