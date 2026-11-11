import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Pencil } from "lucide-react";
import { ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, CONDITION_LABEL, fmtDate, inr, ISSUE_LABEL, type Condition } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Menu } from "@/components/ui/menu";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { AssetDialog, AssetStatusTag, AssignDialog, ReturnDialog, type Asset } from "./shared";

interface History {
  id: string;
  employee: { id: string; name: string; code: string };
  assignedOn: string;
  expectedReturn: string | null;
  conditionOut: Condition;
  noteOut: string | null;
  assignedBy: string | null;
  acknowledgedAt: string | null;
  returnedOn: string | null;
  conditionIn: Condition | null;
  noteIn: string | null;
  returnedBy: string | null;
  issue: keyof typeof ISSUE_LABEL | null;
  issueNote: string | null;
}

export default function AssetDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["assets", "one", id], queryFn: () => api.get<{ asset: Asset; history: History[] }>(`/admin/assets/${id}`) });
  const [dialog, setDialog] = useState<"edit" | "assign" | "return" | null>(null);
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/admin/assets/${id}/status`, { status: s }),
    onSuccess: () => (toast.success("Updated"), qc.invalidateQueries({ queryKey: ["assets"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { asset: a, history } = q.data;
  const open = history.find((h) => !h.returnedOn) ?? null;
  const edit = can("assets", "edit");
  const others = (["available", "in_repair", "retired", "lost"] as const).filter((s) => s !== a.status);
  return (
    <>
      <Link to="/assets" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All assets</Link>
      <PageHeader
        title={a.name}
        sub={[a.tag, ASSET_CATEGORY_LABEL[a.category], a.serialNumber ? `serial ${a.serialNumber}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <AssetStatusTag s={a.status} />
            {edit && a.status === "available" ? <Button variant="primary" onClick={() => setDialog("assign")}>Assign</Button> : null}
            {edit && open ? <Button variant="primary" onClick={() => setDialog("return")}>Take back</Button> : null}
            {edit && a.status !== "assigned" ? <Menu trigger={<Button>Mark as</Button>} items={others.map((s) => ({ label: ASSET_STATUS_LABEL[s], onSelect: () => status.mutate(s) }))} /> : null}
            {edit ? <Button onClick={() => setDialog("edit")}><Pencil size={15} /> Edit</Button> : null}
          </>
        }
      />
      {open?.issue ? <Notice tone="bad">{open.employee.name} reported: {ISSUE_LABEL[open.issue]}. {open.issueNote}</Notice> : null}
      {a.warranty === "ending" ? <Notice tone="warn">Warranty ends on {fmtDate(a.warrantyUntil)}.</Notice> : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="!gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13.5px]">
            <KV label="Condition">{CONDITION_LABEL[a.condition]}</KV>
            <KV label="With">{open ? <Link to={`/employees/${open.employee.id}`}>{open.employee.name}</Link> : "—"}</KV>
            <KV label="Bought">{a.purchaseDate ? fmtDate(a.purchaseDate) : "—"}</KV>
            <KV label="Cost">{a.purchaseCost != null ? inr(a.purchaseCost) : "—"}</KV>
            <KV label="Vendor">{a.vendor ?? "—"}</KV>
            <KV label="Invoice">{a.invoiceNumber ?? "—"}</KV>
            <KV label="Warranty until">{a.warrantyUntil ? fmtDate(a.warrantyUntil) : "—"}</KV>
          </div>
          {a.notes ? <div className="border-t border-[var(--color-divider)] pt-3 text-[13px]"><div className="text-muted text-[12px]">Notes</div><div className="whitespace-pre-line">{a.notes}</div></div> : null}
        </Card>
        <Card className="!gap-3">
          <CardHeader title="Who has had it" />
          {!history.length ? <div className="text-muted text-[13px]">Never given out.</div> : null}
          {history.map((h) => (
            <div key={h.id} className="flex flex-col gap-1 border-b border-[var(--color-divider)] pb-3 text-[13px] last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/employees/${h.employee.id}`} className="font-medium">{h.employee.name} <span className="text-muted">({h.employee.code})</span></Link>
                {h.returnedOn ? <span className="text-muted">{fmtDate(h.assignedOn)} to {fmtDate(h.returnedOn)}</span> : <Tag tone="accent">Since {fmtDate(h.assignedOn)}</Tag>}
              </div>
              <div className="text-muted">
                Given in {CONDITION_LABEL[h.conditionOut].toLowerCase()} condition{h.assignedBy ? ` by ${h.assignedBy}` : ""}{h.noteOut ? `. ${h.noteOut}` : ""}. {h.acknowledgedAt ? `Confirmed ${fmtDate(h.acknowledgedAt.slice(0, 10))}.` : "Not confirmed yet."}
                {h.expectedReturn && !h.returnedOn ? ` Due back ${fmtDate(h.expectedReturn)}.` : ""}
              </div>
              {h.issue ? <div className="text-[var(--bad)]">Reported: {ISSUE_LABEL[h.issue]}. {h.issueNote}</div> : null}
              {h.returnedOn ? <div className="text-muted">Back in {CONDITION_LABEL[h.conditionIn!].toLowerCase()} condition{h.returnedBy ? `, received by ${h.returnedBy}` : ""}{h.noteIn ? `. ${h.noteIn}` : ""}.</div> : null}
            </div>
          ))}
        </Card>
      </div>
      {dialog === "edit" ? <AssetDialog asset={a} onClose={() => setDialog(null)} /> : null}
      {dialog === "assign" ? <AssignDialog asset={a} onClose={() => setDialog(null)} /> : null}
      {dialog === "return" && open ? <ReturnDialog asset={a} holder={open.employee.name} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
