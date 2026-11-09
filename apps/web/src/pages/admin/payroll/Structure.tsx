import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, inr } from "@hrms/shared";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ExtraComponentDef, SalaryTemplate, Structure, TemplateRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
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
  templateId: string | null;
  templateName: string;
}

type Draft = SalaryTemplate & { name: string };
const NEW = "__new";
const toDraft = (t: TemplateRow): Draft => ({ name: t.isDefault ? "" : t.name, basicPctOfGross: t.basicPctOfGross, hraPctOfBasic: t.hraPctOfBasic, conveyance: t.conveyance, medical: t.medical, pfOnFullBasic: t.pfOnFullBasic, extras: t.extras ?? [] });
/** The template to save or preview: allowance codes come from their names. */
const templateOf = (d: Draft): SalaryTemplate => ({
  basicPctOfGross: d.basicPctOfGross,
  hraPctOfBasic: d.hraPctOfBasic,
  conveyance: d.conveyance,
  medical: d.medical,
  pfOnFullBasic: d.pfOnFullBasic,
  extras: (d.extras ?? [])
    .filter((x) => x.label.trim())
    .map((x, i, all) => {
      const base = x.code || x.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "allowance";
      const code = /^[a-z]/.test(base) ? base : `a_${base}`;
      return { ...x, code: all.slice(0, i).some((y) => (y.code || y.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")) === code) ? `${code}_${i}` : code };
    }),
});

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
  const tpls = useQuery({ queryKey: ["payroll", "templates"], queryFn: () => api.get<TemplateRow[]>("/admin/payroll/templates") });
  // null: the standard template; "new": a template being added
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ctc, setCtc] = useState("1440000");
  const current = selected === NEW ? null : (tpls.data?.find((t) => t.id === selected) ?? null);
  useEffect(() => {
    if (!tpls.data) return;
    if (selected === NEW) return;
    const t = tpls.data.find((x) => x.id === selected) ?? tpls.data[0]!;
    setDraft(toDraft(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpls.data, selected]);
  const debouncedDraft = useDebounced(draft);
  const debouncedCtc = useDebounced(Number(ctc.replace(/[^\d]/g, "")) || 0);
  const preview = useQuery({
    queryKey: ["payroll", "template", "preview", debouncedDraft, debouncedCtc],
    queryFn: () => api.post<Structure>("/admin/payroll/template/preview", { annualCtc: debouncedCtc, template: templateOf(debouncedDraft!) }),
    enabled: !!debouncedDraft,
    placeholderData: (p) => p,
  });
  const configurable = can("payroll", "configure");
  const dirty = !!draft && (selected === NEW || (!!current && JSON.stringify(draft) !== JSON.stringify(toDraft(current))));
  const save = useMutation({
    mutationFn: async () => {
      const body = templateOf(draft!);
      if (selected === null) return api.put("/admin/payroll/template", body);
      if (selected === NEW) return api.post<{ id: string }>("/admin/payroll/templates", { ...body, name: draft!.name });
      return api.put(`/admin/payroll/templates/${selected}`, { ...body, name: draft!.name });
    },
    onSuccess: (r) => {
      toast.success("Salary template saved. It applies from the next payroll calculation, to employees on it without a custom structure.");
      if (selected === NEW && r && typeof r === "object" && "id" in r) setSelected((r as { id: string }).id);
      qc.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/admin/payroll/templates/${selected}`),
    onSuccess: () => {
      toast.success("Template deleted");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [moving, setMoving] = useState<StructureRow[] | null>(null);

  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const list = useQuery({ queryKey: ["payroll", "structures", term], queryFn: () => api.get<StructureRow[]>(`/admin/payroll/structures${qs({ q: term })}`) });
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<StructureRow>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code}{r.designation ? ` · ${r.designation}` : ""}</div></div> },
      { id: "department", header: "Department", accessorFn: (r) => r.department ?? "" },
      { id: "template", header: "Template", accessorFn: (r) => r.templateName },
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

  if (tpls.error) return <ErrorState error={tpls.error} retry={() => tpls.refetch()} />;
  if (tpls.isLoading || !draft) return <Loading />;
  const s = preview.data;
  const set = (k: keyof Draft, v: number | boolean | string) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setExtra = (i: number, patch: Partial<ExtraComponentDef>) => setDraft((d) => (d ? { ...d, extras: (d.extras ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) } : d));
  const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
  const rows: [string, string, number, string][] = s
    ? [
        ["Basic", `${draft.basicPctOfGross}% of gross`, s.components.basic, "Fully taxable · PF wage"],
        ["House rent allowance", `${draft.hraPctOfBasic}% of basic`, s.components.hra, "Partly exempt in old regime (s.10(13A))"],
        ["Conveyance allowance", "Fixed", s.components.conveyance, "Taxable"],
        ["Medical allowance", "Fixed", s.components.medical, "Taxable"],
        ...(s.components.extras ?? []).map((x): [string, string, number, string] => {
          const def = draft.extras?.find((d) => d.code === x.code);
          return [x.label, def?.mode === "pct_basic" ? `${def.value}% of basic` : "Fixed", x.amount, `${x.taxable === false ? "Not taxable" : "Taxable"}${x.esiWage === false ? " · not ESI wages" : ""}`];
        }),
        ["Special allowance", "Balancing figure", s.components.special, "Fully taxable"],
      ]
    : [];

  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="!gap-4">
          <CardHeader
            title={<><div className="card-kicker">Salary template</div>{selected === NEW ? "New template" : (current?.name ?? "Standard")}</>}
            sub={selected === null ? "For everyone not on another template. CTC = gross + employer PF + employer ESI." : `${current?.employees ?? 0} employee${current?.employees === 1 ? "" : "s"} on this template. CTC = gross + employer PF + employer ESI.`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Select className="!w-[200px]" value={selected ?? ""} onChange={(e) => setSelected(e.target.value === "" ? null : e.target.value)} aria-label="Template">
                  {tpls.data!.map((t) => (
                    <option key={t.id ?? ""} value={t.id ?? ""}>
                      {t.name} ({t.employees})
                    </option>
                  ))}
                  {selected === NEW ? <option value={NEW}>New template</option> : null}
                </Select>
                {configurable && selected !== NEW ? (
                  <Button
                    onClick={() => {
                      setSelected(NEW);
                      setDraft({ ...toDraft(tpls.data![0]!), name: "" });
                    }}
                  >
                    <Plus size={15} /> New template
                  </Button>
                ) : null}
              </div>
            }
          />
          {selected !== null ? (
            <Field label="Template name" hint="For example a grade, or field staff">
              <Input value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={!configurable} maxLength={60} />
            </Field>
          ) : null}
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[13.5px] font-medium">Other allowances</div>
              {configurable ? (
                <Button size="sm" onClick={() => setDraft((d) => (d ? { ...d, extras: [...(d.extras ?? []), { code: "", label: "", mode: "fixed", value: 0, taxable: true, esiWage: true }] } : d))}>
                  <Plus size={14} /> Add allowance
                </Button>
              ) : null}
            </div>
            {(draft.extras ?? []).length ? (
              (draft.extras ?? []).map((x, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_auto_auto_auto] items-center gap-2">
                  <Input placeholder="e.g. Telephone allowance" value={x.label} onChange={(e) => setExtra(i, { label: e.target.value })} disabled={!configurable} aria-label="Allowance name" />
                  <Select value={x.mode} onChange={(e) => setExtra(i, { mode: e.target.value as ExtraComponentDef["mode"] })} disabled={!configurable} aria-label="Worked out as">
                    <option value="fixed">Fixed ₹ a month</option>
                    <option value="pct_basic">% of basic</option>
                  </Select>
                  <Input inputMode="decimal" value={x.value} onChange={(e) => setExtra(i, { value: num(e.target.value) })} disabled={!configurable} aria-label="Amount" />
                  <Checkbox label="Taxable" checked={x.taxable} onChange={(v) => setExtra(i, { taxable: v })} disabled={!configurable} />
                  <Checkbox label="ESI" checked={x.esiWage} onChange={(v) => setExtra(i, { esiWage: v })} disabled={!configurable} />
                  {configurable ? (
                    <Button size="sm" variant="ghost" aria-label="Remove allowance" onClick={() => setDraft((d) => (d ? { ...d, extras: (d.extras ?? []).filter((_, j) => j !== i) } : d))}>
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-muted text-[12.5px]">Telephone, LTA, shift, food coupons or any allowance of your own. They come out of gross before special allowance, and are prorated with paid days. PF stays on basic.</div>
            )}
          </div>
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
              {selected !== null && selected !== NEW ? (
                <Button variant="danger" className="mr-auto" loading={remove.isPending} disabled={(current?.employees ?? 0) > 0} title={(current?.employees ?? 0) > 0 ? "Move its employees to another template first" : undefined} onClick={() => confirm(`Delete the "${current?.name}" template?`) && remove.mutate()}>
                  Delete template
                </Button>
              ) : null}
              <Button disabled={!dirty} onClick={() => (selected === NEW ? setSelected(null) : setDraft(toDraft(current!)))}>
                {selected === NEW ? "Cancel" : "Reset"}
              </Button>
              <Button variant="primary" disabled={!dirty || (selected !== null && !draft.name.trim())} loading={save.isPending} onClick={() => save.mutate()}>
                {selected === NEW ? "Add template" : "Save template"}
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
        <DataTable
          data={list.data ?? []}
          loading={list.isLoading}
          columns={columns}
          getRowId={(r) => r.employeeId}
          onRowClick={(r) => setOpen(r.employeeId)}
          storageKey="payroll-structures"
          pageSize={15}
          bulkActions={configurable && (tpls.data?.length ?? 0) > 1 ? [{ label: "Move to template", onRun: (rows) => setMoving(rows) }] : undefined}
        />
      </TableCard>
      <EmployeeStructureDialog employeeId={open} onClose={() => setOpen(null)} />
      {moving ? <MoveDialog rows={moving} templates={tpls.data ?? []} onClose={() => setMoving(null)} /> : null}
    </>
  );
}

function MoveDialog({ rows, templates, onClose }: { rows: StructureRow[]; templates: TemplateRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<string>("");
  const move = useMutation({
    mutationFn: () => api.post<{ updated: number }>("/admin/payroll/templates/assign", { templateId: to || null, employeeIds: rows.map((r) => r.employeeId) }),
    onSuccess: (r) => {
      toast.success(`Moved ${r.updated} employee${r.updated === 1 ? "" : "s"}. Their pay follows the new template from the next calculation, unless they have a custom structure.`);
      qc.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const custom = rows.filter((r) => r.source === "custom").length;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Move ${rows.length} employee${rows.length === 1 ? "" : "s"} to a template`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={move.isPending} onClick={() => move.mutate()}>
            Move
          </Button>
        </>
      }
    >
      <Field label="Template">
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id ?? ""} value={t.id ?? ""}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      {custom ? <Notice tone="sel">{custom} of them have a custom structure, which stays as it is. The template's PF setting still applies.</Notice> : null}
    </Dialog>
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

