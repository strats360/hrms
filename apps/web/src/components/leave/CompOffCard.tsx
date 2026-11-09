import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtDate } from "@hrms/shared";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { COMP_OFF_LABEL, COMP_OFF_TONE, DAY_TYPE, type CompOffRow } from "@/pages/admin/leave/CompOff";

interface Mine {
  settings: { expiryDays: number; claimWithinDays: number };
  claimable: { date: string; dayType: CompOffRow["dayType"]; days: number }[];
  requests: CompOffRow[];
}

/** Self-service: claim comp off for weekly offs and holidays worked. */
export function CompOffCard() {
  const qc = useQueryClient();
  const readOnly = !!useSession().tenant?.support;
  const q = useQuery({ queryKey: ["ess", "comp-off"], queryFn: () => api.get<Mine>("/ess/comp-off") });
  const [claim, setClaim] = useState<Mine["claimable"][number] | null>(null);
  const [reason, setReason] = useState("");
  const submit = useMutation({
    mutationFn: () => api.post("/ess/comp-off", { date: claim!.date, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Comp off request sent to your manager");
      setClaim(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["ess"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/ess/comp-off/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ess"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  if (!d || (!d.claimable.length && !d.requests.length)) return null;
  return (
    <Card className="!gap-2">
      <CardHeader title="Comp off" sub={`For weekly offs and holidays you worked. Claim within ${d.settings.claimWithinDays} days; use it within ${d.settings.expiryDays} days of the work.`} />
      {d.claimable.map((c) => (
        <div key={c.date} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[13.5px]" style={{ background: "var(--tint-1)" }}>
          <span>
            You worked on {fmtDate(c.date)} ({DAY_TYPE[c.dayType].toLowerCase()}): {c.days === 1 ? "1 day" : "half a day"}
          </span>
          {!readOnly ? (
            <Button size="sm" variant="primary" onClick={() => setClaim(c)}>
              Claim
            </Button>
          ) : null}
        </div>
      ))}
      {d.requests.slice(0, 8).map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-divider)] py-1.5 text-[13.5px] last:border-0">
          <span>
            {fmtDate(r.workDate)} · {r.days === 1 ? "1 day" : "half a day"}
            {r.status === "approved" && r.expiresOn ? <span className="text-muted"> · use by {fmtDate(r.expiresOn)}</span> : null}
            {r.status === "rejected" && r.decisionNote ? <span className="text-muted"> · {r.decisionNote}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <Tag tone={COMP_OFF_TONE[r.status]}>{COMP_OFF_LABEL[r.status]}</Tag>
            {r.status === "pending" && !readOnly ? (
              <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>
                Cancel
              </Button>
            ) : null}
          </span>
        </div>
      ))}
      <Dialog
        open={!!claim}
        onOpenChange={(v) => !v && setClaim(null)}
        title={`Claim comp off for ${claim ? fmtDate(claim.date) : ""}`}
        footer={
          <>
            <Button onClick={() => setClaim(null)}>Cancel</Button>
            <Button variant="primary" disabled={reason.trim().length < 3} loading={submit.isPending} onClick={() => submit.mutate()}>
              Send to manager
            </Button>
          </>
        }
      >
        <Field label="What was the work?">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Production release" />
        </Field>
      </Dialog>
    </Card>
  );
}
