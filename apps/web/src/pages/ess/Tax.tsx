import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Download, FileText, Lock, Trash2, Upload } from "lucide-react";
import { CAPS, declaredBySection, fmtDate, inr, taxDeclarationDataSchema, TAX_SECTION_LABELS, todayIST, type TaxSection } from "@hrms/shared";
import { api, ApiError, qs } from "@/lib/api";
import type { EmployeeTax, Form16Data, TaxDeclarationData, TaxProof, TaxStatement } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { TaxStatementView } from "@/components/tax/TaxStatementView";
import { Form16View } from "@/components/tax/Form16View";
import { monthLabel, printPayslip } from "@/components/payroll/Payslip";
import { grid2, MoneyInput, SectionCard } from "@/components/tax/ess/fields";

type Regime = "new" | "old";
interface TaxResp extends EmployeeTax {
  fy: string;
  proofs: TaxProof[];
  editable: boolean;
}
interface Preview {
  new: TaxStatement;
  old: TaxStatement;
  better: Regime;
  saving: number;
}

function fyOf(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}
const prevFy = (fy: string) => {
  const s = Number(fy.slice(0, 4)) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};

const STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "ok" | "accent" }> = {
  none: { label: "Not started", tone: "neutral" },
  draft: { label: "Draft", tone: "accent" },
  submitted: { label: "Submitted, waiting for HR", tone: "warn" },
  verified: { label: "Verified and locked", tone: "ok" },
};

const C80 = [
  ["lic", "Life insurance (LIC) premium"],
  ["ppf", "PPF"],
  ["elss", "ELSS mutual funds"],
  ["nsc", "NSC"],
  ["tuition", "Children's tuition fees"],
  ["homeLoanPrincipal", "Home loan principal"],
  ["sukanya", "Sukanya Samriddhi"],
  ["taxSaverFd", "5-year tax-saver FD"],
  ["other", "Other 80C"],
] as const;

/** Drop empty/zero values so the saved declaration stays tidy. */
function clean(d: TaxDeclarationData): TaxDeclarationData {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      if (v) out[k] = v;
    } else if (typeof v === "object") {
      const inner = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== null && x !== "" && x !== 0));
      const meaningful = Object.entries(inner).some(([, x]) => typeof x === "number" || (typeof x === "string" && x));
      if (meaningful) out[k] = inner;
    }
  }
  return out as TaxDeclarationData;
}

