import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fmtDate } from "@hrms/shared";
import { api, setActiveTenant } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { BrandMark, CenteredPage } from "@/components/onboarding/PublicShell";

interface InviteInfo {
  companyName: string;
  employeeName: string;
  firstName: string;
  email: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  manager: string | null;
  dateOfJoining: string;
  expiresAt: string;
  expired: boolean;
  status: string;
}

/** Landing page for the employee self-onboarding email link. */
export default function InviteAccept() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<"welcome" | "password">("welcome");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["invite", token], queryFn: () => api.get<InviteInfo>(`/public/onboarding/${token}`), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post<{ tenantId: string }>("/public/onboarding/accept", { token, password: pw }),
    meta: { silent: true },
    onSuccess: async (r) => {
      setActiveTenant(r.tenantId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/me/onboarding", { replace: true });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not continue"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 10) return setErr("Use at least 10 characters");
    if (pw !== pw2) return setErr("The two passwords don't match");
    accept.mutate();
  };

  if (q.isLoading) return <CenteredPage><Loading /></CenteredPage>;
  if (q.isError || !q.data)
    return (
      <CenteredPage width={520}>
        <BrandMark />
        <Card elev="md" className="!gap-3">
          <div className="text-[20px] font-medium">This invite link doesn't work</div>
          <div className="text-muted text-[14px]">It may have been replaced by a newer invite. Ask HR to resend it, or sign in if you already set a password.</div>
          <Link to="/login" className="btn btn-primary self-start">Go to sign in</Link>
        </Card>
      </CenteredPage>
    );

  const d = q.data;
  const role = [d.designation, d.department].filter(Boolean).join(" in ");
  if (d.expired)
    return (
      <CenteredPage width={560}>
        <BrandMark name={d.companyName} />
        <Card elev="md" className="!gap-3">
          <div className="text-[20px] font-medium">Your invite has expired</div>
          <div className="text-muted text-[14px]">The link expired on {fmtDate(d.expiresAt.slice(0, 10))}. Please ask HR at {d.companyName} to resend it.</div>
        </Card>
      </CenteredPage>
    );

  return (
    <CenteredPage width={720}>
      <div className="text-muted flex justify-between text-[12.5px]">
        <span>Invite for {d.email}</span>
      </div>
      <Card elev="md" padded={false} className="!gap-0 overflow-hidden">
        <div className="flex flex-col gap-0.5 border-b border-[var(--color-divider)] px-5 py-4 text-[13px]">
          <div><span className="text-muted">From</span> {d.companyName} HR</div>
          <div><span className="text-muted">To</span> {d.email}</div>
          <div className="mt-1 text-[15px] font-medium">Welcome to {d.companyName}, {d.firstName}. Complete your joining details</div>
        </div>
        <div className="flex flex-col gap-3.5 px-6 py-7 text-[14px] leading-relaxed">
          <BrandMark name={d.companyName} />
          <div>Hi {d.firstName},</div>
          <div>
            We're glad you're joining{role ? <> as <b className="font-medium">{role}</b></> : null}, starting <b className="font-medium">{fmtDate(d.dateOfJoining)}</b>
            {d.branch ? <> at {d.branch}</> : null}.{d.manager ? <> Your manager is {d.manager}.</> : null}
          </div>
          <div>
            Please complete your joining details so we can set up payroll, PF and your first payslip. It takes about 8 minutes. Keep these handy: PAN, Aadhaar, bank account (cancelled cheque or passbook), UAN if you had PF before, and education certificates.
          </div>
          {step === "welcome" ? (
            <Button variant="primary" className="self-start !px-5 !py-2.5" onClick={() => setStep("password")}>
              {d.status === "in_progress" ? "Continue onboarding" : "Start onboarding"}
            </Button>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3 rounded-[var(--radius-md)] p-4" style={{ background: "var(--color-surface)" }}>
              <div className="font-medium">Create your password</div>
              <div className="text-muted text-[13px]">You'll sign in with {d.email}.</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Password" hint="At least 10 characters">
                  <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
                </Field>
                <Field label="Confirm password">
                  <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </Field>
              </div>
              {err ? <Notice tone="bad">{err}</Notice> : null}
              <Button type="submit" variant="primary" className="self-start" loading={accept.isPending}>
                Continue
              </Button>
            </form>
          )}
          <div className="text-muted text-[12.5px]">This secure link is only for you and expires on {fmtDate(d.expiresAt.slice(0, 10))}. Already set a password? <Link to="/login">Sign in</Link></div>
        </div>
      </Card>
      {accept.isError && !err ? <ErrorState error={accept.error} /> : null}
    </CenteredPage>
  );
}
