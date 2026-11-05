import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, FileText, LogOut, Upload } from "lucide-react";
import { DOCUMENT_TYPE_LABELS, fmtDate, GENDERS, ONBOARDING_STEP_LABELS, type DocumentType } from "@hrms/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { EmployeeDocument } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";
import { ThemeToggle } from "@/components/layout/Header";
import { BrandMark } from "@/components/onboarding/PublicShell";
import { apiFieldErrors } from "@/components/onboarding/form";

interface OnbProfile {
  firstName: string;
  lastName: string | null;
  fullName: string;
  workEmail: string;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  bloodGroup: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  accountHolderName: string | null;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  pan: string | null;
  aadhaarLast4: string | null;
  uan: string | null;
  taxRegime: string;
  company: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: string;
}
interface OnbData {
  status: string;
  progress: number;
  completedSteps: string[];
  requiredDocs: string[];
  profile: OnbProfile;
  documents: EmployeeDocument[];
}

const STEPS = ["personal", "address", "bank", "tax", "documents", "review"] as const;
type Step = (typeof STEPS)[number];
const OPTIONAL_DOCS: DocumentType[] = ["education", "resume", "relieving_letter", "photo"];

export default function EssOnboarding() {
  const { tenant, signOut } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ess", "onboarding"], queryFn: () => api.get<OnbData>("/ess/onboarding"), enabled: !!tenant?.employeeId, retry: false });
  const [step, setStep] = useState<Step>("personal");
  const [done, setDone] = useState(false);
  const inited = useRef(false);

  useEffect(() => {
    if (q.data && !inited.current) {
      inited.current = true;
      const first = STEPS.find((s) => s !== "review" && !q.data!.completedSteps.includes(s));
      setStep(first ?? "review");
    }
  }, [q.data]);

  if (!tenant?.employeeId) return <Navigate to="/" replace />;
  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (q.error instanceof ApiError && q.error.status === 404) return <Navigate to="/me" replace />;
  if (q.isError || !q.data) return <Shell><ErrorState error={q.error} retry={() => q.refetch()} /></Shell>;
  const d = q.data;

  if (done || d.status === "submitted" || d.status === "verified") {
    return (
      <Shell company={d.profile.company} onSignOut={signOut}>
        <Card elev="md" className="!gap-3 !p-7">
          <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }}><Check size={22} /></div>
          <div className="text-[22px] font-medium">{d.status === "verified" ? "You're all set" : "Thanks, your details are in"}</div>
          <div className="text-[14px]" style={{ color: "var(--muted-2)" }}>
            {d.status === "verified"
              ? "HR has verified your details. You can use attendance and leave now."
              : "HR will verify your details. You'll get access to attendance and leave once verified. We'll email you if anything needs fixing."}
          </div>
          <Link to="/me" className="btn btn-primary self-start">Go to my portal</Link>
        </Card>
      </Shell>
    );
  }

  const completed = new Set(d.completedSteps);
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]!);
  const back = () => setStep(STEPS[Math.max(0, idx - 1)]!);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ess", "onboarding"] });

  return (
    <Shell company={d.profile.company} progress={d.progress} onSignOut={signOut}>
      <div className="h-1.5 overflow-hidden rounded-[var(--radius-md)]" style={{ background: "var(--tint-2)" }} role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full transition-[width] duration-300" style={{ width: `${d.progress}%`, background: "var(--color-accent)" }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((s) => {
          const isDone = completed.has(s);
          const cur = s === step;
          return (
            <button key={s} type="button" onClick={() => setStep(s)} aria-current={cur ? "step" : undefined} className="cursor-pointer rounded-[var(--radius-md)] border-0 px-3 py-1.5 text-[12.5px]" style={{ background: cur ? "var(--sel-bg)" : isDone ? "var(--ok-bg)" : "var(--tint-1)", color: cur ? "var(--sel-fg)" : isDone ? "var(--ok-fg)" : "var(--color-text)", fontWeight: cur ? 600 : 400 }}>
              {isDone ? "✓ " : ""}
              {s === "review" ? "Review & submit" : ONBOARDING_STEP_LABELS[s]}
            </button>
          );
        })}
      </div>
      <Card className="!gap-4 !p-5 sm:!p-6">
        <div className="text-[21px] font-medium tracking-[-0.01em]">{step === "review" ? "Review & submit" : ONBOARDING_STEP_LABELS[step]}</div>
        {step === "personal" ? <PersonalStep p={d.profile} onSaved={() => { refresh(); next(); }} /> : null}
        {step === "address" ? <AddressStep p={d.profile} onBack={back} onSaved={() => { refresh(); next(); }} /> : null}
        {step === "bank" ? <BankStep p={d.profile} saved={completed.has("bank")} onBack={back} onSaved={() => { refresh(); next(); }} /> : null}
        {step === "tax" ? <TaxStep p={d.profile} onBack={back} onSaved={() => { refresh(); next(); }} /> : null}
        {step === "documents" ? <DocsStep d={d} onBack={back} onNext={next} onChange={refresh} /> : null}
        {step === "review" ? <ReviewStep d={d} onBack={back} goTo={setStep} onSubmitted={() => { setDone(true); qc.invalidateQueries({ queryKey: ["ess"] }); }} /> : null}
      </Card>
    </Shell>
  );
}

