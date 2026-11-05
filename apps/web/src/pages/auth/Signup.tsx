import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { companySignupSchema, INDIAN_STATES } from "@hrms/shared";
import { api, setActiveTenant } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { COMPANY_STEPS, StepRail, WizardFrame } from "@/components/onboarding/PublicShell";
import { apiFieldErrors, zodErrors } from "@/components/onboarding/form";

const EMPTY = { adminName: "", email: "", phone: "", password: "", role: "HR head", companySize: "21–100", companyName: "", legalName: "", state: "Gujarat" };

/** Company self-signup: step 1 of the company onboarding wizard. */
export default function Signup() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const signup = useMutation({
    mutationFn: (body: unknown) => api.post<{ tenantId: string }>("/public/signup", body),
    meta: { silent: true },
    onSuccess: async (r) => {
      setActiveTenant(r.tenantId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/setup", { replace: true });
    },
    onError: (e) => {
      setErrors(apiFieldErrors(e));
      setFormErr(e instanceof Error ? e.message : "Sign up failed");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    const parsed = companySignupSchema.safeParse({ ...f, legalName: f.legalName || f.companyName });
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    signup.mutate(parsed.data);
  };

  return (
    <WizardFrame
      rail={
        <>
          <div>
            <div className="text-[22px] font-medium tracking-[-0.01em]">Set up your company</div>
            <div className="text-muted text-[13px]">About 10 minutes. You can save and come back.</div>
          </div>
          <StepRail steps={COMPANY_STEPS.map((s, i) => ({ ...s, state: i === 0 ? "current" : "todo" }))} />
        </>
      }
      footnote="30-day trial · no card needed · data stored in India"
    >
      <div>
        <div className="card-kicker">Step 1 of 6</div>
        <div className="text-[26px] font-medium tracking-[-0.015em]">Account</div>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" error={errors.adminName}>
            <Input value={f.adminName} onChange={set("adminName")} autoComplete="name" invalid={!!errors.adminName} />
          </Field>
          <Field label="Work email" error={errors.email}>
            <Input type="email" value={f.email} onChange={set("email")} autoComplete="email" invalid={!!errors.email} />
          </Field>
          <Field label="Mobile" error={errors.phone}>
            <Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+91 98240 11872" autoComplete="tel" invalid={!!errors.phone} />
          </Field>
          <Field label="Password" error={errors.password} hint="At least 10 characters">
            <Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" invalid={!!errors.password} />
          </Field>
          <Field label="Your role">
            <Select value={f.role} onChange={set("role")}>
              {["HR head", "Founder / director", "Finance / accounts", "Payroll consultant (CA)"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Company size">
            <Select value={f.companySize} onChange={set("companySize")}>
              {["1–20", "21–100", "101–500", "500+"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Company name" error={errors.companyName}>
            <Input value={f.companyName} onChange={set("companyName")} autoComplete="organization" invalid={!!errors.companyName} />
          </Field>
          <Field label="Legal name" hint="As on your GST or PAN. Leave blank if same." error={errors.legalName}>
            <Input value={f.legalName} onChange={set("legalName")} />
          </Field>
          <Field label="State of registered office" error={errors.state}>
            <Select value={f.state} onChange={set("state")}>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-divider)] pt-3">
          <div className="text-muted text-[13px]">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
          <Button type="submit" variant="primary" loading={signup.isPending}>
            Create account & continue
          </Button>
        </div>
        <div className="text-muted text-[12px]">By continuing you agree to the terms of service and privacy policy. Your data is processed under the DPDP Act, 2023.</div>
      </form>
    </WizardFrame>
  );
}
