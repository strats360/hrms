import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Plus, Upload, Mail } from "lucide-react";
import { branchSchema, INDIAN_STATES, tenantProfileSchema } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { COMPANY_STEPS, StepRail, WizardFrame } from "@/components/onboarding/PublicShell";
import { apiFieldErrors, zodErrors } from "@/components/onboarding/form";

type StatKey = "epf" | "esi" | "pt" | "lwf" | "tds" | "bonus";
interface Tenant {
  id: string;
  name: string;
  legalName: string | null;
  entityType: string | null;
  industry: string | null;
  gstin: string | null;
  pan: string | null;
  tan: string | null;
  llpinCin: string | null;
  registeredAddress: string | null;
  state: string | null;
  setupStep: string;
  statutory: Partial<Record<StatKey, { enabled: boolean; registration?: string | null }>>;
  settings: { payrollCycle?: string; payDay?: string; paidDaysBasis?: string; weeklyOffs?: number[]; employeeCodePrefix?: string };
}
interface Branch {
  id: string;
  name: string;
  state: string;
  city: string | null;
  isHeadOffice: boolean;
}
interface Role {
  id: string;
  name: string;
  key: string | null;
}

const STAT: { key: StatKey; name: string; hint: string; ph: string }[] = [
  { key: "epf", name: "EPF & EPS", hint: "Provident fund establishment code", ph: "GJAHD1234567000" },
  { key: "esi", name: "ESI", hint: "ESIC employer code (17 digits)", ph: "37000123450001001" },
  { key: "pt", name: "Professional Tax", hint: "State PT registration", ph: "PT/BVN/2019/1123" },
  { key: "lwf", name: "Labour Welfare Fund", hint: "State LWF registration", ph: "LWF/GJ/88231" },
  { key: "tds", name: "TDS on salary", hint: "Uses your TAN", ph: "AHMS12345B" },
  { key: "bonus", name: "Statutory bonus", hint: "Payment of Bonus Act", ph: "Not needed" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Company setup wizard (steps 2-6), shown to the owner after signup. */
export default function CompanySetup() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { tenant: membership, can } = useSession();
  const tq = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<Tenant>("/admin/org/tenant"), enabled: !!membership?.roleId });
  const [step, setStep] = useState(1); // 1..5 => design steps 2..6

  useEffect(() => {
    if (tq.data) {
      const s = Number(tq.data.setupStep);
      if (s >= 1 && s <= 5) setStep(s);
    }
  }, [tq.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!membership?.roleId) return <Notice tone="warn">Only company admins can run setup. <Link to="/">Go back</Link></Notice>;
  if (!can("settings", "configure")) return <Notice tone="warn">Ask your super admin to finish company setup. <Link to="/">Go to dashboard</Link></Notice>;
  if (tq.isLoading || !tq.data) return <Loading />;

  const t = tq.data;
  const saveExit = () => {
    try {
      sessionStorage.setItem("skipSetup", "1");
    } catch {
      /* ignore */
    }
    nav("/");
  };
  const go = (n: number) => setStep(Math.max(1, Math.min(5, n)));

  return (
    <WizardFrame
      rail={
        <>
          <div>
            <div className="text-[22px] font-medium tracking-[-0.01em]">Set up {t.name}</div>
            <div className="text-muted text-[13px]">About 10 minutes. You can save and come back.</div>
          </div>
          <StepRail
            steps={COMPANY_STEPS.map((s, i) => ({
              ...s,
              state: i === 0 || i < step ? "done" : i === step ? "current" : "todo",
              onClick: i === 0 ? undefined : () => go(i),
            }))}
          />
        </>
      }
      footnote="30-day trial · no card needed · data stored in India"
    >
      <div>
        <div className="card-kicker">Step {step + 1} of 6</div>
        <div className="text-[26px] font-medium tracking-[-0.015em]">{COMPANY_STEPS[step]!.label}</div>
      </div>
      {step === 1 ? <CompanyDetails t={t} onDone={() => go(2)} onExit={saveExit} /> : null}
      {step === 2 ? <Statutory t={t} onBack={() => go(1)} onDone={() => go(3)} onExit={saveExit} /> : null}
      {step === 3 ? <BranchesPayroll t={t} onBack={() => go(2)} onDone={() => go(4)} onExit={saveExit} /> : null}
      {step === 4 ? <ImportStep onBack={() => go(3)} onDone={() => go(5)} onExit={saveExit} /> : null}
      {step === 5 ? (
        <InviteGoLive
          onBack={() => go(4)}
          onExit={saveExit}
          onFinish={async () => {
            await qc.invalidateQueries({ queryKey: ["me"] });
            await qc.invalidateQueries({ queryKey: ["tenant"] });
            toast.success("You're live. Welcome to Strats360 People.");
            nav("/", { replace: true });
          }}
        />
      ) : null}
    </WizardFrame>
  );
}