function Shell({ children, company, progress, onSignOut }: { children: React.ReactNode; company?: string; progress?: number; onSignOut?: () => void }) {
  return (
    <div className="flex min-h-screen justify-center px-4 py-6 sm:py-8" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="flex w-[min(720px,100%)] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={30} name={company ?? "Strats360 People"} />
            {company ? <span className="text-muted hidden text-[13px] sm:inline">· Joining details</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {progress !== undefined ? <span className="text-muted text-[12.5px]">Saved automatically · {progress}% done</span> : null}
            <ThemeToggle />
            {onSignOut ? <Button icon onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut size={16} /></Button> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function useSave(step: string, onSaved: () => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<{ progress: number }>("/ess/onboarding/save", { step, data }),
    meta: { silent: true },
    onSuccess: () => {
      setErrors({});
      setFormErr(null);
      onSaved();
    },
    onError: (e) => {
      const fe = apiFieldErrors(e);
      setErrors(fe);
      setFormErr(Object.keys(fe).length ? "Please fix the highlighted fields." : e instanceof Error ? e.message : "Could not save");
    },
  });
  return { save: (data: Record<string, unknown>) => m.mutate(data), pending: m.isPending, errors, formErr };
}

function Nav({ onBack, pending, label = "Save & continue", onNext }: { onBack?: () => void; pending?: boolean; label?: string; onNext: () => void }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--color-divider)] pt-3">
      {onBack ? <Button onClick={onBack}><ChevronLeft size={16} />Back</Button> : <span />}
      <Button variant="primary" loading={pending} onClick={onNext}>{label}<ChevronRight size={16} /></Button>
    </div>
  );
}

const v = (x: string | null | undefined) => x ?? "";

