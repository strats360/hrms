import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { AuthShell } from "./AuthShell";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? "This reset link is invalid or has expired. Ask for a new one." : null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { newPassword: pw, token });
      nav("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the password");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell>
      <form onSubmit={submit} className="card elev-md flex w-full max-w-[420px] flex-col !gap-[18px] !p-9">
        <h2 className="!mb-0 text-[28px]">Choose a new password</h2>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {!token ? (
          <Notice tone="warn">
            This page needs the link from your email. <Link to="/forgot-password">Request a new link</Link>
          </Notice>
        ) : (
          <>
            <Field label="New password" hint="At least 10 characters" htmlFor="pw">
              <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </Field>
            <Field label="Confirm password" htmlFor="pw2">
              <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" block loading={busy}>
              Save password
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
