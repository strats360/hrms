import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setActiveTenant } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { authMessage } from "@/lib/auth-errors";
import { Notice } from "@/components/ui/page";
import { AuthShell } from "./AuthShell";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // second step when two-factor sign-in is on
  const [step, setStep] = useState<"password" | "code">("password");
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useSession();

  const done = async () => {
    setActiveTenant(null);
    await qc.invalidateQueries({ queryKey: ["me"] });
    const next = params.get("next");
    nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ twoFactorRedirect?: boolean }>("/auth/sign-in/email", { email: email.trim(), password, rememberMe: true });
      if (r?.twoFactorRedirect) {
        setStep("code");
        setCode("");
        return;
      }
      await done();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("That email and password don't match. Check them and try again.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clean = useBackup ? code.trim() : code.replace(/\s/g, "");
      await api.post(useBackup ? "/auth/two-factor/verify-backup-code" : "/auth/two-factor/verify-totp", { code: clean, trustDevice: trust });
      await done();
    } catch (err) {
      const msg = authMessage(err);
      setError(msg);
      // the code step expired or was used up: start again from the password
      if (err instanceof ApiError && ["INVALID_TWO_FACTOR_COOKIE", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"].includes(err.code ?? "")) {
        setStep("password");
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === "code") {
    return (
      <AuthShell>
        <form onSubmit={verify} className="card elev-md flex w-full max-w-[420px] flex-col !gap-[18px] !p-9" noValidate>
          <div>
            <h2 className="!mb-1.5 text-[30px]">{useBackup ? "Enter a backup code" : "Enter your code"}</h2>
            <div className="text-muted text-[14px]">{useBackup ? "Use one of the backup codes you saved when you set up two-factor sign-in. Each works once." : "Open your authenticator app and enter the 6-digit code for Strats360 People."}</div>
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Field label={useBackup ? "Backup code" : "6-digit code"} htmlFor="code">
            <Input id="code" inputMode={useBackup ? "text" : "numeric"} autoComplete="one-time-code" autoFocus maxLength={useBackup ? 24 : 7} value={code} onChange={(e) => setCode(e.target.value)} placeholder={useBackup ? "xxxxx-xxxxx" : "123 456"} />
          </Field>
          <Checkbox checked={trust} onChange={setTrust} label="Trust this device for 30 days" />
          <Button type="submit" variant="primary" block loading={busy} disabled={useBackup ? code.trim().length < 6 : code.replace(/\s/g, "").length !== 6}>
            Verify
          </Button>
          <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--color-divider)] pt-3 text-[13px]">
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-[var(--color-link,var(--sel-fg))]"
              onClick={() => {
                setUseBackup(!useBackup);
                setCode("");
                setError(null);
              }}
            >
              {useBackup ? "Use my authenticator app" : "Lost your phone? Use a backup code"}
            </button>
            <button
              type="button"
              className="text-muted cursor-pointer border-0 bg-transparent p-0 text-[13px]"
              onClick={() => {
                setStep("password");
                setPassword("");
                setError(null);
              }}
            >
              Back
            </button>
          </div>
          {useBackup ? <div className="text-muted text-[12.5px]">No backup codes either? Ask your company admin to reset two-factor sign-in for you.</div> : null}
        </form>
      </AuthShell>
    );
  }

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