function PersonalStep({ p, onSaved }: { p: OnbProfile; onSaved: () => void }) {
  const [f, setF] = useState({ firstName: p.firstName, lastName: v(p.lastName), dateOfBirth: v(p.dateOfBirth), gender: v(p.gender), personalEmail: v(p.personalEmail), phone: v(p.phone), maritalStatus: v(p.maritalStatus), bloodGroup: v(p.bloodGroup) });
  const { save, pending, errors, formErr } = useSave("personal", onSaved);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name (as on PAN)" error={errors.firstName}><Input value={f.firstName} onChange={set("firstName")} invalid={!!errors.firstName} /></Field>
        <Field label="Last name" error={errors.lastName}><Input value={f.lastName} onChange={set("lastName")} /></Field>
        <Field label="Date of birth" error={errors.dateOfBirth}><Input type="date" value={f.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={set("dateOfBirth")} invalid={!!errors.dateOfBirth} /></Field>
        <Field label="Gender" error={errors.gender}>
          <Select value={f.gender} onChange={set("gender")} invalid={!!errors.gender}>
            <option value="">Select</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g === "undisclosed" ? "Prefer not to say" : g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Personal email" error={errors.personalEmail}><Input type="email" value={f.personalEmail} onChange={set("personalEmail")} /></Field>
        <Field label="Mobile" error={errors.phone}><Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+91 99099 41236" /></Field>
        <Field label="Marital status">
          <Select value={f.maritalStatus} onChange={set("maritalStatus")}>
            <option value="">Prefer not to say</option>
            {["Single", "Married", "Divorced", "Widowed"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Blood group">
          <Select value={f.bloodGroup} onChange={set("bloodGroup")}>
            <option value="">Not known</option>
            {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
      </div>
      {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
      <Nav pending={pending} onNext={() => {
        if (!f.dateOfBirth || !f.gender) return toast.error("Date of birth and gender are required");
        save(f);
      }} />
    </>
  );
}

function AddressStep({ p, onBack, onSaved }: { p: OnbProfile; onBack: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ currentAddress: v(p.currentAddress), permanentAddress: v(p.permanentAddress), emergencyContactName: v(p.emergencyContactName), emergencyContactRelation: v(p.emergencyContactRelation), emergencyContactPhone: v(p.emergencyContactPhone) });
  const [same, setSame] = useState(!p.permanentAddress || p.permanentAddress === p.currentAddress);
  const { save, pending, errors, formErr } = useSave("address", onSaved);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field span label="Current address" error={errors.currentAddress}><Textarea className="!min-h-[64px]" value={f.currentAddress} onChange={set("currentAddress")} placeholder="House, street, area, city, PIN, state" /></Field>
        <div className="col-span-full"><Checkbox checked={same} onChange={setSame} label={<span className="text-[13px]">Permanent address is the same</span>} /></div>
        {!same ? <Field span label="Permanent address" error={errors.permanentAddress}><Textarea className="!min-h-[64px]" value={f.permanentAddress} onChange={set("permanentAddress")} /></Field> : null}
        <Field label="Emergency contact name" error={errors.emergencyContactName}><Input value={f.emergencyContactName} onChange={set("emergencyContactName")} /></Field>
        <Field label="Relation" error={errors.emergencyContactRelation}><Input value={f.emergencyContactRelation} onChange={set("emergencyContactRelation")} placeholder="Father, mother, spouse…" /></Field>
        <Field label="Emergency contact phone" error={errors.emergencyContactPhone}><Input type="tel" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></Field>
      </div>
      {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
      <Nav onBack={onBack} pending={pending} onNext={() => save({ ...f, permanentAddress: same ? f.currentAddress : f.permanentAddress })} />
    </>
  );
}

function BankStep({ p, saved, onBack, onSaved }: { p: OnbProfile; saved: boolean; onBack: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ accountHolderName: v(p.accountHolderName) || p.fullName, bankName: v(p.bankName), accountNumber: "", confirm: "", ifsc: v(p.ifsc) });
  const { save, pending, errors, formErr } = useSave("bank", onSaved);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: k === "ifsc" ? e.target.value.toUpperCase() : e.target.value }));
  const keep = saved && !f.accountNumber;
  return (
    <>
      <div className="text-muted text-[13px]">Your salary is paid to this account. Use an account in your own name.</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account holder name" error={errors.accountHolderName}><Input value={f.accountHolderName} onChange={set("accountHolderName")} /></Field>
        <Field label="Bank name" error={errors.bankName}><Input value={f.bankName} onChange={set("bankName")} placeholder="ICICI Bank" /></Field>
        <Field label="Account number" error={errors.accountNumber} hint={saved && p.accountLast4 ? `Saved account ends in ${p.accountLast4}. Leave blank to keep it.` : undefined}>
          <Input inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={set("accountNumber")} invalid={!!errors.accountNumber} />
        </Field>
        <Field label="Re-enter account number" error={f.confirm && f.confirm !== f.accountNumber ? "Account numbers don't match" : undefined}>
          <Input inputMode="numeric" autoComplete="off" value={f.confirm} onChange={set("confirm")} onPaste={(e) => e.preventDefault()} />
        </Field>
        <Field label="IFSC" error={errors.ifsc} hint="11 characters, printed on your cheque book"><Input value={f.ifsc} maxLength={11} onChange={set("ifsc")} invalid={!!errors.ifsc} /></Field>
      </div>
      <div className="text-muted text-[12.5px]">HR verifies the account before your first salary. Upload a cancelled cheque or passbook page in the Documents step.</div>
      {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
      <Nav
        onBack={onBack}
        pending={pending}
        label={keep ? "Continue" : "Save & continue"}
        onNext={() => {
          if (keep) return onSaved();
          if (f.accountNumber !== f.confirm) return toast.error("Account numbers don't match");
          save({ accountHolderName: f.accountHolderName, bankName: f.bankName, accountNumber: f.accountNumber, ifsc: f.ifsc });
        }}
      />
    </>
  );
}

