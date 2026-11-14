import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtDate, inr } from "@hrms/shared";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { confirmAction } from "@/components/ui/confirm";

interface MyExit {
  id: string;
  code: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  resignationDate: string;
  lastWorkingDay: string;
  noticeDays: number;
  clearance: { label: string; done: boolean }[];
  settlement: { lines: { key: string; label: string; kind: "earning" | "deduction"; amount: number }[]; earnings: number; deductions: number; net: number } | null;
  settledOn: string | null;
}

/** Self-service: resign, follow the exit, and see the settlement once it's approved. */
export function ResignationCard() {
  const qc = useQueryClient();
  const readOnly = !!useSession().tenant?.support;
  const q = useQuery({ queryKey: ["ess", "exit"], queryFn: () => api.get<{ exit: MyExit | null }>("/ess/exit") });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [lastDay, setLastDay] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["ess", "exit"] });
  const resign = useMutation({
    mutationFn: () => api.post("/ess/resignation", { reason, ...(lastDay ? { proposedLastDay: lastDay } : {}) }),
    onSuccess: () => {
      toast.success("Resignation sent to HR and your manager");
      setOpen(false);
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: () => api.post("/ess/resignation/withdraw"),
    onSuccess: () => {
      toast.success("Resignation withdrawn");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const x = q.data?.exit;
  if (q.isLoading) return null;
  if (!x || x.status === "cancelled")
    return (
      <Card className="!gap-2">
        <CardHeader
          title="Resignation"
          sub="Thinking of leaving? Talk to your manager first. You can submit your resignation here."
          actions={
            !readOnly ? (
              <Button size="sm" onClick={() => setOpen(true)}>
                Resign
              </Button>
            ) : null
          }
        />
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Submit your resignation"
          description="HR and your manager get it straight away. HR confirms your last working day. Until then you can withdraw it here."
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="danger" disabled={reason.trim().length < 3} loading={resign.isPending} onClick={() => resign.mutate()}>
                Submit resignation
              </Button>
            </>
          }
        >
          <Field label="Reason">
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A short note for HR" />
          </Field>
          <Field label="Preferred last working day" hint="Leave blank to serve the full notice period">
            <Input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
          </Field>
        </Dialog>
      </Card>
    );

  const done = x.clearance.filter((c) => c.done).length;
  return (
    <Card className="!gap-3">
      <CardHeader
        title={x.typeLabel}
        sub={`${x.code} · last working day ${fmtDate(x.lastWorkingDay)}`}
        actions={<Tag tone={x.status === "settled" ? "neutral" : x.status === "requested" ? "accent" : "warn"}>{x.statusLabel}</Tag>}
      />
      {x.status === "requested" ? (
        <Notice tone="sel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Waiting for HR to accept. You can still withdraw it.</span>
            {!readOnly ? (
              <Button size="sm" loading={withdraw.isPending} onClick={() => void confirmAction({ title: "Withdraw your resignation?", body: "Your manager and HR will be told. You can resign again later if you need to.", confirmLabel: "Withdraw" }).then((ok) => ok && withdraw.mutate())}>
                Withdraw
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {x.status !== "requested" && x.status !== "settled" ? (
        <div className="text-[13px]">
          <div className="text-muted mb-1">
            Exit checklist: {done} of {x.clearance.length} done
          </div>
          {x.clearance.map((c) => (
            <div key={c.label} className={c.done ? "text-muted line-through" : ""}>
              {c.label}
            </div>
          ))}
        </div>
      ) : null}
      {x.settlement ? (
        <div className="text-[13px]">
          <div className="mb-1 font-medium">Full and final settlement</div>
          {x.settlement.lines.map((l) => (
            <div key={l.key} className="flex justify-between border-b border-[var(--color-divider)] py-1">
              <span>{l.label}</span>
              <span className="num">
                {l.kind === "deduction" ? "−" : ""}
                {inr(l.amount)}
              </span>
            </div>
          ))}
          <div className="flex justify-between py-1.5 font-medium">
            <span>{x.settlement.net >= 0 ? "Net payable to you" : "Net recoverable from you"}</span>
            <span className="num">{inr(Math.abs(x.settlement.net))}</span>
          </div>
          <div className="text-muted text-[12px]">{x.settledOn ? `Settled on ${fmtDate(x.settledOn)}.` : "Approved. Payment is on its way."} Your last month's salary comes on your payslip as usual.</div>
        </div>
      ) : null}
    </Card>
  );
}
