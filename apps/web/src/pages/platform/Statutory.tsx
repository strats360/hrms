import { WAGE_CATEGORIES, WAGE_CATEGORY_LABELS } from "@hrms/shared";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { fmtDate, GST_STATE_CODES, todayIST } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

type Category = "pf" | "esi" | "pt" | "lwf" | "tax" | "minwage";
interface Rule {
  id: string;
  key: string;
  category: Category;
  scope: string;
  value: Record<string, any>;
  effectiveFrom: string;
  status: "draft" | "live" | "retired";
  source: string | null;
  notes: string | null;
  label: string;
  summary: string;
  inForce: boolean;
  upcoming: boolean;
  publishedAt: string | null;
}
const CATS: { value: Category; label: string; scope: "none" | "state" | "fy" }[] = [
  { value: "pf", label: "EPF rates and wage ceiling", scope: "none" },
  { value: "esi", label: "ESI rates and wage ceiling", scope: "none" },
  { value: "pt", label: "Professional Tax slabs", scope: "state" },
  { value: "lwf", label: "Labour Welfare Fund", scope: "state" },
  { value: "tax", label: "Income tax slabs", scope: "fy" },
  { value: "minwage", label: "Minimum wage", scope: "state" },
];
const STATES = Object.keys(GST_STATE_CODES).sort();
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function StatusCell({ r }: { r: Rule }) {
  if (r.status === "draft") return <Tag tone="warn">Draft</Tag>;
  if (r.status === "retired") return <Tag>Retired</Tag>;
  if (r.upcoming) return <Tag tone="accent">Live from {fmtDate(r.effectiveFrom, false)}</Tag>;
  return r.inForce ? <Tag tone="ok">In force</Tag> : <Tag>Superseded</Tag>;
}