function TaxStep({ p, onBack, onSaved }: { p: OnbProfile; onBack: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ pan: v(p.pan), aadhaarLast4: v(p.aadhaarLast4), uan: v(p.uan), taxRegime: p.taxRegime || "new" });
  const { save, pending, errors, formErr } = useSave("tax", onSaved);
  const regimes = [
    { value: "new", label: "New regime", hint: "Lower slab rates, fewer deductions. The default." },
    { value: "old", label: "Old regime", hint: "Claim 80C, 80D, HRA and other deductions." },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="PAN" error={errors.pan}><Input value={f.pan} maxLength={10} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" invalid={!!errors.pan} /></Field>
        <Field label="Aadhaar (last 4 digits only)" error={errors.aadhaarLast4} hint="We store only the last 4 digits. Never enter your full Aadhaar number here.">
          <Input inputMode="numeric" maxLength={4} value={f.aadhaarLast4} onChange={(e) => setF({ ...f, aadhaarLast4: e.target.value.replace(/\D/g, "") })} placeholder="4381" invalid={!!errors.aadhaarLast4} />
        </Field>
        <Field label="UAN, if you had PF before" error={errors.uan} hint="Leave blank if this is your first job"><Input inputMode="numeric" maxLength={12} value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value.replace(/\D/g, "") })} /></Field>
      </div>
      <Field label={`Tax regime for this financial year`}>
        <div className="flex flex-wrap gap-2">
          {regimes.map((r) => (
            <button key={r.value} type="button" aria-pressed={f.taxRegime === r.value} onClick={() => setF({ ...f, taxRegime: r.value })} className="card min-w-[200px] flex-1 cursor-pointer !gap-0.5 !p-3.5 text-left text-[var(--color-text)]" style={{ border: `1px solid ${f.taxRegime === r.value ? "var(--color-accent)" : "var(--color-divider)"}`, font: "inherit" }}>
              <span className="font-medium">{r.label}</span>
              <span className="text-muted text-[12px]">{r.hint}</span>
            </button>
          ))}
        </div>
      </Field>
      <div className="text-muted text-[12.5px]">You can change your regime once during declaration season.</div>
      {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
      <Nav onBack={onBack} pending={pending} onNext={() => save({ ...f, uan: f.uan || null })} />
    </>
  );
}

function DocsStep({ d, onBack, onNext, onChange }: { d: OnbData; onBack: () => void; onNext: () => void; onChange: () => void }) {
  const byType = new Map<string, EmployeeDocument[]>();
  for (const doc of d.documents) byType.set(doc.type, [...(byType.get(doc.type) ?? []), doc]);
  const missing = d.requiredDocs.filter((t) => !byType.has(t));
  return (
    <>
      <div className="text-muted text-[13px]">Upload clear photos or PDFs, up to 10 MB each. Required: PAN card, Aadhaar card and bank proof.</div>
      <div className="flex flex-col gap-2">
        {[...d.requiredDocs, ...OPTIONAL_DOCS].map((t) => (
          <DocRow key={t} type={t as DocumentType} required={d.requiredDocs.includes(t)} docs={byType.get(t) ?? []} onUploaded={onChange} />
        ))}
      </div>
      {missing.length ? <Notice tone="warn">Still needed: {missing.map((t) => DOCUMENT_TYPE_LABELS[t as DocumentType]).join(", ")}</Notice> : null}
      <Nav onBack={onBack} label="Continue" onNext={onNext} />
    </>
  );
}

