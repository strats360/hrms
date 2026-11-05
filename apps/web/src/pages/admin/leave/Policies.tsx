import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { leaveTypeSchema } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { LeaveType } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

type Form = Omit<LeaveType, "id">;
const BLANK: Form = { code: "", name: "", isPaid: true, annualQuota: 0, accrual: "yearly", carryForwardMax: 0, encashable: false, allowHalfDay: true, allowNegative: false, active: true };
const fmt = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));

function describe(t: LeaveType) {
  const parts: string[] = [];
  if (t.accrual === "monthly") parts.push(`Accrues ${fmt(Number(t.annualQuota) / 12)} a month`);
  else if (t.accrual === "yearly") parts.push("Credited at the start of the year, pro-rated for joiners");
  else parts.push("Granted case by case");
  parts.push(Number(t.carryForwardMax) > 0 ? `carry forward up to ${fmt(t.carryForwardMax)}` : "no carry forward");
  if (t.encashable) parts.push("encashable");
  parts.push(t.allowHalfDay ? "half days allowed" : "full days only");
  if (t.allowNegative) parts.push("can go negative");
  return parts.join(" · ");
}

export default function Policies() {
  const { can } = useSession();
  const editable = can("leave", "configure");
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const types = useQuery({ queryKey: ["leave", "types"], queryFn: () => api.get<LeaveType[]>("/admin/leave/types") });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="card-title text-[17px]">Leave types</div>
          <div className="text-muted text-[13px]">The leave year runs January to December. Weekly offs and holidays inside a leave are not charged.</div>
        </div>
        {editable ? (
          <Button variant="primary" onClick={() => setEdit({ form: { ...BLANK } })}>
            <Plus size={16} />
            Add leave type
          </Button>
        ) : null}
      </div>
      {types.error ? <ErrorState error={types.error} retry={() => types.refetch()} /> : null}
      {types.isLoading ? <Loading /> : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        {types.data?.map((t) => (
          <Card key={t.id} className="!gap-2" style={{ opacity: t.active ? 1 : 0.6 }}>
            <div className="flex items-start justify-between gap-2">
              <div className="card-kicker">
                {t.name} · {t.code}
              </div>
              <div className="flex gap-1">
                {!t.active ? <Tag tone="neutral">Inactive</Tag> : null}
                <Tag tone={t.isPaid ? "ok" : "warn"}>{t.isPaid ? "Paid" : "Unpaid"}</Tag>
              </div>
            </div>
            <div className="text-[26px] font-medium tracking-tight">{Number(t.annualQuota) > 0 ? `${fmt(t.annualQuota)} / year` : t.isPaid ? "Earned" : "As needed"}</div>
            <div className="flex-1 text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              {describe(t)}
            </div>
            {editable ? (
              <Button
                size="sm"
                className="self-start"
                onClick={() =>
                  setEdit({
                    id: t.id,
                    form: { code: t.code, name: t.name, isPaid: t.isPaid, annualQuota: Number(t.annualQuota), accrual: t.accrual, carryForwardMax: Number(t.carryForwardMax), encashable: t.encashable, allowHalfDay: t.allowHalfDay, allowNegative: t.allowNegative, active: t.active },
                  })
                }
              >
                Edit
              </Button>
            ) : null}
          </Card>
        ))}
      </div>
      {edit ? <LeaveTypeDialog key={edit.id ?? "new"} id={edit.id} initial={edit.form} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function LeaveTypeDialog({ id, initial, onClose }: { id?: string; initial: Form; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => (id ? api.patch(`/admin/leave/types/${id}`, body) : api.post("/admin/leave/types", body)),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(id ? "Leave policy updated" : "Leave type added");
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    const p = leaveTypeSchema.safeParse(f);
    if (!p.success) {
      const i = p.error.issues[0];
      return setErr(i ? `${i.path.join(".")}: ${i.message}` : "Check the form");
    }
    setErr(null);
    save.mutate(p.data);
  };
  const flag = (k: keyof Form, label: string) => <Checkbox checked={!!f[k]} onChange={(v) => setF((s) => ({ ...s, [k]: v }))} label={label} />;

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={id ? `Edit ${initial.name}` : "Add leave type"}
      description={id ? "Changes apply to balances from now on. Leave already approved stays as it is." : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="For example: Maternity leave" />
        </Field>
        <Field label="Code" hint="Up to 6 letters">
          <Input value={f.code} maxLength={6} onChange={(e) => setF((s) => ({ ...s, code: e.target.value.toUpperCase() }))} placeholder="ML" />
        </Field>
        <Field label="Days per year">
          <Input type="number" min={0} max={365} step="0.5" value={f.annualQuota} onChange={(e) => setF((s) => ({ ...s, annualQuota: Number(e.target.value) }))} />
        </Field>
        <Field label="Accrual">
          <Select value={f.accrual} onChange={(e) => setF((s) => ({ ...s, accrual: e.target.value as Form["accrual"] }))}>
            <option value="yearly">Credited at start of year</option>
            <option value="monthly">Accrues every month</option>
            <option value="none">No automatic credit</option>
          </Select>
        </Field>
        <Field label="Carry forward up to (days)">
          <Input type="number" min={0} max={365} step="0.5" value={f.carryForwardMax} onChange={(e) => setF((s) => ({ ...s, carryForwardMax: Number(e.target.value) }))} />
        </Field>
        <div className="flex flex-col gap-2 pt-1 sm:col-span-1">
          {flag("isPaid", "Paid leave")}
          {flag("encashable", "Can be encashed")}
          {flag("allowHalfDay", "Allow half days")}
          {flag("allowNegative", "Allow negative balance")}
          {flag("active", "Active")}
        </div>
      </div>
      {err ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      ) : null}
    </Dialog>
  );
}
