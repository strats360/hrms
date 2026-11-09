import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, Repeat } from "lucide-react";
import { inr } from "@hrms/shared";
import { api, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { EmployeeTax, Form16Data } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { Avatar } from "@/components/ui/avatar";
import { TaxStatementView } from "@/components/tax/TaxStatementView";
import { Form16View } from "@/components/tax/Form16View";
import { monthLabel, printPayslip } from "@/components/payroll/Payslip";
import { useTdsSummary } from "./Summary";
import { currentFy, useFy } from "./shared";

export default function Computation() {
  const fy = useFy();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee");
  const summary = useTdsSummary(fy);
  const [search, setSearch] = useState("");
  const options = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (summary.data?.rows ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [summary.data, search]);
  const pick = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("employee", id);
    setParams(p);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="!w-[220px]" placeholder="Find employee" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find employee" />
        <Select className="!w-[300px] max-w-full" value={employeeId ?? ""} onChange={(e) => e.target.value && pick(e.target.value)} aria-label="Employee">
          <option value="">{summary.isLoading ? "Loading employees…" : `Choose an employee (${options.length})`}</option>
          {options.map((r) => (
            <option key={r.employeeId} value={r.employeeId}>
              {r.name} · {r.code}
            </option>
          ))}
        </Select>
      </div>
      {employeeId ? <EmployeeComputation id={employeeId} fy={fy} /> : <Empty title="Pick an employee" sub="See their tax computation statement, monthly deduction and regime comparison." />}
    </>
  );
}

