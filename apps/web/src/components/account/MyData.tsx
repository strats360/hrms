import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Download } from "lucide-react";
import { fmtDate, PRIVACY_STATUS_LABEL, type PrivacyRequestStatus } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";

interface Req {
  id: string;
  status: PrivacyRequestStatus;
  reason: string | null;
  dueDate: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}
interface Data {
  officer: { name: string | null; email: string | null };
  responseDays: number;
  erased: string[];
  kept: string[];
  blocker: string | null;
  requests: Req[];
}
const TONE: Record<PrivacyRequestStatus, Tone> = { pending: "warn", completed: "ok", rejected: "bad", cancelled: "neutral" };

export function WhatErasureMeans({ erased, kept }: { erased: string[]; kept: string[] }) {
  return (
    <div className="grid gap-3 text-[13px] sm:grid-cols-2">
      <div>
        <div className="mb-1 font-medium">Removed</div>
        <ul className="text-muted !m-0 flex flex-col gap-1 pl-5">{erased.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div>
        <div className="mb-1 font-medium">Kept, because the law requires it</div>
        <ul className="text-muted !m-0 flex flex-col gap-1 pl-5">{kept.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </div>
  );
}

/** Your rights under the DPDP Act: a copy of your data, and asking for it to be erased. */
export function MyDataCard() {
  const { tenant } = useSession();
  const qc = useQueryClient();
  const key = ["privacy", "mine", tenant?.tenantId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Data>("/ess/privacy"), enabled: !!tenant?.employeeId && !tenant.support });
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = useMutation({
    mutationFn: () => api.post("/ess/privacy/erasure", { reason }),
    onSuccess: () => (toast.success("Request sent to HR"), setAsking(false), setReason(""), qc.invalidateQueries({ queryKey: key })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.post(`/ess/privacy/erasure/${id}/cancel`, {}),
    onSuccess: () => (toast.success("Request withdrawn"), qc.invalidateQueries({ queryKey: key })),
  });
  if (!tenant?.employeeId || tenant.support) return null;
  const d = q.data;
  const open = d?.requests.find((r) => r.status === "pending");
  const last = d?.requests[0];

  const get = async () => {
    setBusy(true);
    try {
      await download("/ess/privacy/export", "my-data.zip");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="!gap-3">
      <CardHeader icon={<Database size={18} />} title="Your data" sub={`What ${tenant.tenantName} holds about you, under India's data protection law (DPDP Act).`} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-divider)] pb-3">
        <div className="min-w-0 text-[13px]">
          <div className="font-medium">Download a copy</div>
          <div className="text-muted text-[12.5px]">A zip with your profile, attendance, leave, pay, tax and claims records, and the files you uploaded.</div>
        </div>
        <Button onClick={get} loading={busy}>
          <Download size={15} /> Download my data
        </Button>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 text-[13px]">
            <div className="font-medium">Ask for your data to be erased</div>
            <div className="text-muted text-[12.5px]">HR answers within {d?.responseDays ?? 30} days. It happens once you've left and your full and final settlement is done.</div>
          </div>
          {open ? (
            <Button onClick={() => withdraw.mutate(open.id)} loading={withdraw.isPending}>Withdraw request</Button>
          ) : (
            <Button onClick={() => setAsking(true)} disabled={!d}>Ask HR to erase</Button>
          )}
        </div>
        {last ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={TONE[last.status]}>{PRIVACY_STATUS_LABEL[last.status]}</Tag>
              <span className="text-muted text-[12.5px]">Asked on {fmtDate(last.createdAt.slice(0, 10))}{last.status === "pending" && last.dueDate ? ` · answer due by ${fmtDate(last.dueDate)}` : ""}</span>
            </div>
            {last.decisionNote ? <div className="mt-1.5">HR: {last.decisionNote}</div> : null}
          </div>
        ) : null}
      </div>
      {d?.officer.name || d?.officer.email ? (
        <div className="text-muted text-[12.5px]">
          Questions or complaints about your data: {d.officer.name}
          {d.officer.email ? <> {d.officer.name ? "· " : ""}<a href={`mailto:${d.officer.email}`}>{d.officer.email}</a></> : null}
        </div>
      ) : null}
      {asking && d ? (
        <Dialog
          open
          onOpenChange={(v) => !v && setAsking(false)}
          title="Ask HR to erase your data"
          width={600}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="primary" loading={ask.isPending} onClick={() => ask.mutate()}>Send request</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {d.blocker ? <Notice tone="warn">{d.blocker}. You can still ask now, and HR will tell you when it can be done.</Notice> : null}
            <WhatErasureMeans erased={d.erased} kept={d.kept} />
            <Notice tone="sel">Download a copy first if you want one. After erasure you won't be able to sign in to {tenant.tenantName}.</Notice>
            <Field label="Anything HR should know (optional)">
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