function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<Tenant>("/admin/org/setup", body),
    meta: { silent: true },
    onSuccess: (t) => qc.setQueryData(["tenant"], t),
  });
}

function Footer({ onBack, onExit, children }: { onBack?: () => void; onExit: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-[var(--color-divider)] pt-3">
      <div className="flex gap-2">
        {onBack ? (
          <Button onClick={onBack}>
            <ChevronLeft size={16} />
            Back
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onExit}>
          Save & exit
        </Button>
      </div>
      {children}
    </div>
  );
}

function CompanyDetails({ t, onDone, onExit }: { t: Tenant; onDone: () => void; onExit: () => void }) {
  const [f, setF] = useState({
    name: t.name ?? "",
    legalName: t.legalName ?? "",
    entityType: t.entityType ?? "LLP",
    industry: t.industry ?? "IT services & software",
    gstin: t.gstin ?? "",
    pan: t.pan ?? "",
    tan: t.tan ?? "",
    llpinCin: t.llpinCin ?? "",
    registeredAddress: t.registeredAddress ?? "",
    state: t.state ?? "Gujarat",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSetup();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  // PAN is characters 3-12 of a GSTIN; prefill it when the GSTIN looks complete.
  const onGstin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const g = e.target.value.toUpperCase();
    setF((s) => ({ ...s, gstin: g, pan: s.pan || (g.length === 15 ? g.slice(2, 12) : s.pan) }));
  };
  const submit = () => {
    const parsed = tenantProfileSchema.partial().safeParse(f);
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    save.mutate({ profile: parsed.data, setupStep: 2 }, { onSuccess: onDone, onError: (e) => { setErrors(apiFieldErrors(e)); toast.error(e.message); } });
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field span label="GSTIN" hint="PAN is filled in from the GSTIN. Check it before continuing." error={errors.gstin}>
          <Input value={f.gstin} onChange={onGstin} placeholder="24ABCFS1234K1Z5" maxLength={15} invalid={!!errors.gstin} />
        </Field>
        <Field label="Company name (shown in the app)" error={errors.name}>
          <Input value={f.name} onChange={set("name")} invalid={!!errors.name} />
        </Field>
        <Field label="Legal name" error={errors.legalName}>
          <Input value={f.legalName} onChange={set("legalName")} invalid={!!errors.legalName} />
        </Field>
        <Field label="Entity type">
          <Select value={f.entityType} onChange={set("entityType")}>
            {["LLP", "Private limited", "Public limited", "Partnership", "Proprietorship", "Trust / society"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Industry">
          <Select value={f.industry} onChange={set("industry")}>
            {["IT services & software", "Manufacturing", "Retail", "Healthcare", "Logistics", "Financial services", "Education", "Other"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="PAN" error={errors.pan}>
          <Input value={f.pan} onChange={set("pan")} placeholder="ABCFS1234K" maxLength={10} invalid={!!errors.pan} />
        </Field>
        <Field label="TAN" error={errors.tan}>
          <Input value={f.tan} onChange={set("tan")} placeholder="AHMS12345B" maxLength={10} invalid={!!errors.tan} />
        </Field>
        <Field label="LLPIN / CIN" error={errors.llpinCin}>
          <Input value={f.llpinCin} onChange={set("llpinCin")} />
        </Field>
        <Field label="State" error={errors.state}>
          <Select value={f.state} onChange={set("state")}>
            {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field span label="Registered address" error={errors.registeredAddress}>
          <Input value={f.registeredAddress} onChange={set("registeredAddress")} placeholder="Plot 12, Waghawadi Road, Bhavnagar 364002, Gujarat" />
        </Field>
      </div>
      <Footer onExit={onExit}>
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Continue
          <ChevronRight size={16} />
        </Button>
      </Footer>
    </>
  );
}

function Statutory({ t, onBack, onDone, onExit }: { t: Tenant; onBack: () => void; onDone: () => void; onExit: () => void }) {
  const [s, setS] = useState(() =>
    Object.fromEntries(STAT.map((x) => [x.key, { enabled: t.statutory?.[x.key]?.enabled ?? x.key !== "bonus", registration: t.statutory?.[x.key]?.registration ?? (x.key === "tds" ? t.tan ?? "" : "") }])) as Record<StatKey, { enabled: boolean; registration: string }>,
  );
  const save = useSetup();
  return (
    <>
      <div className="text-muted text-[13.5px]">Turn on what applies to you. Rates and due dates come from the platform statutory master for {t.state ?? "your state"}.</div>
      <div className="flex flex-col gap-2">
        {STAT.map((x) => {
          const v = s[x.key];
          return (
            <div key={x.key} className="grid items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]" style={{ background: "var(--color-surface)" }}>
              <div>
                <div className="text-[14px] font-medium">{x.name}</div>
                <div className="text-muted text-[12px]">{x.hint}</div>
              </div>
              <Input aria-label={`${x.name} registration`} value={v.registration} placeholder={x.ph} disabled={!v.enabled} onChange={(e) => setS((p) => ({ ...p, [x.key]: { ...v, registration: e.target.value } }))} />
              <Button size="sm" aria-pressed={v.enabled} onClick={() => setS((p) => ({ ...p, [x.key]: { ...v, enabled: !v.enabled } }))} style={{ color: v.enabled ? "var(--ok-fg)" : "var(--muted)" }}>
                {v.enabled ? "Applicable" : "Not applicable"}
              </Button>
            </div>
          );
        })}
      </div>
      <Footer onBack={onBack} onExit={onExit}>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { statutory: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { enabled: v.enabled, registration: v.enabled ? v.registration || null : null }])), setupStep: 3 },
              { onSuccess: onDone, onError: (e) => toast.error(e.message) },
            )
          }
        >
          Continue
          <ChevronRight size={16} />
        </Button>
      </Footer>
    </>
  );
}

function BranchesPayroll({ t, onBack, onDone, onExit }: { t: Tenant; onBack: () => void; onDone: () => void; onExit: () => void }) {
  const qc = useQueryClient();
  const bq = useQuery({ queryKey: ["branches"], queryFn: () => api.get<Branch[]>("/admin/org/branches") });
  const [adding, setAdding] = useState(false);
  const [nb, setNb] = useState({ name: "", city: "", state: t.state ?? "Gujarat", isHeadOffice: false });
  const [nbErr, setNbErr] = useState<Record<string, string>>({});
  const addBranch = useMutation({
    mutationFn: (b: unknown) => api.post<Branch>("/admin/org/branches", b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      setAdding(false);
      setNb({ name: "", city: "", state: t.state ?? "Gujarat", isHeadOffice: false });
    },
  });
  const [p, setP] = useState({
    payrollCycle: t.settings?.payrollCycle ?? "calendar_month",
    payDay: t.settings?.payDay ?? "last_working_day",
    paidDaysBasis: t.settings?.paidDaysBasis ?? "calendar",
    weeklyOffs: t.settings?.weeklyOffs ?? [0, 6],
    employeeCodePrefix: t.settings?.employeeCodePrefix ?? (t.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "EMP"),
  });
  const save = useSetup();
  const branches = bq.data ?? [];
  const toggleDay = (d: number) => setP((s) => ({ ...s, weeklyOffs: s.weeklyOffs.includes(d) ? s.weeklyOffs.filter((x) => x !== d) : [...s.weeklyOffs, d].sort() }));

  const submitBranch = () => {
    const parsed = branchSchema.safeParse({ ...nb, isHeadOffice: nb.isHeadOffice || branches.length === 0 });
    if (!parsed.success) return setNbErr(zodErrors(parsed.error));
    setNbErr({});
    addBranch.mutate(parsed.data);
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {branches.map((b, i) => (
          <Card key={b.id} padded={false} className="!gap-1.5 !p-4">
            <div className="card-kicker">Branch {i + 1}{b.isHeadOffice ? " · head office" : ""}</div>
            <div className="font-medium">{b.name}</div>
            <div className="text-muted text-[12.5px]">{[b.city, b.state].filter(Boolean).join(", ")}</div>
          </Card>
        ))}
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} className="card cursor-pointer items-start !gap-1.5 !p-4 text-[var(--color-text)]" style={{ border: "1px dashed var(--color-divider)", background: "transparent", font: "inherit" }}>
            <Plus size={18} />
            <span className="font-medium">Add branch</span>
            <span className="text-muted text-[12.5px]">{branches.length === 0 ? "Add your head office first" : "Another office or site"}</span>
          </button>
        ) : null}
      </div>
      {adding ? (
        <Card padded={false} className="!gap-3 !p-4" style={{ background: "var(--color-surface)" }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Branch name" error={nbErr.name}>
              <Input value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} placeholder="Bhavnagar HQ" autoFocus />
            </Field>
            <Field label="City">
              <Input value={nb.city} onChange={(e) => setNb({ ...nb, city: e.target.value })} />
            </Field>
            <Field label="State" hint="Decides PT and LWF rules" error={nbErr.state}>
              <Select value={nb.state} onChange={(e) => setNb({ ...nb, state: e.target.value })}>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox checked={nb.isHeadOffice || branches.length === 0} disabled={branches.length === 0} onChange={(v) => setNb({ ...nb, isHeadOffice: v })} label={<span className="text-[13px]">Head office</span>} />
            <div className="ml-auto flex gap-2">
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" loading={addBranch.isPending} onClick={submitBranch}>Save branch</Button>
            </div>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <Field label="Payroll cycle">
          <Select value={p.payrollCycle} onChange={(e) => setP({ ...p, payrollCycle: e.target.value })}>
            <option value="calendar_month">Monthly · 1st to month end</option>
            <option value="26_to_25">26th to 25th</option>
          </Select>
        </Field>
        <Field label="Pay day">
          <Select value={p.payDay} onChange={(e) => setP({ ...p, payDay: e.target.value })}>
            <option value="last_working_day">Last working day</option>
            <option value="1st_next">1st of next month</option>
            <option value="7th_next">7th of next month</option>
          </Select>
        </Field>
        <Field label="Paid days basis">
          <Select value={p.paidDaysBasis} onChange={(e) => setP({ ...p, paidDaysBasis: e.target.value })}>
            <option value="calendar">Calendar days</option>
            <option value="fixed_26">26 fixed days</option>
            <option value="working">Working days</option>
          </Select>
        </Field>
        <Field label="Employee ID prefix" hint={`IDs will look like ${p.employeeCodePrefix || "EMP"}-0001`}>
          <Input value={p.employeeCodePrefix} maxLength={6} onChange={(e) => setP({ ...p, employeeCodePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
        </Field>
      </div>
      <Field label="Weekly offs">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={p.weeklyOffs.includes(i)} onClick={() => toggleDay(i)} className="cursor-pointer rounded-[var(--radius-md)] border px-3 py-1.5 text-[13px]" style={{ borderColor: p.weeklyOffs.includes(i) ? "var(--color-accent)" : "var(--color-divider)", background: p.weeklyOffs.includes(i) ? "var(--sel-bg)" : "transparent", color: p.weeklyOffs.includes(i) ? "var(--sel-fg)" : "var(--color-text)" }}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      <div className="text-muted text-[12.5px]">A standard leave policy (CL 7, SL 7, EL 18 accruing monthly) and the General shift (09:00 to 18:00) are already set up. You can change them later in Leave and Attendance.</div>
      <Footer onBack={onBack} onExit={onExit}>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={branches.length === 0}
          title={branches.length === 0 ? "Add at least one branch" : undefined}
          onClick={() => {
            if (!/^[A-Z]{2,6}$/.test(p.employeeCodePrefix)) return toast.error("Employee ID prefix must be 2 to 6 letters");
            save.mutate({ payroll: p, setupStep: 4 }, { onSuccess: onDone, onError: (e) => toast.error(e.message) });
          }}
        >
          Continue
          <ChevronRight size={16} />
        </Button>
      </Footer>
    </>
  );
}

function ImportStep({ onBack, onDone, onExit }: { onBack: () => void; onDone: () => void; onExit: () => void }) {
  const [choice, setChoice] = useState<"import" | "invite" | "skip" | null>(null);
  const save = useSetup();
  const opts = [
    { k: "import" as const, icon: <Upload size={18} />, title: "Upload Excel / CSV", sub: "Use our template. You can import from Employees after setup." },
    { k: "invite" as const, icon: <Mail size={18} />, title: "Invite by email", sub: "Add each person with their work email. They fill in their own details." },
    { k: "skip" as const, icon: null, title: "Skip for now", sub: "Add employees from the dashboard" },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {opts.map((o) => (
          <button key={o.k} type="button" onClick={() => setChoice(o.k)} aria-pressed={choice === o.k} className="card cursor-pointer !gap-1.5 !p-[18px] text-left text-[var(--color-text)]" style={{ border: `1px solid ${choice === o.k ? "var(--color-accent)" : "var(--color-divider)"}`, font: "inherit" }}>
            {o.icon}
            <div className="font-medium">{o.title}</div>
            <div className="text-muted text-[12.5px]">{o.sub}</div>
          </button>
        ))}
      </div>
      {choice === "import" ? <Notice tone="sel">After you go live, open Employees and choose Bulk import. Rows with problems are shown before anything is saved.</Notice> : null}
      {choice === "invite" ? <Notice tone="ok">After you go live, use Employees › Add employee. Each new joiner gets a secure link to fill in PAN, bank and documents. You verify and activate them.</Notice> : null}
      <Footer onBack={onBack} onExit={onExit}>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ setupStep: 5 }, { onSuccess: onDone, onError: (e) => toast.error(e.message) })}>
          Continue
          <ChevronRight size={16} />
        </Button>
      </Footer>
    </>
  );
}

function InviteGoLive({ onBack, onExit, onFinish }: { onBack: () => void; onExit: () => void; onFinish: () => void }) {
  const rq = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/admin/access/roles") });
  const tq = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<Tenant>("/admin/org/tenant") });
  const bq = useQuery({ queryKey: ["branches"], queryFn: () => api.get<Branch[]>("/admin/org/branches") });
  const roles = (rq.data ?? []).filter((r) => r.key !== "super_admin");
  const [rows, setRows] = useState([{ name: "", email: "", roleId: "" }]);
  const [sent, setSent] = useState<string[]>([]);
  const invite = useMutation({ mutationFn: (b: unknown) => api.post("/admin/access/members/invite", b) });
  const save = useSetup();
  const t = tq.data;

  const sendAll = async () => {
    for (const r of rows.filter((x) => x.email.trim())) {
      if (!r.name.trim()) return toast.error(`Add a name for ${r.email}`);
      try {
        await invite.mutateAsync({ name: r.name.trim(), email: r.email.trim(), roleId: r.roleId || roles[0]?.id });
        setSent((s) => [...s, r.email.trim()]);
      } catch {
        return; // toast shown by the mutation cache
      }
    }
    setRows([{ name: "", email: "", roleId: "" }]);
    toast.success("Invites sent");
  };

  const checklist = [
    { label: "Company details", ok: !!(t?.legalName && t?.pan) },
    { label: "Statutory registrations", ok: !!t && Object.values(t.statutory ?? {}).some((v) => v?.enabled) },
    { label: "Branches", ok: (bq.data?.length ?? 0) > 0 },
    { label: "Payroll cycle and weekly offs", ok: !!t?.settings?.payrollCycle },
    { label: "Leave policy and shift", ok: true },
    { label: "Other admins invited", ok: sent.length > 0, note: sent.length ? `${sent.length} invited` : "Optional" },
  ];

  return (
    <>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1.3fr_1fr]">
            <Field label="Name">
              <Input value={r.name} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Krupa Joshi" />
            </Field>
            <Field label="Work email">
              <Input type="email" value={r.email} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="krupa.joshi@company.com" />
            </Field>
            <Field label="Role">
              <Select value={r.roleId || roles[0]?.id || ""} onChange={(e) => setRows((s) => s.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}>
                {roles.map((ro) => <option key={ro.id} value={ro.id}>{ro.name}</option>)}
              </Select>
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setRows((s) => [...s, { name: "", email: "", roleId: "" }])}>
            <Plus size={14} />
            Another person
          </Button>
          <Button size="sm" variant="primary" loading={invite.isPending} disabled={!rows.some((r) => r.email.trim())} onClick={sendAll}>
            Send invites
          </Button>
        </div>
        {sent.length ? <div className="flex flex-wrap gap-1.5">{sent.map((e) => <Tag key={e} tone="ok">{e}</Tag>)}</div> : null}
      </div>
      <Card padded={false} className="!gap-2.5 !p-[18px]" style={{ background: "var(--color-surface)" }}>
        <div className="font-medium">Setup checklist</div>
        {checklist.map((k) => (
          <div key={k.label} className="flex items-center gap-2.5 text-[13.5px]">
            <span className="grid h-5 w-5 flex-none place-items-center rounded-full" style={{ background: k.ok ? "var(--ok-bg)" : "var(--tint-2)", color: k.ok ? "var(--ok-fg)" : "var(--muted)" }}>
              {k.ok ? <Check size={12} /> : null}
            </span>
            {k.label}
            <span className="text-muted ml-auto text-[12px]">{k.note ?? (k.ok ? "Done" : "Pending")}</span>
          </div>
        ))}
      </Card>
      <Footer onBack={onBack} onExit={onExit}>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ completed: true, setupStep: 6 }, { onSuccess: onFinish, onError: (e) => toast.error(e.message) })}>
          Go live & open dashboard
        </Button>
      </Footer>
    </>
  );
}
