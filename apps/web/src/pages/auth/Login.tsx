import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setActiveTenant } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { AuthShell } from "./AuthShell";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/sign-in/email", { email: email.trim(), password, rememberMe: true });
      setActiveTenant(null);
      await qc.invalidateQueries({ queryKey: ["me"] });
      const next = params.get("next");
      nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("That email and password don't match. Check them and try again.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="card elev-md flex w-full max-w-[420px] flex-col !gap-[18px] !p-9" noValidate>
        <div>
          <h2 className="!mb-1.5 text-[30px]">Sign in</h2>
          <div className="text-muted text-[14px]">Admins, employees and platform staff all sign in here.</div>
        </div>
        {me ? (
          <Notice tone="sel">
            You're signed in as {me.user.email}. <Link to="/">Continue</Link>
          </Notice>
        ) : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex items-center justify-end text-[13px]">
          <Link to="/forgot-password" className="no-underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" block loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--color-divider)] pt-3 text-[13px]">
          <Link to="/signup" className="no-underline">
            New company? Start free trial
          </Link>
          <span className="text-muted">Got an invite? Use the link in your email.</span>
        </div>
      </form>
    </AuthShell>
  );
}
