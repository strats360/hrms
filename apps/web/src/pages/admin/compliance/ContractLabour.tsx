import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { CONTRACT_LABOUR_THRESHOLD, fmtDate, fmtMoney, todayLocal } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Lookups } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Month { month: string; workers: number; wagesPaidOn: string | null; pfChallan: string | null; esiChallan: string | null }
interface Row {
  contractorId: string;
  name: string;
  labourLicence: string | null;
  licenceValidUntil: string | null;
  workNature: string | null;
  branchId: string | null;
  branch: string | null;
  contractFrom: string | null;
  contractTo: string | null;
  workers: number;
  issues: string[];
  months: Month[];
}
interface Data { rows: Row[]; others: { id: string; name: string }[]; total: number; peak: number; registrationNeeded: boolean }
interface Worker { id: string; name: string; gender: string; joinedOn: string; leftOn: string | null; dailyWage: number; uan: string | null; esicIpNumber: string | null }

const lastMonth = () => {
  const [y, m] = todayLocal().split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Contract labour under the OSH Code: contractors who supply workers, their workers, and monthly checks. */
export default function ContractLabour() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contract-labour"], queryFn: () => api.get<Data>("/admin/compliance/contract-labour") });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
  const [edit, setEdit] = useState<(Partial<Row> & { contractorId: string }) | null>(null);
  const [workersOf, setWorkersOf] = useState<Row | null>(null);
  const [monthOf, setMonthOf] = useState<{ row: Row; m: Month } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["contract-labour"] });
  const editable = can("compliance", "edit");

  const save = useMutation({
    mutationFn: (e: Partial<Row> & { contractorId: string; suppliesLabour?: boolean }) =>
      api.put(`/admin/compliance/contract-labour/contractors/${e.contractorId}`, { suppliesLabour: e.suppliesLabour ?? true, labourLicence: e.labourLicence || null, licenceValidUntil: e.licenceValidUntil || null, workNature: e.workNature || null, branchId: e.branchId || null, contractFrom: e.contractFrom || null, contractTo: e.contractTo || null }),
    onSuccess: () => {
      setEdit(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveMonth = useMutation({
    mutationFn: (x: { row: Row; m: Month }) => api.put(`/admin/compliance/contract-labour/contractors/${x.row.contractorId}/months`, { ...x.m, wagesPaidOn: x.m.wagesPaidOn || null, pfChallan: x.m.pfChallan || null, esiChallan: x.m.esiChallan || null }),
    onSuccess: () => {
      toast.success("Month recorded");
      setMonthOf(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <>
      <Card className="!gap-3">
        <CardHeader
          title="Contract labour"
          sub={`Contractors who supply workers to your premises. With ${CONTRACT_LABOUR_THRESHOLD} or more contract workers on any day in the last year you register as a principal employer, and a contractor with ${CONTRACT_LABOUR_THRESHOLD} or more needs a licence. Each month, check that wages were paid by the 7th and PF and ESI were deposited; if the contractor doesn't pay, you must.`}
          actions={<Button onClick={() => void download("/admin/compliance/contract-labour/register.csv", "contract-workers.csv").catch((e) => toast.error(errorMessage(e)))}><Download size={14} /> Register of workers</Button>}
        />
        <div className="flex flex-wrap gap-3 text-[14px]">
          <span>{d.total} contract workers today</span>
          <span className="text-muted">· most in the last year: {d.peak}</span>
          {d.registrationNeeded ? <Tag tone="warn">Register as a principal employer</Tag> : null}
        </div>
        {editable && d.others.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Add a contractor who supplies workers">
              <Select value="" onChange={(e) => e.target.value && setEdit({ contractorId: e.target.value, name: d.others.find((o) => o.id === e.target.value)?.name })}>
                <option value="">Pick from your contractors</option>
                {d.others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <span className="text-muted pb-2 text-[12.5px]">Add new contractors under Payroll, Contractors.</span>
          </div>
        ) : null}
      </Card>

      {d.rows.map((r) => (
        <Card key={r.contractorId} className="!gap-3">
          <CardHeader
            title={r.name}
            sub={[r.workNature, r.branch, r.labourLicence ? `licence ${r.labourLicence}${r.licenceValidUntil ? ` to ${fmtDate(r.licenceValidUntil)}` : ""}` : "no licence on file", r.contractTo ? `contract to ${fmtDate(r.contractTo)}` : null].filter(Boolean).join(" · ")}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setWorkersOf(r)}>{r.workers} workers</Button>
                {editable ? <Button size="sm" onClick={() => setMonthOf({ row: r, m: r.months.find((m) => m.month === lastMonth()) ?? { month: lastMonth(), workers: r.workers, wagesPaidOn: "", pfChallan: "", esiChallan: "" } })}>Record a month</Button> : null}
                {editable ? <Button size="sm" onClick={() => setEdit(r)}>Edit</Button> : null}
              </div>
            }
          />
          {r.issues.length ? <Notice tone="warn">{r.issues.join(". ")}.</Notice> : <Tag tone="ok" className="self-start">All checks pass</Tag>}
          {r.months.length ? (
            <div className="text-muted flex flex-col gap-0.5 text-[12.5px]">
              {r.months.map((m) => <span key={m.month}>{m.month}: {m.workers} workers · wages {m.wagesPaidOn ? `paid ${fmtDate(m.wagesPaidOn)}` : "not confirmed"} · PF {m.pfChallan ?? "missing"} · ESI {m.esiChallan ?? "missing"}</span>)}
            </div>
          ) : null}
        </Card>
      ))}

      {edit ? (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)} title={edit.name ?? "Contractor"} footer={
          <>
            {d.rows.some((r) => r.contractorId === edit.contractorId) ? <Button onClick={() => save.mutate({ ...edit, suppliesLabour: false })}>Stop tracking</Button> : null}
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(edit)}>Save</Button>
          </>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nature of work" span><Input value={edit.workNature ?? ""} onChange={(e) => setEdit({ ...edit, workNature: e.target.value })} placeholder="Housekeeping, security, loading" /></Field>
            <Field label="Work site">
              <Select value={edit.branchId ?? ""} onChange={(e) => setEdit({ ...edit, branchId: e.target.value })}>
                <option value="">Not set</option>
                {(lookups.data?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Licence number"><Input value={edit.labourLicence ?? ""} onChange={(e) => setEdit({ ...edit, labourLicence: e.target.value })} /></Field>
            <Field label="Licence valid until"><Input type="date" value={edit.licenceValidUntil ?? ""} onChange={(e) => setEdit({ ...edit, licenceValidUntil: e.target.value })} /></Field>
            <Field label="Contract from"><Input type="date" value={edit.contractFrom ?? ""} onChange={(e) => setEdit({ ...edit, contractFrom: e.target.value })} /></Field>
            <Field label="Contract to"><Input type="date" value={edit.contractTo ?? ""} onChange={(e) => setEdit({ ...edit, contractTo: e.target.value })} /></Field>
          </div>
        </Dialog>
      ) : null}

      {monthOf ? (
        <Dialog open onOpenChange={(v) => !v && setMonthOf(null)} title={`${monthOf.row.name}: monthly check`} footer={<><Button onClick={() => setMonthOf(null)}>Cancel</Button><Button variant="primary" loading={saveMonth.isPending} onClick={() => saveMonth.mutate(monthOf)}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Month"><Input type="month" value={monthOf.m.month} onChange={(e) => setMonthOf({ ...monthOf, m: { ...monthOf.m, month: e.target.value } })} /></Field>
            <Field label="Workers"><Input type="number" value={monthOf.m.workers} onChange={(e) => setMonthOf({ ...monthOf, m: { ...monthOf.m, workers: Number(e.target.value) || 0 } })} /></Field>
            <Field label="Wages paid on" hint="By the 7th of the next month"><Input type="date" value={monthOf.m.wagesPaidOn ?? ""} onChange={(e) => setMonthOf({ ...monthOf, m: { ...monthOf.m, wagesPaidOn: e.target.value } })} /></Field>
            <div />
            <Field label="PF challan (TRRN)"><Input value={monthOf.m.pfChallan ?? ""} onChange={(e) => setMonthOf({ ...monthOf, m: { ...monthOf.m, pfChallan: e.target.value } })} /></Field>
            <Field label="ESI challan number"><Input value={monthOf.m.esiChallan ?? ""} onChange={(e) => setMonthOf({ ...monthOf, m: { ...monthOf.m, esiChallan: e.target.value } })} /></Field>
          </div>
        </Dialog>
      ) : null}

      {workersOf ? <Workers row={workersOf} editable={editable} onClose={() => { setWorkersOf(null); refresh(); }} /> : null}
    </>
  );
}

function Workers({ row, editable, onClose }: { row: Row; editable: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contract-workers", row.contractorId], queryFn: () => api.get<{ rows: Worker[] }>(`/admin/compliance/contract-labour/contractors/${row.contractorId}/workers`) });
  const blank = { name: "", gender: "male", joinedOn: todayLocal(), dailyWage: "", uan: "", esicIpNumber: "" };
  const [f, setF] = useState(blank);
  const add = useMutation({
    mutationFn: () => api.post(`/admin/compliance/contract-labour/contractors/${row.contractorId}/workers`, { name: f.name, gender: f.gender, joinedOn: f.joinedOn, dailyWage: Number(f.dailyWage) || 0, uan: f.uan || null, esicIpNumber: f.esicIpNumber || null }),
    onSuccess: () => {
      setF(blank);
      qc.invalidateQueries({ queryKey: ["contract-workers", row.contractorId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const leave = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/compliance/contract-labour/workers/${id}`, { leftOn: todayLocal() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contract-workers", row.contractorId] }),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`${row.name}: workers`} width={720} footer={<Button onClick={onClose}>Close</Button>}>
      {q.isLoading ? <Loading /> : (
        <div className="flex flex-col gap-1.5">
          {(q.data?.rows ?? []).map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
              <span><b className="font-semibold">{w.name}</b> <span className="text-muted">{w.gender} · from {fmtDate(w.joinedOn)}{w.leftOn ? ` to ${fmtDate(w.leftOn)}` : ""} · {fmtMoney(w.dailyWage)} a day{w.uan ? "" : " · no UAN"}{w.esicIpNumber ? "" : " · no ESIC number"}</span></span>
              {editable && !w.leftOn ? <Button size="sm" onClick={() => leave.mutate(w.id)}>Left today</Button> : null}
            </div>
          ))}
          {!q.data?.rows.length ? <div className="text-muted text-[13.5px]">No workers yet.</div> : null}
        </div>
      )}
      {editable ? (
        <div className="mt-4 grid items-end gap-2 sm:grid-cols-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
              <option value="male">Man</option>
              <option value="female">Woman</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Joined"><Input type="date" value={f.joinedOn} onChange={(e) => setF({ ...f, joinedOn: e.target.value })} /></Field>
          <Field label="Daily wage"><Input inputMode="decimal" value={f.dailyWage} onChange={(e) => setF({ ...f, dailyWage: e.target.value })} /></Field>
          <Field label="UAN"><Input inputMode="numeric" value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value })} /></Field>
          <Field label="ESIC IP number"><Input inputMode="numeric" value={f.esicIpNumber} onChange={(e) => setF({ ...f, esicIpNumber: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Button variant="primary" loading={add.isPending} disabled={!f.name} onClick={() => add.mutate()}><Plus size={14} /> Add worker</Button></div>
        </div>
      ) : null}
    </Dialog>
  );
}