function DocRow({ type, required, docs, onUploaded }: { type: DocumentType; required: boolean; docs: EmployeeDocument[]; onUploaded: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("file", file);
      return api.upload("/ess/documents", fd);
    },
    onSuccess: () => {
      toast.success(`${DOCUMENT_TYPE_LABELS[type]} uploaded`);
      onUploaded();
    },
  });
  const has = docs.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5" style={{ background: "var(--color-surface)" }}>
      <FileText size={18} style={{ color: has ? "var(--ok)" : "var(--color-accent)", flex: "none" }} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{DOCUMENT_TYPE_LABELS[type]}{required ? "" : " (optional)"}</div>
        <div className="text-muted truncate text-[12px]">{has ? docs.map((x) => x.name).join(", ") : required ? "Required" : "Upload if you have it"}</div>
      </div>
      {has ? <StatusTag status="pending" label="Uploaded" /> : null}
      <input ref={ref} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) m.mutate(f); e.target.value = ""; }} />
      <Button size="sm" loading={m.isPending} onClick={() => ref.current?.click()}>
        <Upload size={14} />
        {has ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}

function ReviewStep({ d, onBack, goTo, onSubmitted }: { d: OnbData; onBack: () => void; goTo: (s: Step) => void; onSubmitted: () => void }) {
  const [consent, setConsent] = useState(false);
  const p = d.profile;
  const missing = STEPS.filter((s) => s !== "review" && !d.completedSteps.includes(s));
  const submit = useMutation({ mutationFn: () => api.post("/ess/onboarding/submit"), onSuccess: () => { toast.success("Submitted to HR"); onSubmitted(); } });
  const Section = ({ title, step, children }: { title: string; step: Step; children: React.ReactNode }) => (
    <div className="flex flex-col gap-2.5 border-b border-[var(--color-divider)] pb-3.5 last:border-0">
      <div className="flex items-center justify-between">
        <div className="font-medium">{title}</div>
        <Button size="sm" variant="ghost" onClick={() => goTo(step)}>Edit</Button>
      </div>
      <div className="grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-2">{children}</div>
    </div>
  );
  return (
    <>
      <Notice tone="sel">Joining {p.company}{p.designation ? ` as ${p.designation}` : ""} on {fmtDate(p.dateOfJoining)}. Work email {p.workEmail}.</Notice>
      <Section title="Personal" step="personal">
        <KV label="Name">{p.fullName}</KV>
        <KV label="Date of birth">{fmtDate(p.dateOfBirth)}</KV>
        <KV label="Gender"><span className="capitalize">{p.gender ?? "—"}</span></KV>
        <KV label="Mobile">{p.phone}</KV>
      </Section>
      <Section title="Address & nominee" step="address">
        <KV span label="Current address">{p.currentAddress}</KV>
        <KV label="Emergency contact">{p.emergencyContactName ? `${p.emergencyContactName} (${p.emergencyContactRelation ?? ""}) · ${p.emergencyContactPhone ?? ""}` : "—"}</KV>
      </Section>
      <Section title="Bank" step="bank">
        <KV label="Bank">{p.bankName}</KV>
        <KV label="Account">{p.accountLast4 ? `···· ${p.accountLast4}` : "—"}</KV>
        <KV label="IFSC">{p.ifsc}</KV>
      </Section>
      <Section title="PAN, UAN & tax" step="tax">
        <KV label="PAN">{p.pan}</KV>
        <KV label="Aadhaar">{p.aadhaarLast4 ? `XXXX XXXX ${p.aadhaarLast4}` : "—"}</KV>
        <KV label="UAN">{p.uan || "First job"}</KV>
        <KV label="Tax regime">{p.taxRegime === "old" ? "Old regime" : "New regime"}</KV>
      </Section>
      <Section title="Documents" step="documents">
        <KV span label="Uploaded">{d.documents.length ? d.documents.map((x) => DOCUMENT_TYPE_LABELS[x.type as DocumentType] ?? x.name).join(", ") : "None yet"}</KV>
      </Section>
      {missing.length ? <Notice tone="warn">Finish these first: {missing.map((s) => ONBOARDING_STEP_LABELS[s]).join(", ")}</Notice> : null}
      <Checkbox checked={consent} onChange={setConsent} label={<span className="text-[13px]">I confirm these details are correct, and I consent to {p.company} processing them for employment, payroll and statutory compliance under the DPDP Act, 2023.</span>} />
      <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--color-divider)] pt-3">
        <Button onClick={onBack}><ChevronLeft size={16} />Back</Button>
        <Button variant="primary" disabled={!consent || missing.length > 0} loading={submit.isPending} onClick={() => submit.mutate()}>Submit to HR</Button>
      </div>
    </>
  );
}

