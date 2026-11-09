import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, X } from "lucide-react";
import { APPROVAL_STEP_LABELS, APPROVAL_STEPS, type ApprovalPolicy, type ApprovalStep } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Loading } from "@/components/ui/page";

/** One chain: steps in order, each picked from manager / skip level / HR. */
function ChainEditor({ steps, onChange, disabled }: { steps: ApprovalStep[]; onChange: (s: ApprovalStep[]) => void; disabled: boolean }) {
  const unused = APPROVAL_STEPS.filter((s) => !steps.includes(s));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          {i > 0 ? <ArrowRight size={14} className="text-muted" /> : null}
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px]" style={{ background: "var(--tint-1)" }}>
            {APPROVAL_STEP_LABELS[s]}
            {!disabled && steps.length > 1 ? (
              <button type="button" aria-label={`Remove ${APPROVAL_STEP_LABELS[s]}`} className="text-muted cursor-pointer border-0 bg-transparent p-0" onClick={() => onChange(steps.filter((x) => x !== s))}>
                <X size={13} />
              </button>
            ) : null}
          </span>
        </span>
      ))}
      {!disabled && unused.length ? (
        <Select className="!w-auto" value="" onChange={(e) => e.target.value && onChange([...steps, e.target.value as ApprovalStep])} aria-label="Add a step">
          <option value="">+ Add step</option>
          {unused.map((s) => (
            <option key={s} value={s}>
              {APPROVAL_STEP_LABELS[s]}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

export default function Approvals() {
  const qc = useQueryClient();
  const { can } = useSession();
  const edit = can("settings", "edit");
  const q = useQuery({ queryKey: ["org", "approvals"], queryFn: () => api.get<ApprovalPolicy>("/admin/org/approvals") });
  const [p, setP] = useState<ApprovalPolicy | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/org/approvals", p),
    onSuccess: () => {
      toast.success("Approval chains saved. Requests already waiting carry on from the step they're at.");
      qc.invalidateQueries({ queryKey: ["org", "approvals"] });
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!p || !q.data) return <Loading />;
  const dirty = JSON.stringify(p) !== JSON.stringify(q.data);
  return (
    <div className="flex flex-col gap-4">
      <Card className="!gap-4">
        <CardHeader
          title="Approval chains"
          sub="Who approves leave and attendance corrections, in order. A request is approved after the last step; a rejection at any step ends it. Steps with nobody to fill them (no manager on record) are skipped, and HR can act on any step."
        />
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] font-medium">Leave</div>
          <ChainEditor steps={p.leave.steps} onChange={(steps) => setP({ ...p, leave: { ...p.leave, steps } })} disabled={!edit} />
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] p-3" style={{ background: "var(--tint-1)" }}>
          <Checkbox
            label="Use a longer chain for long leave"
            checked={p.leave.longLeaveDays !== null}
            onChange={(v) => setP({ ...p, leave: { ...p.leave, longLeaveDays: v ? 5 : null } })}
            disabled={!edit}
          />
          {p.leave.longLeaveDays !== null ? (
            <>
              <Field label="For leave longer than (days)" className="sm:w-[220px]">
                <Input type="number" min={1} max={365} value={p.leave.longLeaveDays} onChange={(e) => setP({ ...p, leave: { ...p.leave, longLeaveDays: Number(e.target.value) || 1 } })} disabled={!edit} />
              </Field>
              <ChainEditor steps={p.leave.longSteps} onChange={(longSteps) => setP({ ...p, leave: { ...p.leave, longSteps } })} disabled={!edit} />
            </>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] font-medium">Attendance corrections</div>
          <ChainEditor steps={p.attendance.steps} onChange={(steps) => setP({ ...p, attendance: { steps } })} disabled={!edit} />
        </div>
        <div className="text-muted text-[12.5px]">Reimbursement approvals are set per expense category under Reimbursements › Categories. Payroll and payment batches always need someone other than the person who prepared them.</div>
        {edit ? (
          <div className="flex justify-end gap-2">
            <Button disabled={!dirty} onClick={() => setP(q.data!)}>
              Reset
            </Button>
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
