import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Lock, Plus, Settings, Trash2 } from "lucide-react";
import { AGENT_STATUS_LABEL, HELPDESK_TEAMS, PRIORITY_LABEL, TEAM_LABEL, TICKET_STATUSES, type HelpdeskCategory, type HelpdeskSettings, type HelpdeskTeam, type Priority, type TicketStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { StatusTag, whenShort } from "@/components/helpdesk/Thread";

interface Row {
  id: string;
  number: string;
  subject: string;
  categoryLabel: string;
  team: HelpdeskTeam;
  status: TicketStatus;
  priority: Priority;
  confidential: boolean;
  raiser: { id: string; name: string; code: string };
  assignee: { id: string; name: string } | null;
  responseDueAt: string;
  overdue: boolean;
  firstResponseAt: string | null;
  lastActivityAt: string;
}
interface Data { rows: Row[]; stats: { open: number; unassigned: number; overdue: number; avgFirstHours: number | null; onTime: number | null; rating: number | null }; isLead: boolean }
export const PRIORITY_TONE = { low: "outline", normal: "neutral", high: "warn", urgent: "bad" } as const;

export default function Helpdesk() {
  const nav = useNavigate();
  const [status, setStatus] = useState("open");
  const [team, setTeam] = useState("");
  const [mine, setMine] = useState(false);
  const [settings, setSettings] = useState(false);
  const qs = new URLSearchParams({ status, ...(team ? { team } : {}), ...(mine ? { mine: "1" } : {}) }).toString();
  const q = useQuery({ queryKey: ["helpdesk", "queue", qs], queryFn: () => api.get<Data>(`/admin/helpdesk?${qs}`) });
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "subject", header: "Ticket", accessorKey: "subject", cell: ({ row: { original: t } }) => <div className="max-w-[380px] whitespace-normal"><div className="flex items-center gap-1.5 font-medium">{t.confidential ? <Lock size={13} aria-label="Confidential" /> : null}{t.subject}</div><div className="text-muted text-[12px]">{t.number} · {t.categoryLabel}</div></div> },
      { id: "raiser", header: "From", accessorFn: (t) => t.raiser.name, cell: ({ row: { original: t } }) => <div>{t.raiser.name}<div className="text-muted text-[12px]">{t.raiser.code}</div></div> },
      { id: "team", header: "Team", accessorKey: "team", cell: ({ getValue }) => TEAM_LABEL[getValue<HelpdeskTeam>()] },
      { id: "priority", header: "Priority", accessorKey: "priority", cell: ({ getValue }) => <Tag tone={PRIORITY_TONE[getValue<Priority>()]}>{PRIORITY_LABEL[getValue<Priority>()]}</Tag> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: t } }) => <div><StatusTag s={t.status} label={AGENT_STATUS_LABEL[t.status]} />{t.overdue ? <div className="text-[12px] text-[var(--bad)]">Reply overdue</div> : !t.firstResponseAt && t.status === "open" ? <div className="text-muted text-[12px]">reply by {whenShort(t.responseDueAt)}</div> : null}</div> },
      { id: "assignee", header: "With", accessorFn: (t) => t.assignee?.name ?? "", cell: ({ getValue }) => getValue<string>() || <span className="text-muted">Unassigned</span> },
      { id: "updated", header: "Updated", accessorKey: "lastActivityAt", cell: ({ getValue }) => <span className="text-[12.5px]">{whenShort(getValue<string>())}</span> },
    ],
    [],
  );
  const s = q.data?.stats;
  return (
    <>
      <PageHeader title="Helpdesk" sub="Questions and requests from employees to HR, IT, Finance and Admin" actions={q.data?.isLead ? <Button onClick={() => setSettings(true)}><Settings size={16} /> Categories and teams</Button> : null} />
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Open" value={s.open} />
          <StatCard label="Unassigned" value={s.unassigned} />
          <StatCard label="Reply overdue" value={s.overdue} />
          <StatCard label="First reply, avg" value={s.avgFirstHours != null ? `${s.avgFirstHours}h` : "—"} meta={s.onTime != null ? `${s.onTime}% on time, 30 days` : undefined} />
          <StatCard label="Satisfaction" value={s.rating != null ? `${s.rating} / 5` : "—"} meta="last 90 days" />
        </div>
      ) : null}
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="Tickets" sub="Urgent and high priority first, then by reply deadline." />
        <DataTable
          data={q.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => nav(`/helpdesk/${r.id}`)}
          storageKey="helpdesk"
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-[170px]">
                <option value="open">All open</option>
                {TICKET_STATUSES.map((x) => <option key={x} value={x}>{AGENT_STATUS_LABEL[x]}</option>)}
                <option value="all">Everything</option>
              </Select>
              <Select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="!w-[170px]">
                <option value="">All my teams</option>
                {HELPDESK_TEAMS.map((x) => <option key={x} value={x}>{TEAM_LABEL[x]}</option>)}
              </Select>
              <Checkbox checked={mine} onChange={setMine} label="Assigned to me" />
            </div>
          }
          empty={status === "open" ? "Nothing open. Nice." : "No tickets match."}
        />
      </TableCard>
      {settings ? <SettingsDialog onClose={() => setSettings(false)} /> : null}
    </>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["helpdesk", "settings"], queryFn: () => api.get<{ settings: HelpdeskSettings; agents: { id: string; name: string; code: string }[] }>("/admin/helpdesk/settings") });
  const [draft, setDraft] = useState<HelpdeskSettings | null>(null);
  const s = draft ?? q.data?.settings ?? null;
  const save = useMutation({
    mutationFn: () => api.put("/admin/helpdesk/settings", s),
    onSuccess: () => (toast.success("Helpdesk settings saved"), qc.invalidateQueries({ queryKey: ["helpdesk"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setCat = (i: number, patch: Partial<HelpdeskCategory>) => s && setDraft({ ...s, categories: s.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Categories and teams" width={820} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!s} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {!s || !q.data ? null : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-[14px] font-medium">Categories</div>
            <div className="text-muted text-[12.5px]">What employees pick from, which team gets it, and how many hours the team has to reply. Urgent tickets get a quarter of the time, high half.</div>
            {s.categories.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_150px_90px_auto] items-center gap-2">
                <Input aria-label={`Category ${i + 1}`} value={c.label} onChange={(e) => setCat(i, { label: e.target.value })} />
                <Select aria-label={`Team for category ${i + 1}`} value={c.team} onChange={(e) => setCat(i, { team: e.target.value as HelpdeskTeam })}>{HELPDESK_TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}</Select>
                <Input aria-label={`Reply within hours, category ${i + 1}`} type="number" min={1} value={c.slaHours} onChange={(e) => setCat(i, { slaHours: Number(e.target.value) })} />
                <Button icon variant="ghost" aria-label={`Remove category ${i + 1}`} disabled={s.categories.length === 1} onClick={() => setDraft({ ...s, categories: s.categories.filter((_, j) => j !== i) })}><Trash2 size={15} /></Button>
              </div>
            ))}
            <div><Button size="sm" onClick={() => setDraft({ ...s, categories: [...s.categories, { key: `custom_${Date.now().toString(36)}`, label: "New category", team: "hr", slaHours: 24 }] })}><Plus size={14} /> Add category</Button></div>
          </div>
          <div className="flex flex-col gap-2 border-t border-[var(--color-divider)] pt-3">
            <div className="text-[14px] font-medium">Who works each queue</div>
            <div className="text-muted text-[12.5px]">They get an email for each new ticket and see their team's tickets. People need the Helpdesk permission in their role to appear here. With nobody listed, tickets go to helpdesk leads.</div>
            {HELPDESK_TEAMS.map((t) => (
              <Field key={t} label={TEAM_LABEL[t]}>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {q.data.agents.map((a) => <Checkbox key={a.id} checked={s.teams[t].includes(a.id)} onChange={(v) => setDraft({ ...s, teams: { ...s.teams, [t]: v ? [...s.teams[t], a.id] : s.teams[t].filter((x) => x !== a.id) } })} label={a.name} />)}
                </div>
              </Field>
            ))}
            <Field label="Close resolved tickets after (days)"><Input type="number" min={1} max={60} value={s.autoCloseDays} onChange={(e) => setDraft({ ...s, autoCloseDays: Number(e.target.value) })} className="!w-[120px]" /></Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}
