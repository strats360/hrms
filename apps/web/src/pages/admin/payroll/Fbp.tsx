import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { FBP_SUGGESTED_HEADS, fbpSettingsSchema, fmtMoney, fyOfMonth, todayLocal, type FbpHead, type FbpSettings } from "@hrms/shared";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { ReasonDialog } from "@/components/ui/reason-dialog";

interface Row {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  allocations: Record<string, number>;
  total: number;
  status: "submitted" | "approved" | "rejected";
  note: string | null;
}
interface Data {
  fy: string;
  settings: FbpSettings | null;
  rows: Row[];
}

const STATUS = { submitted: { label: "Waiting", tone: "warn" }, approved: { label: "Approved", tone: "ok" }, rejected: { label: "Sent back", tone: "bad" } } as const;

/** Flexible benefit plan: the heads employees can pick from, and their plans to approve. */
export default function Fbp() {
  const { can } = useSession();
  const qc = useQueryClient();
  const current = fyOfMonth(todayLocal().slice(0, 7));
  const [fy, setFy] = useState(current);
  const q = useQuery({ queryKey: ["fbp-admin", fy], queryFn: () => api.get<Data>(`/admin/payroll/fbp${qs({ fy })}`) });
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<{ settings: { fbp?: FbpSettings } }>("/admin/org/tenant") });
  const [sendBack, setSendBack] = useState<Row | null>(null);
  const [draft, setDraft] = useState<FbpSettings>({ enabled: false, autoApprove: false, heads: [] });
  useEffect(() => {
    if (tenant.data) setDraft(tenant.data.settings?.fbp ?? { enabled: false, autoApprove: false, heads: FBP_SUGGESTED_HEADS });
  }, [tenant.data]);
  const configurable = can("settings", "configure");
  const editable = can("payroll", "edit");
  const setHead = (i: number, p: Partial<FbpHead>) => setDraft((d) => ({ ...d, heads: d.heads.map((h, j) => (j === i ? { ...h, ...p } : h)) }));

  const saveSettings = useMutation({
    mutationFn: async () => {
      const parsed = fbpSettingsSchema.safeParse(draft);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the benefits");
      return api.patch("/admin/org/settings", { fbp: parsed.data });
    },
    onSuccess: () => {
      toast.success("Flexible benefits saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
      qc.invalidateQueries({ queryKey: ["fbp-admin"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: (b: { id: string; decision: "approved" | "rejected"; note?: string }) => api.post(`/admin/payroll/fbp/${b.id}/decision`, { decision: b.decision, note: b.note }),
    onSuccess: (_r, b) => {
      toast.success(b.decision === "approved" ? "Plan approved" : "Plan sent back");
      qc.invalidateQueries({ queryKey: ["fbp-admin"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const heads = q.data?.settings?.heads ?? draft.heads;
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "emp", header: "Employee", accessorFn: (r) => r.name, cell: ({ row: { original: r } }) => <span><b className="font-semibold">{r.name}</b> <span className="text-muted">{r.code}</span></span> },
      { id: "plan", header: "Plan", enableSorting: false, cell: ({ row: { original: r } }) => Object.entries(r.allocations).map(([k, v]) => `${heads.find((h) => h.code === k)?.label ?? k} ${fmtMoney(v)}`).join(" · ") },
      { id: "total", header: "A year", accessorFn: (r) => r.total, cell: ({ row: { original: r } }) => <span className="num">{fmtMoney(r.total)}</span> },
      { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => <Tag tone={STATUS[r.status].tone} title={r.note ?? undefined}>{STATUS[r.status].label}</Tag> },
      {
        id: "act",
        header: "",
        enableSorting: false,
        cell: ({ row: { original: r } }) =>
          editable && r.status !== "approved" ? (
            <div className="flex justify-end gap-2">
              {r.status === "submitted" ? (
                <Button size="sm" onClick={() => setSendBack(r)}>
                  Send back
                </Button>
              ) : null}
              <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>Approve</Button>
            </div>
          ) : null,
      },
    ],
    [heads, editable, decide],
  );

  if (q.isLoading || tenant.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const prev = `${Number(current.slice(0, 4)) - 1}-${current.slice(2, 4)}`;

  return (
    <>
      <Card className="!gap-4">
        <CardHeader
          title="Flexible benefits"
          sub="Employees move part of their special allowance into these benefits and claim them against bills, tax free. What they don't claim by the end of the year, or by their last day, is paid with salary and taxed. Link each benefit to an expense category under Reimbursements so claims come out of it."
          actions={configurable ? <Button variant="primary" loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save</Button> : undefined}
        />
        <div className="flex flex-wrap gap-5">
          <Checkbox checked={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} disabled={!configurable} label="Offer flexible benefits" />
          <Checkbox checked={draft.autoApprove} onChange={(v) => setDraft((d) => ({ ...d, autoApprove: v }))} disabled={!configurable} label="Approve plans as soon as they're submitted" />
        </div>
        {draft.heads.map((h, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1.6fr_1fr_auto_auto]">
            <Field label="Benefit"><Input value={h.label} onChange={(e) => setHead(i, { label: e.target.value })} disabled={!configurable} /></Field>
            <Field label="Most a year (₹)"><Input inputMode="numeric" value={h.annualCap} onChange={(e) => setHead(i, { annualCap: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} disabled={!configurable} /></Field>
            <div className="pb-2"><Checkbox checked={h.newRegime} onChange={(v) => setHead(i, { newRegime: v })} disabled={!configurable} label="Saves tax in the new regime" /></div>
            {configurable ? (
              <Button size="sm" variant="ghost" aria-label={`Remove ${h.label}`} onClick={() => setDraft((d) => ({ ...d, heads: d.heads.filter((_, j) => j !== i) }))}>
                <Trash2 size={14} />
              </Button>
            ) : <span />}
          </div>
        ))}
        {configurable ? (
          <div>
            <Button size="sm" onClick={() => setDraft((d) => ({ ...d, heads: [...d.heads, { code: `benefit_${d.heads.length + 1}`, label: "", annualCap: 0, newRegime: true }] }))} disabled={draft.heads.length >= 12}>
              <Plus size={14} /> Add benefit
            </Button>
          </div>
        ) : null}
        <div className="text-muted text-[12px]">These limits are starting points. Check them with your tax advisor before you offer them.</div>
      </Card>

      {!q.data?.settings ? (
        <Notice tone="sel">Turn on flexible benefits and save to let employees submit plans from their Tax page.</Notice>
      ) : (
        <TableCard>
          <CardHeader
            className="pt-2"
            title="Employee plans"
            actions={
              <Select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
                <option value={current}>FY {current}</option>
                <option value={prev}>FY {prev}</option>
              </Select>
            }
          />
          <DataTable data={q.data.rows} columns={columns} getRowId={(r) => r.id} empty="No plans for this year yet" />
        </TableCard>
      )}
      <ReasonDialog
        open={!!sendBack}
        onOpenChange={(v) => !v && setSendBack(null)}
        title={sendBack ? `Send back ${sendBack.name}'s plan` : ""}
        confirmLabel="Send back"
        onConfirm={async (note) => {
          if (sendBack) await decide.mutateAsync({ id: sendBack.id, decision: "rejected", note });
          setSendBack(null);
        }}
      />
    </>
  );
}
