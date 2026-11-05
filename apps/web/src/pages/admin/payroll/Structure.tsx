import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, inr } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { SalaryTemplate, Structure } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { EmployeeStructureDialog } from "@/components/payroll/structure/EmployeeStructureDialog";

interface StructureRow {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  designation: string | null;
  annualCtc: number;
  monthlyGross: number;
  basic: number;
  employerPf: number;
  esiApplicable: boolean;
  effectiveFrom: string;
  source: "template" | "custom";
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function StructurePage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ["payroll", "template"], queryFn: () => api.get<SalaryTemplate>("/admin/payroll/template") });
  const [draft, setDraft] = useState<SalaryTemplate | null>(null);
  const [ctc, setCtc] = useState("1440000");
  useEffect(() => {
    if (tpl.data && !draft) setDraft(tpl.data);
  }, [tpl.data, draft]);
  const debouncedDraft = useDebounced(draft);
  const debouncedCtc = useDebounced(Number(ctc.replace(/[^\d]/g, "")) || 0);
  const preview = useQuery({
    queryKey: ["payroll", "template", "preview", debouncedDraft, debouncedCtc],
    queryFn: () => api.post<Structure>("/admin/payroll/template/preview", { annualCtc: debouncedCtc, template: debouncedDraft }),
    enabled: !!debouncedDraft,
    placeholderData: (p) => p,
  });
  const configurable = can("payroll", "configure");
  const dirty = !!draft && !!tpl.data && JSON.stringify(draft) !== JSON.stringify(tpl.data);
  const save = useMutation({
    mutationFn: () => api.put("/admin/payroll/template", draft),
    onSuccess: () => {
      toast.success("Salary template saved. It applies to employees without a custom structure from the next calculation.");
      qc.invalidateQueries({ queryKey: ["payroll"] });
    },
  });

  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const list = useQuery({ queryKey: ["payroll", "structures", term], queryFn: () => api.get<StructureRow[]>(`/admin/payroll/structures${qs({ q: term })}`) });
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<StructureRow>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code}{r.designation ? ` · ${r.designation}` : ""}</div></div> },
      { id: "department", header: "Department", accessorFn: (r) => r.department ?? "" },
      { id: "ctc", header: "Annual CTC", accessorKey: "annualCtc", cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "gross", header: "Monthly gross", accessorKey: "monthlyGross", cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "basic", header: "Basic", accessorKey: "basic", cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "pf", header: "Employer PF", accessorKey: "employerPf", cell: ({ getValue }) => inr(getValue<number>()), meta: { align: "right" } },
      { id: "esi", header: "ESI", accessorKey: "esiApplicable", cell: ({ getValue }) => (getValue<boolean>() ? <Tag tone="accent">Covered</Tag> : <span className="text-muted">No</span>) },
      { id: "source", header: "Source", accessorKey: "source", cell: ({ getValue }) => (getValue<string>() === "custom" ? <Tag tone="accent">Custom</Tag> : <span className="text-muted">Template</span>) },
      { id: "effective", header: "Effective from", accessorKey: "effectiveFrom", cell: ({ getValue }) => fmtDate(getValue<string>()) },
    ],
    [],
  );

  if (tpl.isLoading || !draft) return <Loading />;
  if (tpl.error) return <ErrorState error={tpl.error} retry={() => tpl.refetch()} />;
  const s = preview.data;
  const set = (k: keyof SalaryTemplate, v: number | boolean) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
  const rows: [string, string, number, string][] = s
    ? [
        ["Basic", `${draft.basicPctOfGross}% of gross`, s.components.basic, "Fully taxable · PF wage"],
        ["House rent allowance", `${draft.hraPctOfBasic}% of basic`, s.components.hra, "Partly exempt in old regime (s.10(13A))"],
        ["Conveyance allowance", "Fixed", s.components.conveyance, "Taxable"],
        ["Medical allowance", "Fixed", s.components.medical, "Taxable"],
        ["Special allowance", "Balancing figure", s.components.special, "Fully taxable"],
      ]
    : [];

  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="!gap-4">
          <CardHeader title={<><div className="card-kicker">Salary template</div>Standard</>} sub="Used for every employee without a custom structure. CTC = gross + employer PF + employer ESI." />
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))" }}>
            <Field label="Basic (% of gross)">
              <Input inputMode="decimal" value={draft.basicPctOfGross} onChange={(e) => set("basicPctOfGross", num(e.target.value))} disabled={!configurable} />
            </Field>
            <Field label="HRA (% of basic)" hint="50 for metro, 40 otherwise">
              <Input inputMode="decimal" value={draft.hraPctOfBasic} onChange={(e) => set("hraPctOfBasic", num(e.target.value))} disabled={!configurable} />
            </Field>
            <Field label="Conveyance (₹/month)">
              <Input inputMode="numeric" value={draft.conveyance} onChange={(e) => set("conveyance", num(e.target.value))} disabled={!configurable} />
            </Field>
            <Field label="Medical (₹/month)">
              <Input inputMode="numeric" value={draft.medical} onChange={(e) => set("medical", num(e.target.value))} disabled={!configurable} />
            </Field>
          </div>
          <Checkbox label="Employer PF on full basic (default: on wages capped at ₹15,000)" checked={draft.pfOnFullBasic} onChange={(v) => set("pfOnFullBasic", v)} disabled={!configurable} />
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))" }}>
            <Field label="Preview with annual CTC (₹)">
              <Input inputMode="numeric" value={ctc} onChange={(e) => setCtc(e.target.value)} />
            </Field>
            <Field label="Monthly gross">
              <Input value={s ? inr(s.gross) : "…"} readOnly />
            </Field>
            <Field label="Employer contributions">
              <Input value={s ? inr(s.employer.pf + s.employer.esi) : "…"} readOnly />
            </Field>
          </div>
          <div className="scroll-thin min-w-0 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Earning component</th>
                  <th>Rule</th>
                  <th style={{ textAlign: "right" }}>Monthly</th>
                  <th>Tax treatment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([c, rule, amt, note]) => (
                  <tr key={c}>
                    <td className="font-medium">{c}</td>
                    <td>{rule}</td>
                    <td className="num" style={{ textAlign: "right" }}>{inr(amt)}</td>
                    <td className="text-muted text-[12.5px]">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {configurable ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button disabled={!dirty} onClick={() => setDraft(tpl.data!)}>
                Reset
              </Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Save template
              </Button>
            </div>
          ) : null}
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="!gap-2.5">
            <div className="card-title text-[16px]">Employer contributions</div>
            <Line l="Employer PF (12%)" v={s?.employer.pf} />
            <Line l="Employer ESI (3.25%)" v={s?.employer.esi} />
            <Line l="Monthly CTC" v={s?.monthlyCtc} bold />
            <div className="text-muted text-[12.5px]">PF on wages capped at ₹15,000 unless set to full basic. ESI applies when monthly gross is ₹21,000 or less. EDLI and PF admin charges are employer costs on top of CTC.</div>
          </Card>
          <Card className="!gap-2.5">
            <div className="card-title text-[16px]">Employee deductions</div>
            <Line l="Provident fund (12% of PF wage)" v={s ? Math.round(Math.min(s.components.basic, draft.pfOnFullBasic ? Infinity : 15000) * 0.12) : undefined} />
            <Line l="ESI (0.75%)" v={s ? (s.esiApplicable ? Math.ceil(s.gross * 0.0075) : 0) : undefined} />
            <div className="flex justify-between text-[13.5px]">
              <span>Professional tax</span>
              <span className="text-muted">By branch state</span>
            </div>
            <div className="flex justify-between text-[13.5px]">
              <span>Income tax (TDS)</span>
              <span className="text-muted">By regime, monthly</span>
            </div>
          </Card>
          <Card className="!gap-1.5">
            <div className="card-kicker">Variable & one-time</div>
            <div className="text-[13px]">Incentives, arrears, bonus and recoveries are added per month in Review & approve, so the base structure stays stable across cycles.</div>
          </Card>
        </div>
      </div>

      <TableCard>
        <CardHeader className="py-2" title="Employee salary structures" sub="Current structure for everyone on payroll. Click a row to see history or revise a salary." actions={<Input className="!w-[240px]" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />} />
        <DataTable data={list.data ?? []} loading={list.isLoading} columns={columns} getRowId={(r) => r.employeeId} onRowClick={(r) => setOpen(r.employeeId)} storageKey="payroll-structures" pageSize={15} />
      </TableCard>
      <EmployeeStructureDialog employeeId={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Line({ l, v, bold }: { l: string; v: number | undefined; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-[13.5px] ${bold ? "border-t border-[var(--color-divider)] pt-1.5 font-semibold" : ""}`}>
      <span>{l}</span>
      <span className="num">{v === undefined ? "…" : inr(v)}</span>
    </div>
  );
}

