import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MATERNITY_EVENT_LABELS, MATERNITY_EVENTS, fmtDate, fmtMoney, todayLocal, type MaternityEvent } from "@hrms/shared";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Lookups } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { SearchSelect } from "@/components/ui/search-select";

interface Benefit {
  eligible: boolean;
  reasons: string[];
  weeks: number;
  beforeWeeks: number;
  startDate: string;
  endDate: string;
  days: number;
  averageDailyWage: number;
  amount: number;
  paidBy: "esi" | "employer";
  employerPays: number;
  medicalBonus: number;
  daysWorkedLast12Months: number;
  wageMonths: number;
}

/** Maternity benefit, women's night shift consent and health checks from 40. */
export default function Workplace() {
  return (
    <>
      <Maternity />
      <NightShifts />
      <HealthChecks />
    </>
  );
}

function Maternity() {
  const { can } = useSession();
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
  const [f, setF] = useState({ employeeId: "", event: "delivery" as MaternityEvent, eventDate: "", startDate: "", survivingChildren: "0", freeMedicalCare: false });
  const ready = !!f.employeeId && !!f.eventDate;
  const query = { event: f.event, eventDate: f.eventDate, ...(f.startDate ? { startDate: f.startDate } : {}), survivingChildren: f.survivingChildren, freeMedicalCare: String(f.freeMedicalCare) };
  const q = useQuery({ queryKey: ["maternity", f], queryFn: () => api.get<Benefit>(`/admin/compliance/workplace/maternity/${f.employeeId}${qs(query)}`), enabled: ready, retry: false });
  const grant = useMutation({
    mutationFn: () => api.post<{ requests: string[] }>(`/admin/compliance/workplace/maternity/${f.employeeId}`, { ...query, survivingChildren: Number(f.survivingChildren), freeMedicalCare: f.freeMedicalCare, startDate: f.startDate || null }),
    onSuccess: (r) => {
      toast.success(`Maternity leave granted (${r.requests.join(", ")})`);
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const b = q.data;
  return (
    <Card className="!gap-4">
      <CardHeader title="Maternity benefit" sub="Under the Code on Social Security: 26 weeks for a first or second child (up to 8 before the due date), 12 weeks after that or for adoption and surrogacy, 6 weeks after a miscarriage. She needs 80 days worked in the 12 months before. ESIC pays women covered by ESI." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employee" className="sm:col-span-2">
          <SearchSelect value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} options={(lookups.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))} />
        </Field>
        <Field label="For">
          <Select value={f.event} onChange={(e) => setF({ ...f, event: e.target.value as MaternityEvent })}>
            {MATERNITY_EVENTS.map((x) => <option key={x} value={x}>{MATERNITY_EVENT_LABELS[x]}</option>)}
          </Select>
        </Field>
        <Field label={f.event === "delivery" ? "Expected delivery date" : f.event === "adoption" || f.event === "commissioning" ? "Handover date" : "Date"}><Input type="date" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} /></Field>
        {f.event === "delivery" ? (
          <>
            <Field label="Leave starts" hint="Blank for the earliest allowed"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Children she already has"><Input type="number" min={0} value={f.survivingChildren} onChange={(e) => setF({ ...f, survivingChildren: e.target.value })} /></Field>
          </>
        ) : null}
      </div>
      {f.event === "delivery" ? <Checkbox checked={f.freeMedicalCare} onChange={(v) => setF({ ...f, freeMedicalCare: v })} label="We provide free pre and post natal care (no medical bonus due)" /> : null}
      {!ready ? null : q.isLoading ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : b ? (
        <div className="flex flex-col gap-2">
          {b.reasons.map((r) => <Notice key={r} tone={b.eligible ? "warn" : "bad"}>{r}.</Notice>)}
          <div className="grid gap-2 text-[14px] sm:grid-cols-2">
            <div>Days worked in the 12 months before: <b className="num">{b.daysWorkedLast12Months}</b></div>
            <div>Leave: <b>{b.weeks} weeks</b>, {fmtDate(b.startDate)} to {fmtDate(b.endDate)}</div>
            <div>Average daily wage{b.wageMonths ? ` (last ${b.wageMonths} paid months)` : " (from CTC)"}: <b className="num">{fmtMoney(b.averageDailyWage)}</b></div>
            <div>Benefit: <b className="num">{fmtMoney(b.amount)}</b> {b.paidBy === "esi" ? <Tag tone="accent">ESIC pays</Tag> : <Tag>Company pays</Tag>}</div>
            {b.medicalBonus ? <div>Medical bonus: <b className="num">{fmtMoney(b.medicalBonus)}</b>, add it to her next pay</div> : null}
          </div>
          <div className="text-muted text-[12.5px]">{b.paidBy === "esi" ? "The leave goes in as unpaid in payroll, because ESIC pays her. Help her claim through the ESIC portal." : "The leave goes in as paid leave, so her salary continues through payroll."} After it, she can ask to work from home if the work allows, and gets two nursing breaks a day until the child is 15 months old. With 50 or more employees, you need a crèche.</div>
          {can("leave", "approve") && b.eligible ? <div><Button variant="primary" loading={grant.isPending} onClick={() => grant.mutate()}>Grant maternity leave</Button></div> : null}
        </div>
      ) : null}
    </Card>
  );
}

