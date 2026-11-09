import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { INDIAN_STATES, tenantPayrollSettingsSchema, tenantProfileSchema } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";

interface Tenant {
  id: string;
  code: string;
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
  contactEmail: string | null;
  contactPhone: string | null;
  plan: string;
  status: string;
  settings: { payrollCycle?: string; payDay?: string; paidDaysBasis?: string; weeklyOffs?: number[]; employeeCodePrefix?: string; noticeDays?: number; probationNoticeDays?: number };
  statutory: Record<string, { enabled: boolean; registration?: string | null }>;
}

const PROFILE_FIELDS: [keyof Tenant, string][] = [
  ["name", "Brand name"],
  ["legalName", "Legal name"],
  ["entityType", "Entity type"],
  ["industry", "Industry"],
  ["llpinCin", "LLPIN / CIN"],
  ["pan", "PAN"],
  ["tan", "TAN"],
  ["gstin", "GSTIN"],
  ["contactEmail", "HR contact email"],
  ["contactPhone", "Contact phone"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STAT = [
  ["epf", "EPF establishment code"],
  ["esi", "ESIC employer code"],
  ["pt", "Professional Tax registration"],
  ["lwf", "Labour Welfare Fund registration"],
  ["tds", "TAN for TDS"],
  ["bonus", "Payment of Bonus Act"],
] as const;

export default function Organization() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tenant"], queryFn: () => api.get<Tenant>("/admin/org/tenant") });
  const [form, setForm] = useState<Partial<Tenant>>({});
  const [settings, setSettings] = useState<Tenant["settings"]>({});
  const [stat, setStat] = useState<Tenant["statutory"]>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      setForm(q.data);
      setSettings(q.data.settings ?? {});
      setStat(q.data.statutory ?? {});
    }
  }, [q.data]);
  const editable = can("settings", "edit");
  const configurable = can("settings", "configure");

  const saveProfile = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, form[k] ?? null]).concat([["registeredAddress", form.registeredAddress ?? null], ["state", form.state ?? null]]));
      const parsed = tenantProfileSchema.partial().safeParse(body);
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        throw new Error("Check the highlighted fields");
      }
      setErrors({});
      return api.patch("/admin/org/tenant", parsed.data);
    },
    onSuccess: () => {
      toast.success("Company details saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const saveSettings = useMutation({
    mutationFn: async () => {
      const parsed = tenantPayrollSettingsSchema.partial().safeParse(settings);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid settings");
      await api.patch("/admin/org/settings", parsed.data);
      await api.post("/admin/org/setup", { statutory: stat });
    },
    onSuccess: () => {
      toast.success("Policies saved");
      qc.invalidateQueries({ queryKey: ["tenant"] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const set = (k: keyof Tenant, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <Card className="!gap-4">
        <CardHeader title="Organization" sub={`Account ${q.data!.code} · ${q.data!.plan} plan`} />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {PROFILE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} error={errors[k]} htmlFor={`org-${k}`}>
              <Input id={`org-${k}`} value={(form[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} disabled={!editable} invalid={!!errors[k]} />
            </Field>
          ))}
          <Field label="State" htmlFor="org-state">
            <Select id="org-state" value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} disabled={!editable}>
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Registered address" span error={errors.registeredAddress} htmlFor="org-addr">
            <Input id="org-addr" value={form.registeredAddress ?? ""} onChange={(e) => set("registeredAddress", e.target.value)} disabled={!editable} />
          </Field>
        </div>
        {editable ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => q.data && setForm(q.data)}>Cancel</Button>
            <Button variant="primary" loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>
              Save changes
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="!gap-4">
        <CardHeader title="Payroll cycle & working week" sub="Used for attendance, leave day counts and (from phase 2) payroll." />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))" }}>
          <Field label="Payroll cycle">
            <Select value={settings.payrollCycle ?? "calendar_month"} onChange={(e) => setSettings((s) => ({ ...s, payrollCycle: e.target.value }))} disabled={!configurable}>
              <option value="calendar_month">Monthly · 1st to month end</option>
              <option value="26_to_25">26th to 25th</option>
            </Select>
          </Field>
          <Field label="Pay day">
            <Select value={settings.payDay ?? "last_working_day"} onChange={(e) => setSettings((s) => ({ ...s, payDay: e.target.value }))} disabled={!configurable}>
              <option value="last_working_day">Last working day</option>
              <option value="1st_next">1st of next month</option>
              <option value="7th_next">7th of next month</option>
            </Select>
          </Field>
          <Field label="Paid days basis">
            <Select value={settings.paidDaysBasis ?? "calendar"} onChange={(e) => setSettings((s) => ({ ...s, paidDaysBasis: e.target.value }))} disabled={!configurable}>
              <option value="calendar">Calendar days</option>
              <option value="fixed_26">26 fixed days</option>
              <option value="working">Working days</option>
            </Select>
          </Field>
          <Field label="Employee ID prefix" hint="New employees get IDs like STL-0254">
            <Input value={settings.employeeCodePrefix ?? "EMP"} maxLength={6} onChange={(e) => setSettings((s) => ({ ...s, employeeCodePrefix: e.target.value.toUpperCase() }))} disabled={!configurable} />
          </Field>
          <Field label="Notice period (days)" hint="Default for resignations and full and final">
            <Input type="number" min={0} max={180} value={settings.noticeDays ?? 30} onChange={(e) => setSettings((s) => ({ ...s, noticeDays: Number(e.target.value) }))} disabled={!configurable} />
          </Field>
          <Field label="Notice period on probation (days)">
            <Input type="number" min={0} max={180} value={settings.probationNoticeDays ?? 15} onChange={(e) => setSettings((s) => ({ ...s, probationNoticeDays: Number(e.target.value) }))} disabled={!configurable} />
          </Field>
        </div>
        <Field label="Weekly offs (company default)">
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <Checkbox
                key={d}
                label={d}
                disabled={!configurable}
                checked={(settings.weeklyOffs ?? [0, 6]).includes(i)}
                onChange={(v) => setSettings((s) => ({ ...s, weeklyOffs: v ? [...(s.weeklyOffs ?? [0, 6]), i].sort() : (s.weeklyOffs ?? [0, 6]).filter((x) => x !== i) }))}
              />
            ))}
          </div>
        </Field>
        <div className="card-title !mt-2 text-[15px]">Statutory registrations</div>
        <div className="flex flex-col gap-2">
          {STAT.map(([k, label]) => {
            const v = stat[k] ?? { enabled: false };
            return (
              <div key={k} className="grid items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]" style={{ background: "var(--tint-1)" }}>
                <div className="font-medium">{label}</div>
                <Input value={v.registration ?? ""} placeholder="Registration number" disabled={!configurable || !v.enabled} onChange={(e) => setStat((s) => ({ ...s, [k]: { ...v, registration: e.target.value } }))} aria-label={`${label} number`} />
                <Checkbox label={v.enabled ? "Applicable" : "Not applicable"} checked={v.enabled} disabled={!configurable} onChange={(on) => setStat((s) => ({ ...s, [k]: { ...v, enabled: on } }))} />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted text-[12.5px]">Financial year April to March · Timezone Asia/Kolkata (IST) · Currency INR with Indian grouping</span>
          {configurable ? (
            <Button variant="primary" loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
              Save policies
            </Button>
          ) : null}
        </div>
      </Card>
    </>
  );
}