export default function EssTax() {
  const qc = useQueryClient();
  const currentFy = fyOf(todayIST());
  const [fy, setFy] = useState(currentFy);
  const q = useQuery({ queryKey: ["ess", "tax", fy], queryFn: () => api.get<TaxResp>(`/ess/tax${qs({ fy })}`) });
  const [regime, setRegime] = useState<Regime>("new");
  const [data, setData] = useState<TaxDeclarationData>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  // load server state into the form
  useEffect(() => {
    if (!q.data) return;
    setRegime((q.data.declaration?.regime ?? q.data.employee.regime ?? "new") as Regime);
    setData(q.data.declaration?.data ?? {});
    setDirty(false);
    setError(null);
  }, [q.data]);

  // debounced live preview of both regimes
  const [debounced, setDebounced] = useState<string>("{}");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(JSON.stringify(clean(data))), 400);
    return () => clearTimeout(t);
  }, [data]);
  const preview = useQuery({
    queryKey: ["ess", "tax", "preview", fy, debounced],
    queryFn: () => api.post<Preview>("/ess/tax/preview", { fy, data: JSON.parse(debounced) }),
    enabled: !!q.data,
    placeholderData: (prev) => prev,
  });

  const editable = q.data?.editable ?? false;
  const update = (patch: Partial<TaxDeclarationData>) => {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const validate = () => {
    const parsed = taxDeclarationDataSchema.safeParse(clean(data));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new Error(i ? `${i.path.join(" › ")}: ${i.message}` : "Check the amounts you entered");
    }
    return parsed.data;
  };
  const save = useMutation({
    meta: { silent: true },
    mutationFn: async () => api.put("/ess/tax", { fy, regime, data: validate() }),
    onSuccess: () => {
      setError(null);
      toast.success("Declaration saved");
      qc.invalidateQueries({ queryKey: ["ess", "tax"] });
    },
    onError: (e) => setError(e.message),
  });
  const submit = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      await api.put("/ess/tax", { fy, regime, data: validate() });
      return api.post("/ess/tax/submit", { fy });
    },
    onSuccess: () => {
      setError(null);
      setConfirm(false);
      toast.success("Submitted to HR");
      qc.invalidateQueries({ queryKey: ["ess", "tax"] });
    },
    onError: (e) => {
      setConfirm(false);
      setError(e.message);
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data!;
  const status = STATUS[t.declaration?.status ?? "none"]!;
  const p = preview.data;
  const oldOnly = regime === "new";
  const rentAnnual = (data.rent?.monthlyRent ?? 0) * (data.rent?.months ?? 12);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!mb-1 text-[26px]">Income tax</h1>
          <div className="text-muted text-[13.5px]">Choose your regime and declare investments so the right TDS is deducted from your salary.</div>
        </div>
        <Select className="!w-[150px]" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          <option value={currentFy}>FY {currentFy}</option>
          <option value={prevFy(currentFy)}>FY {prevFy(currentFy)}</option>
        </Select>
      </div>

      {/* 1. status */}
      <Card className="!gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="card-kicker">FY {t.fy} declaration</div>
            <div className="mt-1">
              <Tag tone={status.tone}>{status.label}</Tag>
              {t.declaration?.submittedAt ? <span className="text-muted ml-2 text-[12px]">submitted {fmtDate(t.declaration.submittedAt.slice(0, 10))}</span> : null}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fig label="TDS deducted so far" v={inr(t.deducted)} />
          {t.excess ? <Fig label="Deducted more than your tax" v={inr(t.excess)} /> : <Fig label="Still to deduct this year" v={inr(t.remaining)} />}
          <Fig label={t.projectedMonths ? `Estimated TDS per month (${t.projectedMonths} left)` : "Estimated TDS per month"} v={t.projectedMonths ? inr(t.monthlyEstimate) : "No months left"} />
        </div>
        {t.excess ? <div className="text-muted text-[12.5px]">No more TDS will be deducted this year. You can claim the extra {inr(t.excess)} as a refund when you file your income tax return.</div> : null}
      </Card>

      {!editable ? (
        <Notice tone="sel">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={14} /> HR has verified and locked your declaration. Contact HR to change it.
          </span>
        </Notice>
      ) : null}

      {/* 2. regime */}
      <Card className="!gap-3">
        <CardHeader title="Tax regime" sub="The new regime has lower rates but no deductions, only the ₹75,000 standard deduction. The old regime has higher rates but allows HRA, 80C, 80D, home loan interest and more." />
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tax regime">
          {(["new", "old"] as const).map((r) => {
            const tax = p?.[r]?.tax.total;
            const best = p && p.better === r && p.saving > 0;
            const on = regime === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!editable}
                onClick={() => {
                  setRegime(r);
                  setDirty(true);
                }}
                className="card flex cursor-pointer flex-col items-start !gap-1 border text-left text-[var(--color-text)] disabled:cursor-default"
                style={{ padding: 16, font: "inherit", borderColor: on ? "var(--color-accent)" : "var(--color-divider)", background: on ? "var(--sel-bg)" : undefined }}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-semibold">{r === "new" ? "New regime" : "Old regime"}</span>
                  {best ? <Tag tone="ok">Saves you {inr(p!.saving)}</Tag> : null}
                </div>
                <span className="text-[22px] font-medium num">{tax === undefined ? "…" : inr(tax)}</span>
                <span className="text-muted text-[12px]">{r === "new" ? "Estimated tax for the year · default if you don't choose" : "Estimated tax with the deductions below"}</span>
              </button>
            );
          })}
        </div>
        {preview.isFetching ? <div className="text-muted text-[12px]">Updating estimate…</div> : null}
      </Card>

      {/* 3. declaration */}
      <Card className="!gap-4">
        <CardHeader title="Your declaration" sub={oldOnly ? "You've picked the new regime, so the faded sections below won't reduce your tax. Previous employer and other income count under both regimes." : "Enter what you've paid or plan to pay this financial year. Amounts above the legal limit are capped automatically."} />
        <fieldset disabled={!editable} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <SectionCard title="House rent (HRA)" hint="Old regime only. Exemption is the least of HRA received, rent minus 10% of basic, and 50% (metro) or 40% of basic." dimmed={oldOnly}>
            <div className={grid2}>
              <Field label="Monthly rent">
                <MoneyInput value={data.rent?.monthlyRent} onChange={(v) => update({ rent: { months: 12, metro: false, ...data.rent, monthlyRent: v } })} />
              </Field>
              <Field label="Months rented this year">
                <Input type="number" min={0} max={12} value={data.rent?.months ?? 12} onChange={(e) => update({ rent: { monthlyRent: 0, metro: false, ...data.rent, months: Math.max(0, Math.min(12, Number(e.target.value) || 0)) } })} />
              </Field>
              <Field label="Landlord name">
                <Input value={data.rent?.landlordName ?? ""} onChange={(e) => update({ rent: { monthlyRent: 0, months: 12, metro: false, ...data.rent, landlordName: e.target.value } })} />
              </Field>
              <Field label="Landlord PAN" hint={rentAnnual > 100000 ? "Required because your rent is more than ₹1,00,000 a year" : "Needed if annual rent is more than ₹1,00,000"}>
                <Input value={data.rent?.landlordPan ?? ""} maxLength={10} onChange={(e) => update({ rent: { monthlyRent: 0, months: 12, metro: false, ...data.rent, landlordPan: e.target.value.toUpperCase() } })} />
              </Field>
            </div>
            <Checkbox label="I live in a metro city (Delhi, Mumbai, Kolkata or Chennai)" checked={!!data.rent?.metro} onChange={(v) => update({ rent: { monthlyRent: 0, months: 12, ...data.rent, metro: v } })} disabled={!editable} />
          </SectionCard>

          <SectionCard title="80C investments" hint={`Old regime only. Limit ${inr(CAPS.sec80C)} a year. Your PF contribution already counts towards the ₹1.5 lakh limit.`} dimmed={oldOnly}>
            <div className={grid2}>
              {C80.map(([k, label]) => (
                <Field key={k} label={label}>
                  <MoneyInput value={data.sec80C?.[k]} onChange={(v) => update({ sec80C: { ...data.sec80C, [k]: v } })} />
                </Field>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Health insurance (80D)" hint={`Old regime only. Up to ${inr(CAPS.sec80D)} each for self/family and parents, ${inr(CAPS.sec80DSenior)} if senior citizens.`} dimmed={oldOnly}>
            <div className={grid2}>
              <div className="flex flex-col gap-2">
                <Field label="Self, spouse and children">
                  <MoneyInput value={data.sec80D?.self} onChange={(v) => update({ sec80D: { ...data.sec80D, self: v } })} />
                </Field>
                <Checkbox label="I'm a senior citizen" checked={!!data.sec80D?.selfSenior} onChange={(v) => update({ sec80D: { ...data.sec80D, selfSenior: v } })} disabled={!editable} />
              </div>
              <div className="flex flex-col gap-2">
                <Field label="Parents">
                  <MoneyInput value={data.sec80D?.parents} onChange={(v) => update({ sec80D: { ...data.sec80D, parents: v } })} />
                </Field>
                <Checkbox label="Parents are senior citizens" checked={!!data.sec80D?.parentsSenior} onChange={(v) => update({ sec80D: { ...data.sec80D, parentsSenior: v } })} disabled={!editable} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Other deductions" hint="Old regime only." dimmed={oldOnly}>
            <div className={grid2}>
              <Field label="80CCD(1B) NPS contribution" hint={`Limit ${inr(CAPS.sec80CCD1B)}, on top of 80C`}>
                <MoneyInput value={data.sec80CCD1B} onChange={(v) => update({ sec80CCD1B: v })} />
              </Field>
              <Field label="24(b) home loan interest" hint={`Self-occupied house, limit ${inr(CAPS.homeLoanInterest)}`}>
                <MoneyInput value={data.homeLoanInterest} onChange={(v) => update({ homeLoanInterest: v })} />
              </Field>
              <Field label="80E education loan interest" hint="No upper limit">
                <MoneyInput value={data.sec80E} onChange={(v) => update({ sec80E: v })} />
              </Field>
              <Field label="80G donations (eligible amount)" hint="Enter the amount that qualifies after the 50% or 100% rule">
                <MoneyInput value={data.sec80G} onChange={(v) => update({ sec80G: v })} />
              </Field>
              <Field label="80TTA savings account interest" hint={`Limit ${inr(CAPS.sec80TTA)}`}>
                <MoneyInput value={data.sec80TTA} onChange={(v) => update({ sec80TTA: v })} />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Other income" hint="Applies to both regimes: interest, rent received and so on that you want taxed through salary.">
            <div className={grid2}>
              <Field label="Income from other sources">
                <MoneyInput value={data.otherIncome} onChange={(v) => update({ otherIncome: v })} />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Previous employer this year" hint="Applies to both regimes. Fill this in if you changed jobs during the financial year (from Form 12B).">
            <div className={grid2}>
              <Field label="Employer name">
                <Input value={data.previousEmployer?.name ?? ""} onChange={(e) => update({ previousEmployer: { ...data.previousEmployer, name: e.target.value } })} />
              </Field>
              <Field label="Employer TAN">
                <Input value={data.previousEmployer?.tan ?? ""} maxLength={10} onChange={(e) => update({ previousEmployer: { ...data.previousEmployer, tan: e.target.value.toUpperCase() } })} />
              </Field>
              <Field label="Gross salary paid">
                <MoneyInput value={data.previousEmployer?.gross} onChange={(v) => update({ previousEmployer: { ...data.previousEmployer, gross: v } })} />
              </Field>
              <Field label="TDS deducted">
                <MoneyInput value={data.previousEmployer?.tds} onChange={(v) => update({ previousEmployer: { ...data.previousEmployer, tds: v } })} />
              </Field>
              <Field label="PF deducted">
                <MoneyInput value={data.previousEmployer?.pf} onChange={(v) => update({ previousEmployer: { ...data.previousEmployer, pf: v } })} />
              </Field>
              <Field label="Professional tax deducted">
                <MoneyInput value={data.previousEmployer?.pt} onChange={(v) => update({ previousEmployer: { ...data.previousEmployer, pt: v } })} />
              </Field>
            </div>
          </SectionCard>
        </fieldset>

        {error ? <Notice tone="bad">{error}</Notice> : null}
        {editable ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty ? <span className="text-muted mr-auto text-[12.5px]">You have unsaved changes</span> : null}
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save draft
            </Button>
            <Button variant="primary" onClick={() => setConfirm(true)}>
              {t.declaration?.status === "submitted" ? "Resubmit to HR" : "Submit to HR"}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* 4. proofs */}
      <ProofsCard fy={fy} data={data} proofs={t.proofs} editable={editable} />

      {/* 5. computation */}
      <ComputationCard tax={t} />

      {/* 6. Form 16 */}
      <Form16Card currentFy={currentFy} />

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit your declaration?"
        description={`You're choosing the ${regime === "new" ? "new" : "old"} regime for FY ${fy}.`}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
              Submit to HR
            </Button>
          </>
        }
      >
        <div className="text-[13.5px]">HR will check your declaration and proofs. Until they lock it, you can still make changes and resubmit. TDS from your next salary will use these figures.</div>
      </Dialog>
    </>
  );
}