function NightShifts() {
  const q = useQuery({ queryKey: ["night-shifts"], queryFn: () => api.get<{ rows: { employeeId: string; code: string; name: string; shift: string; from: string; consent: boolean }[]; missing: number }>("/admin/compliance/workplace/night-shifts") });
  return (
    <Card className="!gap-3">
      <CardHeader title="Women on night shifts" sub="Under the OSH Code, women can work before 6 am or after 7 pm only with written consent, plus the safety and transport your state requires. This lists usual shifts and the next 30 days of the roster." actions={q.data?.missing ? <Tag tone="bad">{q.data.missing} without consent</Tag> : undefined} />
      {q.isLoading ? <Loading /> : !q.data?.rows.length ? <div className="text-muted text-[13.5px]">No women are on shifts outside 6 am to 7 pm.</div> : q.data.rows.map((r) => (
        <div key={r.employeeId} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
          <span><Link to={`/employees/${r.employeeId}`} className="font-semibold">{r.name}</Link> <span className="text-muted">{r.code} · {r.shift} · {r.from}</span></span>
          {r.consent ? <Tag tone="ok">Consent on file</Tag> : <Link to={`/employees/${r.employeeId}/edit`} className="btn !px-2.5 !py-1 text-[13px]">Record consent</Link>}
        </div>
      ))}
    </Card>
  );
}

function HealthChecks() {
  const q = useQuery({ queryKey: ["health-checks"], queryFn: () => api.get<{ rows: { employeeId: string; code: string; name: string; age: number; lastCheck: string | null; due: boolean; nextBy: string | null }[]; due: number }>("/admin/compliance/workplace/health-checks") });
  const today = todayLocal();
  return (
    <Card className="!gap-3">
      <CardHeader title="Yearly health checks" sub="The OSH Code asks for a free health check every year for employees who are 40 or older. Record the date on the employee's statutory details." actions={q.data?.due ? <Tag tone="warn">{q.data.due} due</Tag> : undefined} />
      {q.isLoading ? <Loading /> : !q.data?.rows.length ? <div className="text-muted text-[13.5px]">Nobody is 40 or older yet, or dates of birth are missing.</div> : q.data.rows.slice(0, 50).map((r) => (
        <div key={r.employeeId} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
          <span><Link to={`/employees/${r.employeeId}`} className="font-semibold">{r.name}</Link> <span className="text-muted">{r.code} · {r.age} · last check {r.lastCheck ? fmtDate(r.lastCheck) : "none on file"}</span></span>
          {r.due ? <Tag tone="warn">{r.nextBy && r.nextBy < today ? `Due since ${fmtDate(r.nextBy)}` : "Due"}</Tag> : <Tag tone="ok">Next by {fmtDate(r.nextBy!)}</Tag>}
        </div>
      ))}
    </Card>
  );
}
