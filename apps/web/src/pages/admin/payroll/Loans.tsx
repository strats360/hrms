import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { inr, todayIST, type LoanPolicy } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { LoanDetailDialog } from "@/components/loans/LoanDetailDialog";
import { LOAN_TONE, METHOD_LABEL, monthLabel, type LoanList, type LoanRow } from "@/components/loans/types";

export default function Loans() {
  const { can } = useSession();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const q = useQuery({ queryKey: ["loans", "list", filter], queryFn: () => api.get<LoanList>(`/admin/payroll/loans?status=${filter}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColumnDef<LoanRow>[]>(
    () => [
      { id: "employee", header: "Employee", accessorFn: (r) => r.employeeName, cell: ({ row: { original: r } }) => <PersonCell employeeId={r.employeeId} name={r.employeeName ?? ""} sub={r.employeeCode} /> },
      { id: "code", header: "Loan", accessorKey: "code", cell: ({ row: { original: r } }) => <div>{r.code}<div className="text-muted text-[12px]">{r.typeLabel}</div></div> },
      { id: "amount", header: "Amount", accessorKey: "amount", meta: { align: "right" }, cell: ({ getValue }) => <span className="num">{inr(getValue<number>())}</span> },
      { id: "emi", header: "Monthly", accessorKey: "emi", meta: { align: "right" }, cell: ({ row: { original: r } }) => <span className="num">{inr(r.emi)}<div className="text-muted text-[12px]">{r.months} month{r.months === 1 ? "" : "s"}{r.interestPct ? ` · ${r.interestPct}%` : ""}</div></span> },
      { id: "left", header: "Left to recover", accessorKey: "outstanding", meta: { align: "right" }, cell: ({ row: { original: r } }) => (r.status === "active" ? <span className="num font-semibold">{inr(r.outstanding)}</span> : <span className="text-muted">—</span>) },
      { id: "next", header: "Next", accessorKey: "nextMonth", cell: ({ row: { original: r } }) => (r.status === "active" ? monthLabel(r.nextMonth) : r.status === "approved" ? `From ${monthLabel(r.startMonth)}` : "—") },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: r } }) => <Tag tone={LOAN_TONE[r.status]}>{r.statusLabel}</Tag> },
    ],
    [],
  );
  const s = q.data?.summary;
  return (
    <div className="flex flex-col gap-4">
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Waiting for approval" value={s?.requested ?? "—"} onClick={() => setFilter("open")} />
        <StatCard label="Being recovered" value={s?.active ?? "—"} />
        <StatCard label="Left to recover" value={s ? inr(s.outstanding) : "—"} />
        <StatCard label="Recovered each month" value={s ? inr(s.monthly) : "—"} meta="from salary, in payroll" />
      </div>
      <TableCard>
        <CardHeader
          className="py-2"
          title="Loans and advances"
          sub="Instalments come off salary automatically when payroll is calculated. Anything left when someone leaves is recovered in their full and final settlement."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PillTabs<"open" | "all"> value={filter} onChange={setFilter} tabs={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />
              {can("payroll", "edit") ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={15} /> New loan or advance
                </Button>
              ) : null}
            </div>
          }
        />
        <DataTable data={q.data?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => setOpen(r.id)} storageKey="loans" empty={filter === "open" ? "No loans or advances are open." : "No loans or advances yet."} />
      </TableCard>
      {q.data && can("payroll", "configure") ? <PolicyCard policy={q.data.policy} /> : null}
      {open ? <LoanDetailDialog id={open} onClose={() => setOpen(null)} /> : null}
      {creating && q.data ? <NewLoanDialog firstOpenMonth={q.data.firstOpenMonth} interestPct={q.data.policy.loanInterestPct} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewLoanDialog({ firstOpenMonth, interestPct, onClose }: { firstOpenMonth: string; interestPct: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [emp, setEmp] = useState<{ id: string; fullName: string; employeeCode: string } | null>(null);
  const [f, setF] = useState({ type: "advance", amount: "", months: "1", interestPct: "0", startMonth: firstOpenMonth, reason: "", paid: true, paidOn: todayIST(), method: "bank_transfer", reference: "" });
  const hits = useQuery({ queryKey: ["employees", "pick", search], queryFn: () => api.get<{ rows: { id: string; fullName: string; employeeCode: string }[] }>(`/admin/employees?q=${encodeURIComponent(search)}&pageSize=6`), enabled: search.trim().length >= 2 && !emp });
  const save = useMutation({
    mutationFn: () =>
      api.post("/admin/payroll/loans", { employeeId: emp!.id, type: f.type, amount: Number(f.amount), months: Number(f.months), interestPct: f.type === "loan" ? Number(f.interestPct) : 0, startMonth: f.startMonth, reason: f.reason.trim(), ...(f.paid ? { paid: { paidOn: f.paidOn, method: f.method, reference: f.reference || null } } : {}) }),
    onSuccess: () => {
      toast.success(`Added for ${emp!.fullName}`);
      qc.invalidateQueries({ queryKey: ["loans"] });
      onClose();
    },
  });
  const emi = Number(f.amount) && Number(f.months) ? Math.ceil(Number(f.amount) / Number(f.months)) : 0;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="New loan or advance"
      description="Recovery starts from the first month whose payroll isn't locked yet."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!emp || !Number(f.amount) || !Number(f.months) || f.reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Employee">
          {emp ? (
            <div className="input flex items-center justify-between">
              <span>
                {emp.fullName} <span className="text-muted">· {emp.employeeCode}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEmp(null)}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <Input autoFocus placeholder="Search by name or employee ID" value={search} onChange={(e) => setSearch(e.target.value)} />
              {hits.data?.rows.length ? (
                <div className="card elev-md absolute inset-x-0 top-[calc(100%+4px)] z-10 !gap-0 !p-1">
                  {hits.data.rows.map((h) => (
                    <button key={h.id} type="button" className="cursor-pointer rounded-[var(--radius-sm)] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--tint-1)]" onClick={() => setEmp(h)}>
                      {h.fullName} <span className="text-muted">· {h.employeeCode}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, interestPct: e.target.value === "loan" ? String(interestPct) : "0" })}>
              <option value="advance">Salary advance</option>
              <option value="loan">Loan</option>
            </Select>
          </Field>
          <Field label="Amount (₹)"><Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Repay over (months)" hint={emi && f.type === "advance" ? `About ${inr(emi)} a month` : undefined}><Input type="number" min={1} max={120} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
          {f.type === "loan" ? <Field label="Interest % a year" hint="0 for interest-free"><Input type="number" min={0} max={36} step={0.25} value={f.interestPct} onChange={(e) => setF({ ...f, interestPct: e.target.value })} /></Field> : null}
          <Field label="First recovery"><Input type="month" min={firstOpenMonth} value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Medical emergency" /></Field>
        <Checkbox checked={f.paid} onChange={(v) => setF({ ...f, paid: v })} label="Already paid out" />
        {f.paid ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid on"><Input type="date" max={todayIST()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
            <Field label="How">
              <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
                {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UTR or cheque no." /></Field>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function PolicyCard({ policy }: { policy: LoanPolicy }) {
  const qc = useQueryClient();
  const [p, setP] = useState(policy);
  useEffect(() => setP(policy), [policy]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/payroll/loans/policy", p),
    onSuccess: () => (toast.success("Loan rules saved"), qc.invalidateQueries({ queryKey: ["loans"] })),
  });
  const num = (k: keyof LoanPolicy) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  return (
    <Card className="!gap-3">
      <CardHeader title="Loan rules" sub="Limits for what employees can ask for in self-service. HR can still add any amount directly." />
      <Checkbox checked={p.requests} onChange={(v) => setP({ ...p, requests: v })} label="Employees can ask for advances and loans in self-service" />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Advance up to (% of monthly gross)"><Input type="number" min={10} max={300} value={p.advanceMaxPctOfGross} onChange={num("advanceMaxPctOfGross")} /></Field>
        <Field label="Advance repaid within (months)"><Input type="number" min={1} max={12} value={p.advanceMaxMonths} onChange={num("advanceMaxMonths")} /></Field>
        <Field label="Loan up to (months of gross)"><Input type="number" min={1} max={36} value={p.loanMaxMonthsOfGross} onChange={num("loanMaxMonthsOfGross")} /></Field>
        <Field label="Loan repaid within (months)"><Input type="number" min={1} max={120} value={p.loanMaxMonths} onChange={num("loanMaxMonths")} /></Field>
        <Field label="Loan interest (% a year)"><Input type="number" min={0} max={36} step={0.25} value={p.loanInterestPct} onChange={num("loanInterestPct")} /></Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted text-[12px]">Interest-free or low-interest loans above ₹2 lakh in total are a taxable perquisite for the employee (Rule 3(7)(i)).</div>
        <Button variant="primary" disabled={JSON.stringify(p) === JSON.stringify(policy)} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}
