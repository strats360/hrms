import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Laptop } from "lucide-react";
import { ASSET_CATEGORY_LABEL, CONDITION_LABEL, fmtDate, ISSUE_LABEL, type AssetCategory, type Condition } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";

interface Mine {
  id: string;
  asset: { tag: string; name: string; category: AssetCategory; serialNumber: string | null; warrantyUntil: string | null };
  assignedOn: string;
  expectedReturn: string | null;
  conditionOut: Condition;
  noteOut: string | null;
  acknowledgedAt: string | null;
  returnedOn: string | null;
  conditionIn: Condition | null;
  issue: keyof typeof ISSUE_LABEL | null;
  issueNote: string | null;
}

/** What the company has given the employee. */
export function MyAssets() {
  const { has } = useSession();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["assets", "mine"], queryFn: () => api.get<Mine[]>("/ess/assets"), enabled: has("module.assets") });
  const [reporting, setReporting] = useState<Mine | null>(null);
  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/ess/assets/${id}/acknowledge`),
    onSuccess: () => (toast.success("Thanks for confirming"), qc.invalidateQueries({ queryKey: ["assets", "mine"] })),
  });
  useEffect(() => {
    if (params.get("tab") === "assets" && q.data) document.getElementById("assets")?.scrollIntoView({ behavior: "smooth" });
  }, [params, q.data]);
  const list = q.data ?? [];
  if (!has("module.assets") || !list.length) return null;
  const now = list.filter((a) => !a.returnedOn);
  const past = list.filter((a) => a.returnedOn);
  return (
    <Card className="!gap-2" id="assets">
      <CardHeader icon={<Laptop size={18} />} title="Company assets with me" sub={now.length ? `${now.length} item${now.length === 1 ? "" : "s"}. Return them when you leave.` : "Nothing with you right now."} />
      {now.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-divider)] py-2.5 last:border-b-0">
          <div className="min-w-0 text-[13.5px]">
            <div className="font-medium">{a.asset.name} <span className="text-muted num text-[12px]">{a.asset.tag}</span></div>
            <div className="text-muted text-[12.5px]">{[ASSET_CATEGORY_LABEL[a.asset.category], a.asset.serialNumber ? `serial ${a.asset.serialNumber}` : null, `since ${fmtDate(a.assignedOn)}`, a.expectedReturn ? `due back ${fmtDate(a.expectedReturn)}` : null].filter(Boolean).join(" · ")}</div>
            {a.noteOut ? <div className="text-muted text-[12.5px]">{a.noteOut}</div> : null}
            {a.issue ? <div className="text-[12.5px] text-[var(--bad)]">You reported: {ISSUE_LABEL[a.issue]}. HR has been told.</div> : null}
          </div>
          <div className="flex gap-2">
            {!a.acknowledgedAt ? <Button size="sm" variant="primary" loading={ack.isPending && ack.variables === a.id} onClick={() => ack.mutate(a.id)}>I have it</Button> : <Tag tone="ok">Confirmed</Tag>}
            <Button size="sm" onClick={() => setReporting(a)}>Report a problem</Button>
          </div>
        </div>
      ))}
      {past.length ? (
        <details className="text-[13px]">
          <summary className="text-muted cursor-pointer">Returned ({past.length})</summary>
          {past.map((a) => <div key={a.id} className="text-muted py-1">{a.asset.name} ({a.asset.tag}): {fmtDate(a.assignedOn)} to {fmtDate(a.returnedOn)}{a.conditionIn ? `, ${CONDITION_LABEL[a.conditionIn].toLowerCase()}` : ""}</div>)}
        </details>
      ) : null}
      {reporting ? <ReportDialog item={reporting} onClose={() => setReporting(null)} /> : null}
    </Card>
  );
}

function ReportDialog({ item, onClose }: { item: Mine; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<keyof typeof ISSUE_LABEL>(item.acknowledgedAt ? "damaged" : "not_received");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/ess/assets/${item.id}/report`, { kind, note }),
    onSuccess: () => (toast.success("Reported. HR will be in touch."), qc.invalidateQueries({ queryKey: ["assets", "mine"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`A problem with ${item.asset.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={note.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Tell HR</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="What happened"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Details"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="When and how, so HR can help" /></Field>
      </div>
    </Dialog>
  );
}
