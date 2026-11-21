import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { COMMITTEE_LABELS, committeeSchema, fmtDate, todayLocal, type CommitteeKind, type CommitteeMember } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Lookups } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { SearchSelect } from "@/components/ui/search-select";

interface Row {
  id: string;
  kind: CommitteeKind;
  name: string;
  entityId: string | null;
  constitutedOn: string;
  termEndsOn: string | null;
  members: (CommitteeMember & { employeeName: string | null; employeeCode: string | null })[];
  workshops: { date: string; title: string }[];
  problems: string[];
  cases: { open: number; total: number; overdue: number };
}
type Draft = { id?: string; kind: CommitteeKind; name: string; entityId: string; constitutedOn: string; termEndsOn: string; members: CommitteeMember[]; workshops: { date: string; title: string }[] };

const ROLE_LABELS = { presiding: "Presiding officer", chair: "Chairperson", member: "Member", external: "External member" } as const;

/** POSH Internal Committee and Grievance Redressal Committee. HR sets them up; only members see cases. */
export default function Committees() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["committees"], queryFn: () => api.get<{ rows: Row[] }>("/admin/compliance/committees") });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const editable = can("compliance", "configure");

  const save = useMutation({
    mutationFn: async () => {
      const d = draft!;
      const body = { kind: d.kind, name: d.name, entityId: d.entityId || null, constitutedOn: d.constitutedOn, termEndsOn: d.termEndsOn || null, members: d.members, workshops: d.workshops };
      const parsed = committeeSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the details");
      return d.id ? api.put<Row>(`/admin/compliance/committees/${d.id}`, parsed.data) : api.post<Row>("/admin/compliance/committees", parsed.data);
    },
    onSuccess: (r) => {
      toast.success(r.problems.length ? "Saved. Some requirements still aren't met." : "Committee saved");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["committees"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const rows = q.data?.rows ?? [];
  const start = (kind: CommitteeKind) =>
    setDraft({ kind, name: COMMITTEE_LABELS[kind], entityId: "", constitutedOn: todayLocal(), termEndsOn: "", workshops: [], members: kind === "posh_ic" ? [{ employeeId: null, role: "presiding", gender: "female" }, { employeeId: null, role: "member", gender: "female" }, { employeeId: null, role: "member", gender: "male" }, { name: "", role: "external", gender: "female" }] : [{ employeeId: null, role: "chair", gender: "male", side: "employer" }, { employeeId: null, role: "member", gender: "female", side: "worker" }] });
  const edit = (r: Row) => setDraft({ id: r.id, kind: r.kind, name: r.name, entityId: r.entityId ?? "", constitutedOn: r.constitutedOn, termEndsOn: r.termEndsOn ?? "", workshops: r.workshops, members: r.members.map(({ employeeName: _n, employeeCode: _c, ...m }) => m) });

  return (
    <>
      <Card className="!gap-3">
        <CardHeader
          title="Committees"
          sub="The POSH Internal Committee (10 or more employees) and the Grievance Redressal Committee (20 or more workers). Employees bring cases from self-service. Only the committee's members, and the person who filed, can read a case. You see counts."
          actions={editable ? (
            <div className="flex gap-2">
              <Button onClick={() => start("posh_ic")}><Plus size={14} /> POSH committee</Button>
              <Button onClick={() => start("grc")}><Plus size={14} /> Grievance committee</Button>
            </div>
          ) : undefined}
        />
        {!rows.length ? <div className="text-muted text-[13.5px]">No committees yet.</div> : null}
      </Card>
      {rows.map((r) => (
        <Card key={r.id} className="!gap-3">
          <CardHeader
            title={r.name}
            sub={`${COMMITTEE_LABELS[r.kind]} · constituted ${fmtDate(r.constitutedOn)}${r.termEndsOn ? ` · term ends ${fmtDate(r.termEndsOn)}` : ""}`}
            actions={
              <div className="flex gap-2">
                {r.kind === "posh_ic" ? <Button size="sm" onClick={() => setReport(r)}>Annual report</Button> : null}
                {editable ? <Button size="sm" onClick={() => edit(r)}>Edit</Button> : null}
              </div>
            }
          />
          {r.problems.length ? <Notice tone="warn">{r.problems.join(". ")}.</Notice> : <Tag tone="ok" className="self-start">Properly constituted</Tag>}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
            {r.members.map((m, i) => (
              <span key={i}>
                <b className="font-semibold">{m.employeeName ?? m.name}</b> <span className="text-muted">{ROLE_LABELS[m.role]}{m.side ? `, ${m.side} side` : ""}{m.organisation ? `, ${m.organisation}` : ""}</span>
              </span>
            ))}
          </div>
          <div className="text-muted text-[13px]">
            {r.cases.total} cases · {r.cases.open} open{r.cases.overdue ? ` · ${r.cases.overdue} past the ${r.kind === "posh_ic" ? "90" : "30"} day limit` : ""}
          </div>
        </Card>
      ))}

      {draft ? (
        <Dialog
          open
          onOpenChange={(v) => !v && setDraft(null)}
          title={draft.id ? `Edit ${draft.name}` : `New ${COMMITTEE_LABELS[draft.kind]}`}
          width={720}
          footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}
        >
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Legal entity">
                <Select value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}>
                  <option value="">The whole company</option>
                  {(lookups.data?.entities ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
              <Field label="Constituted on"><Input type="date" value={draft.constitutedOn} onChange={(e) => setDraft({ ...draft, constitutedOn: e.target.value })} /></Field>
              <Field label="Term ends on" hint={draft.kind === "posh_ic" ? "Three years at most" : undefined}><Input type="date" value={draft.termEndsOn} onChange={(e) => setDraft({ ...draft, termEndsOn: e.target.value })} /></Field>
            </div>
            <div className="card-kicker">Members</div>
            {draft.members.map((m, i) => {
              const set = (p: Partial<CommitteeMember>) => setDraft({ ...draft, members: draft.members.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_auto]">
                  {m.role === "external" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Name"><Input value={m.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
                      <Field label="Organisation"><Input value={m.organisation ?? ""} onChange={(e) => set({ organisation: e.target.value })} placeholder="NGO" /></Field>
                    </div>
                  ) : (
                    <Field label="Employee">
                      <SearchSelect value={m.employeeId ?? ""} onChange={(v) => set({ employeeId: v || null })} options={(lookups.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))} />
                    </Field>
                  )}
                  <Field label="Role">
                    <Select value={m.role} onChange={(e) => set({ role: e.target.value as CommitteeMember["role"], ...(e.target.value === "external" ? { employeeId: null } : {}) })}>
                      {(draft.kind === "posh_ic" ? (["presiding", "member", "external"] as const) : (["chair", "member"] as const)).map((x) => <option key={x} value={x}>{ROLE_LABELS[x]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Gender">
                    <Select value={m.gender} onChange={(e) => set({ gender: e.target.value as CommitteeMember["gender"] })}>
                      <option value="female">Woman</option>
                      <option value="male">Man</option>
                      <option value="other">Other</option>
                    </Select>
                  </Field>
                  {draft.kind === "grc" ? (
                    <Field label="Side">
                      <Select value={m.side ?? ""} onChange={(e) => set({ side: (e.target.value || null) as CommitteeMember["side"] })}>
                        <option value="employer">Employer</option>
                        <option value="worker">Workers</option>
                      </Select>
                    </Field>
                  ) : <span />}
                  <Button size="sm" variant="ghost" aria-label="Remove member" onClick={() => setDraft({ ...draft, members: draft.members.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
              );
            })}
            <div><Button size="sm" onClick={() => setDraft({ ...draft, members: [...draft.members, { employeeId: null, role: "member", gender: "female", ...(draft.kind === "grc" ? { side: "worker" as const } : {}) }] })}><Plus size={14} /> Add member</Button></div>
            {draft.kind === "posh_ic" ? (
              <>
                <div className="card-kicker">Awareness sessions</div>
                {draft.workshops.map((w, i) => (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <Input type="date" value={w.date} onChange={(e) => setDraft({ ...draft, workshops: draft.workshops.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} aria-label="Date" />
                    <Input value={w.title} onChange={(e) => setDraft({ ...draft, workshops: draft.workshops.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} aria-label="Session" placeholder="Awareness session for all staff" />
                    <Button size="sm" variant="ghost" aria-label="Remove session" onClick={() => setDraft({ ...draft, workshops: draft.workshops.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                ))}
                <div><Button size="sm" onClick={() => setDraft({ ...draft, workshops: [...draft.workshops, { date: todayLocal(), title: "" }] })}><Plus size={14} /> Add session</Button></div>
              </>
            ) : null}
          </div>
        </Dialog>
      ) : null}

      {report ? <AnnualReport row={report} onClose={() => setReport(null)} /> : null}
    </>
  );
}

function AnnualReport({ row, onClose }: { row: Row; onClose: () => void }) {
  const [year, setYear] = useState(Number(todayLocal().slice(0, 4)) - (todayLocal().slice(5, 7) === "01" ? 1 : 0));
  const q = useQuery({ queryKey: ["committees", "report", row.id, year], queryFn: () => api.get<{ received: number; disposed: number; pending: number; pendingOver90Days: number; workshops: number }>(`/admin/compliance/committees/${row.id}/annual-report?year=${year}`) });
  const lines: [string, number | undefined][] = [
    ["Complaints received in the year", q.data?.received],
    ["Complaints disposed of", q.data?.disposed],
    ["Cases pending at the end of the year", q.data?.pending],
    ["Pending for more than 90 days", q.data?.pendingOver90Days],
    ["Awareness programmes and workshops", q.data?.workshops],
  ];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="POSH annual report" description="For the District Officer, by 31 January. Add the nature of action taken from the committee's own records." footer={<Button onClick={onClose}>Close</Button>}>
      <Field label="Calendar year">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[0, 1, 2].map((n) => { const y = Number(todayLocal().slice(0, 4)) - n; return <option key={y} value={y}>{y}</option>; })}
        </Select>
      </Field>
      {q.isLoading ? <Loading /> : (
        <div className="mt-3 flex flex-col gap-1.5">
          {lines.map(([l, n]) => <div key={l} className="flex justify-between text-[14px]"><span>{l}</span><b className="num">{n ?? 0}</b></div>)}
        </div>
      )}
    </Dialog>
  );
}
