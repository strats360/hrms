import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api } from "@/lib/api";
import type { Challan, Obligation } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { monthLabel } from "@/components/payroll/Payslip";

const REF_LABEL: Record<string, string> = { epf: "TRRN", esi: "Challan number", pt: "Challan / receipt number", lwf: "Receipt number", tds: "CIN (BSR code, date, serial)" };

/** Record (or edit) the payment for an obligation, with an optional receipt. */
export function RecordPaymentDialog({ obligation, onClose }: { obligation: Obligation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = obligation?.challan ?? null;
  const [form, setForm] = useState({ amountPaid: "", reference: "", paidOn: todayIST(), notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!obligation) return;
    setError(null);
    setFile(null);
    setForm(
      existing
        ? { amountPaid: String(existing.amountPaid), reference: existing.reference ?? "", paidOn: existing.paidOn, notes: existing.notes ?? "" }
        : { amountPaid: String(obligation.amount), reference: "", paidOn: todayIST(), notes: "" },
    );
  }, [obligation, existing]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      const amountPaid = Number(form.amountPaid);
      if (!Number.isFinite(amountPaid) || amountPaid < 0) throw new Error("Enter the amount paid");
      if (!form.paidOn) throw new Error("Enter the payment date");
      const body = { amountPaid, reference: form.reference.trim() || null, paidOn: form.paidOn, notes: form.notes.trim() || null };
      const row = existing
        ? await api.patch<Challan>(`/admin/compliance/challans/${existing.id}`, body)
        : await api.post<Challan>("/admin/compliance/challans", { ...body, statute: obligation!.statute, period: obligation!.period, jurisdiction: obligation!.jurisdiction });
      if (file) {
        const fd = new FormData();
        fd.set("file", file);
        await api.upload(`/admin/compliance/challans/${row.id}/receipt`, fd);
      }
      return row;
    },
    onSuccess: () => {
      toast.success(existing ? "Payment updated" : "Payment recorded");
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const o = obligation;
  const late = o && form.paidOn > o.dueDate;
  return (
    <Dialog
      open={!!o}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? "Edit payment" : "Record payment"}
      description={o ? `${o.label} · ${monthLabel(o.period)} · due ${fmtDate(o.dueDate)}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {existing ? "Save changes" : "Record payment"}
          </Button>
        </>
      }
    >
      {o ? (
        <>
          <div className="rounded-[var(--radius-md)] px-3.5 py-3 text-[13px]" style={{ background: "var(--tint-1)" }}>
            {o.breakup.map((b) => (
              <div key={b.label} className="flex justify-between py-0.5">
                <span>{b.label}</span>
                <span className="num">{inr(b.amount)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-[var(--color-divider)] pt-1.5 font-semibold">
              <span>Payable for {o.employees} employees</span>
              <span className="num">{inr(o.amount)}</span>
            </div>
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount paid" hint={Number(form.amountPaid) > o.amount ? "More than the liability: interest or damages included" : undefined}>
              <Input inputMode="decimal" value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} />
            </Field>
            <Field label="Paid on" hint={late ? "After the due date: interest may apply" : undefined}>
              <Input type="date" max={todayIST()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
            </Field>
            <Field label={REF_LABEL[o.statute] ?? "Reference"} span>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            <Field label={existing?.receiptName ? `Replace receipt (current: ${existing.receiptName})` : "Challan receipt (PDF or image, optional)"} span>
              <Input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Notes" span>
              <Textarea className="!min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