function Fig({ label, v }: { label: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted text-[11.5px]">{label}</div>
      <div className="num text-[17px] font-semibold">{v}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const PROOF_TONE = { pending: "warn", accepted: "ok", rejected: "bad" } as const;

function ProofsCard({ fy, data, proofs, editable }: { fy: string; data: TaxDeclarationData; proofs: TaxProof[]; editable: boolean }) {
  const qc = useQueryClient();
  const declared = declaredBySection(data);
  const sections = (Object.keys(declared) as TaxSection[]).filter((s) => declared[s] > 0 || proofs.some((p) => p.section === s));
  const upload = useMutation({
    mutationFn: ({ section, file }: { section: string; file: File }) => {
      const fd = new FormData();
      fd.set("section", section);
      fd.set("fy", fy);
      fd.set("file", file);
      return api.upload("/ess/tax/proofs", fd);
    },
    onSuccess: () => {
      toast.success("Proof uploaded");
      qc.invalidateQueries({ queryKey: ["ess", "tax"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/ess/tax/proofs/${id}`),
    onSuccess: () => {
      toast.success("Proof removed");
      qc.invalidateQueries({ queryKey: ["ess", "tax"] });
    },
  });
  return (
    <Card className="!gap-3">
      <CardHeader title="Investment proofs" sub="Upload receipts and statements for what you declared. HR needs them by the deadline they set (usually in January), or the declared amounts may not be counted." />
      {sections.length === 0 ? (
        <div className="text-muted text-[13px]">Declare an amount above and the section will appear here for proofs.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sections.map((s) => (
            <ProofRow key={s} section={s} amount={declared[s]} proofs={proofs.filter((p) => p.section === s)} editable={editable} onUpload={(file) => upload.mutate({ section: s, file })} uploading={upload.isPending && upload.variables?.section === s} onDelete={(id) => del.mutate(id)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ProofRow({ section, amount, proofs, editable, onUpload, uploading, onDelete }: { section: TaxSection; amount: number; proofs: TaxProof[]; editable: boolean; onUpload: (f: File) => void; uploading: boolean; onDelete: (id: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-[var(--radius-md)] px-3.5 py-3" style={{ background: "var(--tint-1)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{TAX_SECTION_LABELS[section]}</div>
          <div className="text-muted text-[12px]">Declared {inr(amount)}{section === "hra" ? " a year" : ""}</div>
        </div>
        {editable ? (
          <>
            <input
              ref={ref}
              type="file"
              className="hidden"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) return void toast.error("Files must be 10 MB or smaller");
                onUpload(f);
              }}
              aria-label={`Upload proof for ${TAX_SECTION_LABELS[section]}`}
            />
            <Button size="sm" loading={uploading} onClick={() => ref.current?.click()}>
              <Upload size={14} /> Upload proof
            </Button>
          </>
        ) : null}
      </div>
      {proofs.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {proofs.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <FileText size={14} style={{ color: "var(--color-accent)" }} />
              <a href={`/api/ess/tax/proofs/${p.id}/file`} target="_blank" rel="noopener noreferrer" className="min-w-0 max-w-full truncate">
                {p.fileName}
              </a>
              <Tag tone={PROOF_TONE[p.status]}>{p.status === "pending" ? "Waiting for HR" : p.status === "accepted" ? "Accepted" : "Rejected"}</Tag>
              {p.note ? <span className="text-muted text-[12px]">{p.note}</span> : null}
              {editable && p.status === "pending" ? (
                <Button icon size="sm" variant="ghost" className="ml-auto" aria-label={`Remove ${p.fileName}`} onClick={() => onDelete(p.id)}>
                  <Trash2 size={14} />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted mt-1.5 text-[12px]">No proof uploaded yet</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ComputationCard({ tax }: { tax: EmployeeTax }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="!gap-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-[var(--color-text)]" style={{ font: "inherit" }}>
        <div>
          <div className="card-title text-[17px]">Your tax computation</div>
          <div className="text-muted text-[13px]">
            {tax.statement.regime === "new" ? "New" : "Old"} regime · tax for the year {inr(tax.statement.tax.total)} · based on what's saved
          </div>
        </div>
        <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open ? (
        <>
          <TaxStatementView s={tax.statement} />
          <div className="card-kicker mt-2">Month by month</div>
          <div className="scroll-thin min-w-0 overflow-x-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  <th style={{ textAlign: "right" }}>TDS</th>
                </tr>
              </thead>
              <tbody>
                {tax.months.map((m) => (
                  <tr key={m.month}>
                    <td className="whitespace-nowrap">{monthLabel(m.month)}</td>
                    <td>{m.status === "locked" ? <Tag tone="ok">Paid</Tag> : <Tag tone="neutral">Projected</Tag>}</td>
                    <td className="num text-right">{inr(m.gross)}</td>
                    <td className="num text-right">{m.status === "locked" ? inr(m.tds) : tax.projectedMonths ? `~${inr(tax.monthlyEstimate)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Form16Card({ currentFy }: { currentFy: string }) {
  const last = prevFy(currentFy);
  const [fy, setFy] = useState(last);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["ess", "form16", fy],
    queryFn: async () => {
      try {
        return await api.get<Form16Data>(`/ess/tax/form16${qs({ fy })}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });
  const f = q.data;
  const year = useMemo(() => `${Number(fy.slice(0, 4)) + 1}`, [fy]);
  return (
    <Card className="!gap-3">
      <CardHeader
        title="Form 16"
        sub="Your TDS certificate from the employer, for filing your income tax return."
        actions={
          <Select className="!w-[160px]" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Form 16 year">
            <option value={last}>FY {last}</option>
            <option value={currentFy}>FY {currentFy} (so far)</option>
          </Select>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : f ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13.5px]">
            <div className="font-semibold">
              FY {f.fy} · TDS {inr(f.tdsDeducted)}
            </div>
            <div className="text-muted text-[12.5px]">{f.provisional ? "Provisional: the year isn't over, so figures will change" : `Assessment year ${f.assessmentYear}`}</div>
          </div>
          <Button variant="primary" onClick={() => setOpen(true)}>
            <FileText size={15} /> View Form 16
          </Button>
        </div>
      ) : (
        <div className="text-muted text-[13px]">Form 16 for FY {fy} will appear here after HR issues it (by 15 June {year}).</div>
      )}
      <Dialog
        open={open && !!f}
        onOpenChange={setOpen}
        title="Form 16"
        width={820}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" onClick={printPayslip}>
              <Download size={16} /> Download PDF
            </Button>
          </>
        }
      >
        {f ? (
          <div id="payslip-print">
            <Form16View f={f} />
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}
