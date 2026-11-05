import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { inr, payrollAdjustmentSchema } from "@hrms/shared";
import { api } from "@/lib/api";
import type { PayrollItem } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["payroll"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

/** Hold one or more salaries with a reason. */
export function HoldDialog({ runId, items, onClose }: { runId: string; items: PayrollItem[] | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const done = useInvalidate();
  useEffect(() => setReason(""), [items]);
  const m = useMutation({
    mutationFn: async () => {
      for (const it of items!) await api.patch(`/admin/payroll/runs/${runId}/items/${it.employeeId}`, { onHold: true, holdReason: reason.trim() });
    },
    onSuccess: () => {
      toast.success(items!.length === 1 ? `Salary held for ${items![0]!.snapshot.name}` : `${items!.length} salaries held`);
      done();
      onClose();
    },
  });
  const title = items?.length === 1 ? `Hold salary · ${items[0]!.snapshot.name}` : `Hold ${items?.length ?? 0} salaries`;
  return (
    <Dialog
      open={!!items?.length}
      onOpenChange={(v) => !v && onClose()}
      title={title}
      description="Held salaries stay in the register but are left out of the bank file and payslip emails."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!reason.trim()} loading={m.isPending} onClick={() => m.mutate()}>
            Hold salary
          </Button>
        </>
      }
    >
      <Field label="Reason">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="For example: bank details being verified" />
      </Field>
    </Dialog>
  );
}

/** Override the LOP days for one employee (recalculates the run). */
export function LopDialog({ runId, item, onClose }: { runId: string; item: PayrollItem | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const done = useInvalidate();
  useEffect(() => setValue(item?.lopOverride != null ? String(item.lopOverride) : ""), [item]);
  const m = useMutation({
    mutationFn: (lopOverride: number | null) => api.patch(`/admin/payroll/runs/${runId}/items/${item!.employeeId}`, { lopOverride }),
    onSuccess: () => {
      toast.success("LOP updated and payroll recalculated");
      done();
      onClose();
    },
  });
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= (item?.daysInMonth ?? 31) && Math.round(n * 2) === n * 2;
  return (
    <Dialog
      open={!!item}
      onOpenChange={(v) => !v && onClose()}
      title={`Set LOP days · ${item?.snapshot.name ?? ""}`}
      description={item ? `From attendance: ${item.lopDays} day(s). Your value replaces it for this month only.` : undefined}
      footer={
        <>
          {item?.lopOverride != null ? (
            <Button loading={m.isPending && m.variables === null} onClick={() => m.mutate(null)}>
              Use attendance value
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={m.isPending && m.variables !== null} onClick={() => m.mutate(n)}>
            Save LOP
          </Button>
        </>
      }
    >
      <Field label="LOP days" hint="Use whole or half days, for example 1.5">
        <Input autoFocus type="number" min={0} max={item?.daysInMonth} step={0.5} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** One-time earnings and deductions for an employee in this run. */
export function AdjustmentDialog({ runId, item, onClose }: { runId: string; item: PayrollItem | null; onClose: () => void }) {
  const [kind, setKind] = useState<"earning" | "deduction">("earning");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  const [esiWage, setEsiWage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const done = useInvalidate();
  useEffect(() => {
    setKind("earning");
    setLabel("");
    setAmount("");
    setTaxable(true);
    setEsiWage(true);
    setError(null);
  }, [item?.employeeId]);

  const add = useMutation({
    mutationFn: async () => {
      const parsed = payrollAdjustmentSchema.safeParse({ employeeId: item!.employeeId, kind, label, amount, taxable, esiWage });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return api.post(`/admin/payroll/runs/${runId}/adjustments`, parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success(`${kind === "earning" ? "Earning" : "Deduction"} added and payroll recalculated`);
      done();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/payroll/runs/${runId}/adjustments/${id}`),
    onSuccess: () => {
      toast.success("Removed and payroll recalculated");
      done();
      onClose();
    },
  });

  return (
    <Dialog
      open={!!item}
      onOpenChange={(v) => !v && onClose()}
      title={`One-time pay · ${item?.snapshot.name ?? ""}`}
      description="Incentives, arrears or recoveries for this month only. The run recalculates when you save."
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>
            Add {kind}
          </Button>
        </>
      }
    >
      {item?.adjustments.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-muted text-[12px]">Already added this month</div>
          {item.adjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[13px]" style={{ background: "var(--tint-1)" }}>
              <span>
                {a.label} <span className="text-muted">· {a.kind === "earning" ? "earning" : "deduction"}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-medium">{a.kind === "deduction" ? "−" : ""}{inr(a.amount)}</span>
                <Button icon size="sm" variant="ghost" aria-label={`Remove ${a.label}`} loading={remove.isPending && remove.variables === a.id} onClick={() => remove.mutate(a.id)}>
                  {remove.isPending && remove.variables === a.id ? null : <Trash2 size={14} />}
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Segmented value={kind} onChange={setKind} options={[{ value: "earning", label: "Earning" }, { value: "deduction", label: "Deduction" }]} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field label="Name on payslip">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "earning" ? "Sales incentive" : "Advance recovery"} maxLength={80} />
        </Field>
        <Field label="Amount (₹)">
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {kind === "earning" ? (
        <div className="flex flex-col gap-2">
          <Checkbox checked={taxable} onChange={setTaxable} label="Taxable (included in TDS)" />
          <Checkbox checked={esiWage} onChange={setEsiWage} label="Counts as ESI wages (untick for annual bonus)" />
        </div>
      ) : null}
    </Dialog>
  );
}
