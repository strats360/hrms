import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setActiveTenant } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Loading, Notice } from "@/components/ui/page";
import { BrandMark, CenteredPage } from "@/components/onboarding/PublicShell";

interface AdminInviteInfo {
  companyName: string;
  role: string | null;
  name: string;
  email: string;
  hasAccount: boolean;
}

/** Accept an invitation to a company's admin console. */
export default function AdminInvite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["admin-invite", token], queryFn: () => api.get<AdminInviteInfo>(`/public/admin-invite/${token}`), retry: false });
  const accept = useMutation({
    mutationFn: () => api.post<{ tenantId: string }>("/public/admin-invite/accept", { token, password: pw }),
    meta: { silent: true },
    onSuccess: async (r) => {
      setActiveTenant(r.tenantId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/", { replace: true });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not accept the invite"),
  });

  if (q.isLoading) return <CenteredPage><Loading /></CenteredPage>;
  if (q.isError || !q.data)
    return (
      <CenteredPage width={480}>
        <BrandMark />
        <Card elev="md" className="!gap-3">
          <div className="text-[20px] font-medium">This invite isn't valid any more</div>
          <div className="text-muted text-[14px]">It may have expired, been used already or been revoked. Ask the person who invited you to send a new one.</div>
          <Link to="/login" className="btn btn-primary self-start">Go to sign in</Link>
        </Card>
      </CenteredPage>
    );
  const d = q.data;
  return (
    <CenteredPage width={460}>
      <BrandMark />
      <Card elev="md" className="!gap-4 !p-8">
        <div>
          <h2 className="!mb-1.5 !text-[26px]">Join {d.companyName}</h2>
          <div className="text-muted text-[14px]">
            Hi {d.name}, you've been invited to the admin console{d.role ? <> as <b className="font-medium">{d.role}</b></> : null}.
          </div>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            if (pw.length < 10) return setErr("Use at least 10 characters");
            if (pw !== pw2) return setErr("The two passwords don't match");
            accept.mutate();
          }}
        >
          <Field label="Work email">
            <Input value={d.email} readOnly />
          </Field>
          <Field label={d.hasAccount ? "Set a new password" : "Create a password"} hint={d.hasAccount ? "You already have a login. This replaces your current password." : "At least 10 characters"}>
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          <Field label="Confirm password">
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          {err ? <Notice tone="bad">{err}</Notice> : null}
          <Button type="submit" variant="primary" block loading={accept.isPending}>
            Accept invite
          </Button>
        </form>
      </Card>
    </CenteredPage>
  );
}
