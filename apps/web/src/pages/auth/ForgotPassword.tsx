import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { AuthShell } from "./AuthShell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/request-password-reset", { email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the email");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell>
      <form onSubmit={submit} className="card elev-md flex w-full max-w-[420px] flex-col !gap-[18px] !p-9">
        <div>
          <h2 className="!mb-1.5 text-[28px]">Reset your password</h2>
          <div className="text-muted text-[14px]">We'll email you a link to choose a new one.</div>
        </div>
        {sent ? (
          <Notice tone="ok">If an account exists for {email}, a reset link is on its way. It works for one hour.</Notice>
        ) : (
          <>
            {error ? <Notice tone="bad">{error}</Notice> : null}
            <Field label="Work email" htmlFor="email">
              <Input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={!email}>
              Send reset link
            </Button>
          </>
        )}
        <Link to="/login" className="text-[13px] no-underline">
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