export default function Statutory() {
  const { me } = useSession();
  const superAdmin = me?.platformRole === "super_admin";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "statutory"], queryFn: () => api.get<{ rows: Rule[]; pending: number }>("/platform/statutory") });
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const [show, setShow] = useState<"current" | "all">("current");
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "statutory"] });
  const publish = useMutation({
    mutationFn: (ids: string[]) => api.post<{ published: number; tenants: number }>("/platform/statutory/publish", { ids }),
    onSuccess: (r) => {
      toast.success(`${r.published} rule version${r.published === 1 ? "" : "s"} published to ${r.tenants} tenant${r.tenants === 1 ? "" : "s"}`);
      refresh();
    },
  });
  const retire = useMutation({ mutationFn: (id: string) => api.post(`/platform/statutory/${id}/retire`), onSuccess: () => (toast.success("Version retired"), refresh()) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/platform/statutory/${id}`), onSuccess: () => (toast.success("Draft deleted"), refresh()) });
  const rows = (q.data?.rows ?? []).filter((r) => show === "all" || r.status === "draft" || r.inForce || r.upcoming);
  const drafts = (q.data?.rows ?? []).filter((r) => r.status === "draft");
  const columns = useMemo<ColumnDef<Rule, any>[]>(
    () => [
      { id: "rule", header: "Rule", accessorFn: (r) => r.label, cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.label}</div>{r.source ? <div className="text-muted max-w-[320px] truncate text-[11.5px]" title={r.source}>{r.source}</div> : null}</div> },
      { id: "value", header: "Value", accessorFn: (r) => r.summary, cell: ({ getValue }) => <span className="block max-w-[360px] whitespace-normal text-[13px]">{getValue<string>()}</span> },
      { id: "scope", header: "Scope", accessorFn: (r) => r.scope },
      { id: "from", header: "Effective from", accessorFn: (r) => r.effectiveFrom, cell: ({ getValue }) => fmtDate(getValue<string>()) },
      { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => <StatusCell r={r} /> },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Statutory master"
        sub="Rates, ceilings and slabs every tenant's payroll uses. A published version applies to payroll months starting on or after its effective date."
        actions={
          <>
            {superAdmin && drafts.length ? (
              <Button loading={publish.isPending} onClick={() => publish.mutate(drafts.map((d) => d.id))}>
                Publish {drafts.length} draft{drafts.length === 1 ? "" : "s"}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setEdit("new")}>
              <Plus size={16} /> New version
            </Button>
          </>
        }
      />
      {drafts.length ? <Notice tone="warn">{drafts.length} draft{drafts.length === 1 ? " is" : "s are"} waiting to be published: {drafts.map((d) => d.label).join(", ")}.</Notice> : null}
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={q.isFetching}
          pageSize={20}
          storageKey="platform-statutory"
          onRowClick={(r) => setEdit(r)}
          bulkActions={superAdmin ? [{ label: "Publish selected drafts", onRun: (sel) => publish.mutateAsync(sel.filter((r) => r.status === "draft").map((r) => r.id)).then(() => undefined) }] : undefined}
          rowActions={(r) => [
            { label: r.status === "draft" ? "Edit draft" : "View", onSelect: () => setEdit(r) },
            ...(superAdmin && r.status === "draft" ? [{ label: "Publish", onSelect: () => publish.mutate([r.id]) }] : []),
            ...(r.status === "draft" ? [{ label: "Delete draft", danger: true, onSelect: () => remove.mutate(r.id) }] : []),
            ...(superAdmin && r.status === "live" ? [{ label: "Retire this version", danger: true, onSelect: () => confirm(`Retire ${r.label} from ${r.effectiveFrom}? Payroll falls back to the previous version.`) && retire.mutate(r.id) }] : []),
          ]}
          toolbar={
            <Select className="!w-[220px]" value={show} onChange={(e) => setShow(e.target.value as "current" | "all")} aria-label="Show">
              <option value="current">In force, upcoming and drafts</option>
              <option value="all">All versions</option>
            </Select>
          }
        />
      </TableCard>
      <RuleDialog value={edit} onClose={() => setEdit(null)} onSaved={refresh} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
const pctIn = (n: unknown) => (n === null || n === undefined || n === "" ? "" : String(Math.round(Number(n) * 1000000) / 10000));
const pctOut = (s: string) => Number(s || 0) / 100;
const num = (s: string) => s.replace(/[^\d.]/g, "");

function RuleDialog({ value, onClose, onSaved }: { value: Rule | "new" | null; onClose: () => void; onSaved: () => void }) {
  const existing = value && value !== "new" ? value : null;
  const readOnly = !!existing && existing.status !== "draft";
  const [category, setCategory] = useState<Category>("pf");
  const [scope, setScope] = useState("");
  const [effectiveFrom, setFrom] = useState(todayIST().slice(0, 8) + "01");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [val, setVal] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cat = CATS.find((c) => c.value === category)!;
  const needScope = cat.scope !== "none";

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (existing) {
      setCategory(existing.category);
      setScope(existing.scope === "All India" ? "" : existing.scope);
      setFrom(existing.effectiveFrom);
      setSource(existing.source ?? "");
      setNotes(existing.notes ?? "");
      setVal(structuredClone(existing.value));
    } else {
      setCategory("pf");
      setScope("");
      setSource("");
      setNotes("");
      setVal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // new version: start from the latest version (or the built-in rule)
  const tmpl = useQuery({
    queryKey: ["platform", "statutory", "template", category, scope],
    queryFn: () => api.get<{ value: Record<string, any> | null; from: string }>(`/platform/statutory/template?category=${category}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`),
    enabled: !!value && !existing && (!needScope || !!scope),
  });
  useEffect(() => {
    if (existing || !value) return;
    if (tmpl.data) setVal(tmpl.data.value ? structuredClone(tmpl.data.value) : blankFor(category));
  }, [tmpl.data, existing, value, category]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const body = { category, scope: needScope ? scope : undefined, effectiveFrom, value: val, source: source || null, notes: notes || null };
      return existing ? api.patch(`/platform/statutory/${existing.id}`, body) : api.post("/platform/statutory", body);
    },
    onSuccess: () => {
      toast.success(existing ? "Draft updated" : "Draft saved. Publish it to apply.");
      onSaved();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? existing.label : "New rule version"}
      description={readOnly ? `${existing!.status === "live" ? "Published" : "Retired"} · effective ${fmtDate(existing!.effectiveFrom)}. Add a new version to change it.` : "Saved as a draft. A super admin publishes it."}
      width={720}
      footer={
        readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!val || (needScope && !scope)} loading={save.isPending} onClick={() => save.mutate()}>
              Save draft
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule">
          <Select value={category} disabled={!!existing} onChange={(e) => (setCategory(e.target.value as Category), setScope(""), setVal(null))}>
            {CATS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        {cat.scope === "state" ? (
          <Field label="State">
            <Select value={scope} disabled={!!existing} onChange={(e) => (setScope(e.target.value), setVal(null))}>
              <option value="">Pick a state</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        ) : cat.scope === "fy" ? (
          <Field label="Financial year" hint="e.g. 2027-28">
            <Input value={scope} disabled={!!existing} onChange={(e) => setScope(e.target.value)} onBlur={() => /^\d{4}-\d{2}$/.test(scope) && setFrom(`${scope.slice(0, 4)}-04-01`)} placeholder="2027-28" />
          </Field>
        ) : (
          <Field label="Scope">
            <Input value="All India" disabled />
          </Field>
        )}
        <Field label="Effective from">
          <Input type="date" value={effectiveFrom} disabled={readOnly} onChange={(e) => setFrom(e.target.value)} />
        </Field>
      </div>
      {!existing && tmpl.data ? <div className="text-muted text-[12.5px]">Started from the {tmpl.data.from === "built-in" ? "built-in rule" : "latest version"}. Change what's different.</div> : null}
      {val ? (
        <fieldset disabled={readOnly} className="m-0 flex flex-col gap-3 border-0 p-0">
          {category === "pf" ? <PfEditor v={val} set={setVal} /> : null}
          {category === "esi" ? <EsiEditor v={val} set={setVal} /> : null}
          {category === "pt" ? <PtEditor v={val} set={setVal} /> : null}
          {category === "lwf" ? <LwfEditor v={val} set={setVal} /> : null}
          {category === "tax" ? <TaxEditor v={val} set={setVal} /> : null}
          {category === "minwage" ? <MinWageEditor v={val} set={setVal} /> : null}
        </fieldset>
      ) : needScope && !scope ? (
        <Notice tone="sel">Pick the {cat.scope === "fy" ? "financial year" : "state"} first.</Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source" hint="Act, notification or circular">
          <Input value={source} disabled={readOnly} onChange={(e) => setSource(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Notes">
          <Textarea rows={1} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}

function blankFor(c: Category): Record<string, any> {
  if (c === "pt") return { none: false, slabs: [{ upTo: 10000, amount: 0 }, { upTo: null, amount: 200 }], femaleSlabs: null, februaryTop: null };
  if (c === "lwf") return { months: [6, 12], employee: 0, employer: 0, minGross: null };
  if (c === "minwage") return { monthly: 0, zone: "", skill: "" };
  return {};
}

type Ed = { v: Record<string, any>; set: (v: Record<string, any>) => void };

function PctField({ label, v, k, set }: { label: string; v: Record<string, any>; k: string; set: Ed["set"] }) {
  const [s, setS] = useState(pctIn(v[k]));
  return (
    <Field label={label}>
      <Input inputMode="decimal" value={s} onChange={(e) => (setS(num(e.target.value)), set({ ...v, [k]: pctOut(num(e.target.value)) }))} />
    </Field>
  );
}
function AmtField({ label, v, k, set, hint }: { label: string; v: Record<string, any>; k: string; set: Ed["set"]; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={v[k] === null || v[k] === undefined ? "" : String(v[k])} onChange={(e) => set({ ...v, [k]: e.target.value === "" ? null : Number(num(e.target.value)) })} />
    </Field>
  );
}

function PfEditor({ v, set }: Ed) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <PctField label="Employee (%)" v={v} k="employeeRate" set={set} />
      <PctField label="Employer (%)" v={v} k="employerRate" set={set} />
      <PctField label="EPS (%)" v={v} k="epsRate" set={set} />
      <PctField label="EDLI (%)" v={v} k="edliRate" set={set} />
      <PctField label="Admin charges (%)" v={v} k="adminRate" set={set} />
      <AmtField label="Wage ceiling (₹ / month)" v={v} k="wageCeiling" set={set} />
    </div>
  );
}
function EsiEditor({ v, set }: Ed) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <PctField label="Employee (%)" v={v} k="employeeRate" set={set} />
      <PctField label="Employer (%)" v={v} k="employerRate" set={set} />
      <AmtField label="Gross wage ceiling (₹ / month)" v={v} k="grossThreshold" set={set} />
    </div>
  );
}

/** Rows of [up to, value]; the last row is "and above". */
function SlabTable({ rows, valueKey, valueLabel, percent, onChange }: { rows: { upTo: number | null; [k: string]: any }[]; valueKey: string; valueLabel: string; percent?: boolean; onChange: (r: any[]) => void }) {
  const set = (i: number, patch: Record<string, unknown>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        const from = i === 0 ? 0 : Number(rows[i - 1]!.upTo ?? 0) + 1;
        return (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 text-[13px]">
            <span className="text-muted">From ₹{from.toLocaleString("en-IN")}</span>
            {last ? <span className="text-muted">and above</span> : <Input inputMode="numeric" aria-label="Up to" value={r.upTo === null ? "" : String(r.upTo)} onChange={(e) => set(i, { upTo: Number(num(e.target.value)) })} placeholder="Up to ₹" />}
            <Input inputMode="decimal" aria-label={valueLabel} value={percent ? pctIn(r[valueKey]) : String(r[valueKey] ?? "")} onChange={(e) => set(i, { [valueKey]: percent ? pctOut(num(e.target.value)) : Number(num(e.target.value)) })} placeholder={valueLabel} />
            <Button icon size="sm" variant="ghost" aria-label="Remove slab" disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, j) => j !== i).map((x, j, a) => (j === a.length - 1 ? { ...x, upTo: null } : x)))}>
              <Trash2 size={14} />
            </Button>
          </div>
        );
      })}
      <Button size="sm" className="self-start" onClick={() => onChange([...rows.slice(0, -1).map((x) => x), { upTo: Number(rows.at(-2)?.upTo ?? 0) + 5000, [valueKey]: 0 }, { ...rows.at(-1)!, upTo: null }])}>
        <Plus size={14} /> Add slab
      </Button>
    </div>
  );
}

function PtEditor({ v, set }: Ed) {
  return (
    <>
      <Checkbox checked={!!v.none} onChange={(x) => set({ ...v, none: x, slabs: x ? undefined : v.slabs ?? blankFor("pt").slabs })} label="This state doesn't levy Professional Tax" />
      {!v.none ? (
        <>
          <div className="text-[13px] font-medium">Monthly slabs (₹ PT per month)</div>
          <SlabTable rows={v.slabs ?? []} valueKey="amount" valueLabel="PT ₹" onChange={(r) => set({ ...v, slabs: r })} />
          <Checkbox checked={!!v.femaleSlabs} onChange={(x) => set({ ...v, femaleSlabs: x ? structuredClone(v.slabs) : null })} label="Different slabs for women" />
          {v.femaleSlabs ? <SlabTable rows={v.femaleSlabs} valueKey="amount" valueLabel="PT ₹" onChange={(r) => set({ ...v, femaleSlabs: r })} /> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <AmtField label="February amount (top slab)" v={v} k="februaryTop" set={set} hint="Blank if no annual top-up" />
          </div>
        </>
      ) : null}
    </>
  );
}
function LwfEditor({ v, set }: Ed) {
  const months: number[] = v.months ?? [];
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {M.map((m, i) => (
          <Checkbox key={m} checked={months.includes(i + 1)} onChange={(x) => set({ ...v, months: x ? [...months, i + 1].sort((a, b) => a - b) : months.filter((y) => y !== i + 1) })} label={m} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <AmtField label="Employee (₹)" v={v} k="employee" set={set} />
        <AmtField label="Employer (₹)" v={v} k="employer" set={set} />
        <AmtField label="Only above gross (₹)" v={v} k="minGross" set={set} hint="Blank for everyone" />
      </div>
    </>
  );
}
function TaxEditor({ v, set }: Ed) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(["new", "old"] as const).map((reg) => {
        const t = v[reg] ?? { standardDeduction: 0, rebateLimit: 0, slabs: [{ upTo: null, rate: 0 }], surcharge: [] };
        const put = (patch: Record<string, unknown>) => set({ ...v, [reg]: { ...t, ...patch } });
        return (
          <div key={reg} className="flex flex-col gap-2 rounded-[var(--radius-md)] p-3" style={{ background: "var(--tint-1)" }}>
            <div className="font-medium">{reg === "new" ? "New regime" : "Old regime"}</div>
            <div className="grid grid-cols-2 gap-2">
              <AmtField label="Standard deduction" v={t} k="standardDeduction" set={(x) => put(x)} />
              <AmtField label="87A: nil tax up to" v={t} k="rebateLimit" set={(x) => put(x)} />
            </div>
            <div className="text-[12.5px] font-medium">Slabs (rate %)</div>
            <SlabTable rows={t.slabs} valueKey="rate" valueLabel="Rate %" percent onChange={(r) => put({ slabs: r })} />
            <div className="text-muted text-[12px]">Surcharge: {t.surcharge.map((s: any) => `${Math.round(s.rate * 100)}% above ₹${(s.above / 100000).toLocaleString("en-IN")} L`).join(", ") || "none"}</div>
          </div>
        );
      })}
    </div>
  );
}
function MinWageEditor({ v, set }: Ed) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <AmtField label="Default monthly (₹)" v={v} k="monthly" set={set} />
      <Field label="Zone">
        <Input value={v.zone ?? ""} onChange={(e) => set({ ...v, zone: e.target.value })} />
      </Field>
      <Field label="Default skill level" hint="Applies to employees without a skill category">
        <Input value={v.skill ?? ""} onChange={(e) => set({ ...v, skill: e.target.value })} />
      </Field>
      <div className="col-span-full text-[13px] font-medium">Monthly rate by skill category (basic + DA, optional)</div>
      {WAGE_CATEGORIES.map((k) => (
        <Field key={k} label={WAGE_CATEGORY_LABELS[k]}>
          <Input
            inputMode="numeric"
            value={v.rates?.[k] ?? ""}
            onChange={(e) => {
              const n = e.target.value.replace(/[^\d]/g, "");
              const rates = { ...(v.rates ?? {}) };
              if (n) rates[k] = Number(n);
              else delete rates[k];
              set({ ...v, rates });
            }}
          />
        </Field>
      ))}
    </div>
  );
}