function EmployeeComputation({ id, fy }: { id: string; fy: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tds", "employee", id, fy], queryFn: () => api.get<EmployeeTax>(`/admin/tds/employees/${id}${qs({ fy })}`) });
  const [doc, setDoc] = useState<"statement" | "form16" | null>(null);
  const switchRegime = useMutation({
    mutationFn: (regime: "new" | "old") => api.patch(`/admin/tds/employees/${id}/regime`, { regime, fy }),
    onSuccess: () => {
      toast.success("Regime changed. TDS updates from the next payroll run.");
      qc.invalidateQueries({ queryKey: ["tds"] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.statement;
  const other = s.regime === "new" ? "old" : "new";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="!gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={d.employee.name} size={44} tone="sel" />
            <div>
              <div className="text-[17px] font-semibold">{d.employee.name}</div>
              <div className="text-muted text-[12.5px]">
                {d.employee.code} · PAN {d.employee.pan ?? "not available"} · FY {fy}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tag tone="warn">{s.regime === "old" ? "Old" : "New"} regime</Tag>
            {can("tds", "edit") ? (
              <Button
                size="sm"
                loading={switchRegime.isPending}
                onClick={() => confirm(`Switch ${d.employee.name} to the ${other} regime for FY ${fy}? Only do this on the employee's written request.`) && switchRegime.mutate(other)}
              >
                <Repeat size={14} /> Switch regime
              </Button>
            ) : null}
          </div>
        </div>
        {d.declaration ? null : <Notice tone="sel">No declaration yet: TDS uses the {s.regime} regime with no investment deductions.</Notice>}
        <div className="card-kicker">Tax computation statement</div>
        <TaxStatementView s={s} />
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card className="!gap-2">
          <CardHeader title="Monthly deduction" />
          <Line label="Annual tax liability" value={s.tax.total} />
          {s.previousEmployerTds ? <Line label="TDS by previous employer" value={s.previousEmployerTds} /> : null}
          <Line label="Deducted so far (locked payroll)" value={d.deducted} />
          <Line label="Remaining liability" value={d.remaining} />
          {d.excess ? (
            <div className="rounded-[var(--radius-md)] px-3 py-2 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
              {inr(d.excess)} more than this year's tax has already been deducted, so no further TDS is due. The employee can claim the excess as a refund in their income tax return.
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-[var(--color-divider)] pt-2 font-semibold">
            <span>Estimated TDS · next {d.projectedMonths} month{d.projectedMonths === 1 ? "" : "s"}</span>
            <span className="num">{inr(d.monthlyEstimate)}</span>
          </div>
        </Card>
        <Card className="!gap-2">
          <div className="card-kicker">Regime comparison</div>
          <Line label="New regime" value={d.comparison.new} bold={d.comparison.better === "new"} />
          <Line label="Old regime (with declarations)" value={d.comparison.old} bold={d.comparison.better === "old"} />
          <div className="text-[13px]" style={{ color: "var(--ok-fg)" }}>
            {d.comparison.saving ? `The ${d.comparison.better} regime saves ${inr(d.comparison.saving)} this year.` : "Both regimes come to the same tax."}
          </div>
        </Card>
        <Card className="!gap-2">
          <CardHeader title="Month by month" />
          <div className="scroll-thin min-w-0 overflow-x-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Month</th>
                  <th />
                  <th style={{ textAlign: "right" }}>Taxable gross</th>
                  <th style={{ textAlign: "right" }}>TDS</th>
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <td className="whitespace-nowrap">{monthLabel(m.month)}</td>
                    <td>{m.status === "locked" ? <Tag tone="ok">Locked</Tag> : <Tag tone="neutral">Projected</Tag>}</td>
                    <td className="num text-right">{inr(m.gross)}</td>
                    <td className="num text-right">{m.status === "locked" ? inr(m.tds) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="!gap-2">
          <CardHeader title="Documents" />
          <Button className="justify-start" onClick={() => setDoc("statement")}>
            <FileText size={15} /> Tax computation statement
          </Button>
          <Button className="justify-start" onClick={() => setDoc("form16")}>
            <FileText size={15} /> Form 16{fy === currentFy() ? " (provisional)" : ""}
          </Button>
        </Card>
      </div>

      <Dialog
        open={doc === "statement"}
        onOpenChange={(o) => !o && setDoc(null)}
        title="Tax computation statement"
        width={760}
        footer={
          <>
            <Button onClick={() => setDoc(null)}>Close</Button>
            <Button variant="primary" onClick={printPayslip}>
              <Download size={16} /> Download PDF
            </Button>
          </>
        }
      >
        <div id="payslip-print">
          <div className="mb-3">
            <div className="card-kicker">Tax computation statement · FY {fy}</div>
            <div className="text-[18px] font-medium">{d.employee.name}</div>
            <div className="text-muted text-[12.5px]">
              {d.employee.code} · PAN {d.employee.pan ?? "not available"} · {s.regime === "old" ? "Old" : "New"} regime · includes projected salary for the rest of the year
            </div>
          </div>
          <TaxStatementView s={s} />
        </div>
      </Dialog>
      <Form16Dialog employeeId={doc === "form16" ? id : null} fy={fy} onClose={() => setDoc(null)} />
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-[13.5px] ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="num">{inr(value)}</span>
    </div>
  );
}

export function Form16Dialog({ employeeId, fy, onClose }: { employeeId: string | null; fy: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["tds", "form16", employeeId, fy], queryFn: () => api.get<Form16Data>(`/admin/tds/form16/${employeeId}${qs({ fy })}`), enabled: !!employeeId });
  return (
    <Dialog
      open={!!employeeId}
      onOpenChange={(o) => !o && onClose()}
      title="Form 16"
      description={q.data?.provisional ? "Provisional: based on payroll locked so far. The final certificate is issued after March payroll and the Q4 return." : undefined}
      width={820}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!q.data} onClick={() => download(`/admin/tds/form16/${employeeId}/pdf${qs({ fy })}`, `form16-${fy}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
            <Download size={16} /> Download PDF
          </Button>
        </>
      }
    >
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data ? (
        <div id="payslip-print">
          <Form16View f={q.data} />
        </div>
      ) : null}
    </Dialog>
  );
}
