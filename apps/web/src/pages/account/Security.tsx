import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, KeyRound, LogOut, Monitor, ShieldCheck } from "lucide-react";
import { renderSVG } from "uqr";
import { api } from "@/lib/api";
import { authMessage } from "@/lib/auth-errors";
import { useSession } from "@/lib/session";
import { Brand } from "@/components/layout/Sidebar";
import { ThemeToggle } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { MyNotificationsCard } from "@/components/account/Notifications";

/** Sign-in and security for the signed-in person: two-factor, password, devices. */
export default function Security() {
  const { me, tenant, needsTwoFactor, signOut } = useSession();
  const [params] = useSearchParams();
  const on = !!me?.user.twoFactorEnabled;
  const required = !!tenant?.twoFactorRequired;
  const back = tenant?.roleId ? "/" : tenant?.employeeId ? "/me" : me?.platformRole ? "/platform" : "/";

  return (
    <div className="min-h-screen pb-12" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="border-b border-[var(--color-divider)]">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 px-4 py-2.5">
          <div className="-mb-[18px]">
            <Brand subtitle={tenant?.tenantName} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {needsTwoFactor ? null : (
              <Link to={back} className="btn btn-secondary !text-[13px]">
                <ArrowLeft size={15} /> Back
              </Link>
            )}
            <Button icon onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 pt-6">
        <div>
          <h1 className="!mb-1 text-[26px]">Your account</h1>
          <div className="text-muted text-[14px]">{me?.user.email}</div>
        </div>
        {needsTwoFactor || params.get("required") ? (
          needsTwoFactor ? (
            <Notice tone="warn">{tenant?.tenantName} requires two-factor sign-in. Set it up below to continue.</Notice>
          ) : (
            <Notice tone="ok">
              Two-factor sign-in is on. <Link to={back}>Continue to {tenant?.tenantName ?? "the app"}</Link>
            </Notice>
          )
        ) : null}
        <TwoFactorCard on={on} required={required} />
        {needsTwoFactor ? null : <MyNotificationsCard />}
        <PasswordCard />
        <SessionsCard />
      </main>
    </div>
  );
}

function TwoFactorCard({ on, required }: { on: boolean; required: boolean }) {
  const [mode, setMode] = useState<null | "setup" | "codes" | "off">(null);
  return (
    <Card className="!gap-3">
      <CardHeader
        icon={<ShieldCheck size={18} />}
        title={
          <span className="flex items-center gap-2">
            Two-factor sign-in <Tag tone={on ? "ok" : "neutral"}>{on ? "On" : "Off"}</Tag>
          </span>
        }
        sub="After your password, enter a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy. It stops anyone who learns your password from signing in."
      />
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            <Button onClick={() => setMode("codes")}>
              <KeyRound size={15} /> New backup codes
            </Button>
            <Button variant="ghost" disabled={required} title={required ? "Your company requires two-factor sign-in" : undefined} onClick={() => setMode("off")}>
              Turn off
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setMode("setup")}>
            Set up two-factor sign-in
          </Button>
        )}
      </div>
      {on && required ? <div className="text-muted text-[12.5px]">Your company requires two-factor sign-in, so it can't be turned off. Lost your phone? Use a backup code, or ask your admin to reset it.</div> : null}
      {mode === "setup" ? <SetupDialog onClose={() => setMode(null)} /> : null}
      {mode === "codes" ? <BackupCodesDialog onClose={() => setMode(null)} /> : null}
      {mode === "off" ? <TurnOffDialog onClose={() => setMode(null)} /> : null}
    </Card>
  );
}

function SetupDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const [step, setStep] = useState<"password" | "scan" | "codes">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [data, setData] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qr = useMemo(() => (data ? renderSVG(data.totpURI, { border: 1 }) : ""), [data]);
  const secret = data ? (new URL(data.totpURI).searchParams.get("secret") ?? "") : "";

  const start = useMutation({
    mutationFn: () => api.post<{ totpURI: string; backupCodes: string[] }>("/auth/two-factor/enable", { password }),
    onSuccess: (d) => {
      setData(d);
      setError(null);
      setStep("scan");
    },
    onError: (e) => setError(authMessage(e)),
  });
  const verify = useMutation({
    mutationFn: () => api.post("/auth/two-factor/verify-totp", { code: code.replace(/\s/g, "") }),
    onSuccess: async () => {
      setError(null);
      setStep("codes");
      await refresh();
    },
    onError: (e) => setError(authMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "password") start.mutate();
    else if (step === "scan") verify.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && step !== "codes" && onClose()}
      title={step === "codes" ? "Save your backup codes" : "Set up two-factor sign-in"}
      description={
        step === "password"
          ? "Confirm your password to start."
          : step === "scan"
            ? "Scan the QR code with your authenticator app, then enter the 6-digit code it shows."
            : "Two-factor sign-in is on. If you lose your phone, each of these codes signs you in once. Keep them somewhere safe, away from your phone."
      }
      footer={
        step === "codes" ? (
          <Button variant="primary" onClick={onClose}>
            I've saved them
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="tf-setup" loading={start.isPending || verify.isPending} disabled={step === "password" ? !password : code.replace(/\s/g, "").length !== 6}>
              {step === "password" ? "Continue" : "Turn on"}
            </Button>
          </>
        )
      }
    >
      <form id="tf-setup" onSubmit={submit} className="flex flex-col gap-3">
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {step === "password" ? (
          <Field label="Password" htmlFor="tf-password">
            <Input id="tf-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : null}
        {step === "scan" && data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <div className="mx-auto w-[180px] rounded-[var(--radius-md)] bg-white p-2" aria-label="QR code for your authenticator app" role="img" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="flex min-w-0 flex-col gap-1.5 text-[13px]">
                <div className="text-muted">Can't scan? Enter this key in the app instead:</div>
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 break-all rounded-[var(--radius-sm)] bg-[var(--tint-1)] px-2 py-1 text-[12.5px]">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                  <Button size="sm" variant="ghost" icon aria-label="Copy key" onClick={() => copy(secret, "Key copied")}>
                    <Copy size={14} />
                  </Button>
                </div>
                <div className="text-muted">Choose "time-based" if the app asks.</div>
              </div>
            </div>
            <Field label="6-digit code" htmlFor="tf-code">
              <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
            </Field>
          </>
        ) : null}
        {step === "codes" && data ? <CodeList codes={data.backupCodes} /> : null}
      </form>
    </Dialog>
  );
}

function BackupCodesDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => api.post<{ backupCodes: string[] }>("/auth/two-factor/generate-backup-codes", { password }),
    onSuccess: (d) => setCodes(d.backupCodes),
    onError: (e) => setError(authMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={codes ? "Your new backup codes" : "New backup codes"}
      description={codes ? "Your old codes no longer work. Each of these signs you in once." : "This replaces all your current backup codes. Confirm your password to continue."}
      footer={
        codes ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="tf-codes" disabled={!password} loading={gen.isPending}>
              Create new codes
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <CodeList codes={codes} />
      ) : (
        <form
          id="tf-codes"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            gen.mutate();
          }}
        >
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <Field label="Password" htmlFor="tf-codes-password">
            <Input id="tf-codes-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </form>
      )}
    </Dialog>
  );
}

function TurnOffDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const off = useMutation({
    mutationFn: () => api.post("/auth/two-factor/disable", { password }),
    onSuccess: async () => {
      toast.success("Two-factor sign-in is off");
      await refresh();
      onClose();
    },
    onError: (e) => setError(authMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Turn off two-factor sign-in?"
      description="You'll sign in with just your password. Your backup codes and trusted devices stop working."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" type="submit" form="tf-off" disabled={!password} loading={off.isPending}>
            Turn off
          </Button>
        </>
      }
    >
      <form
        id="tf-off"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          off.mutate();
        }}
      >
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Field label="Password" htmlFor="tf-off-password">
          <Input id="tf-off-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function CodeList({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const save = () => {
    const url = URL.createObjectURL(new Blob([`Strats360 People backup codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "strats360-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 font-mono text-[14px]" data-testid="backup-codes">
        {codes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => copy(text, "Codes copied")}>
          <Copy size={14} /> Copy
        </Button>
        <Button size="sm" onClick={save}>
          <Download size={14} /> Download
        </Button>
      </div>
    </div>
  );
}

function copy(text: string, msg: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(msg),
    () => toast.error("Couldn't copy. Select the text and copy it instead."),
  );
}

function PasswordCard() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [others, setOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword: f.current, newPassword: f.next, revokeOtherSessions: others }),
    onSuccess: () => {
      toast.success(others ? "Password changed. Other devices are signed out." : "Password changed");
      setF({ current: "", next: "", confirm: "" });
      setError(null);
      qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (e) => setError(authMessage(e)),
  });
  const mismatch = !!f.confirm && f.next !== f.confirm;
  return (
    <Card className="!gap-3">
      <CardHeader icon={<KeyRound size={18} />} title="Password" sub="At least 10 characters. A short sentence is easier to remember than a jumble." />
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.next.length < 10) return setError("Use at least 10 characters.");
          save.mutate();
        }}
      >
        {error ? (
          <div className="sm:col-span-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="pw-new">
          <Input id="pw-new" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? "Doesn't match" : null}>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={f.confirm} invalid={mismatch} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
          <Checkbox checked={others} onChange={setOthers} label="Sign out my other devices" />
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!f.current || !f.next || f.next !== f.confirm}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface AuthSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function SessionsCard() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["auth", "sessions"], queryFn: () => api.get<AuthSession[]>("/auth/list-sessions") });
  const current = useQuery({ queryKey: ["auth", "current"], queryFn: () => api.get<{ session: { id: string } } | null>("/auth/get-session") });
  const revoke = useMutation({
    mutationFn: () => api.post("/auth/revoke-other-sessions"),
    onSuccess: () => {
      toast.success("Signed out of your other devices");
      qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (e) => toast.error(authMessage(e)),
  });
  const rows = [...(list.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const others = rows.filter((s) => s.id !== current.data?.session.id).length;
  return (
    <Card className="!gap-3">
      <CardHeader
        icon={<Monitor size={18} />}
        title="Where you're signed in"
        sub="Sign-ins last 7 days. If you see a device you don't recognise, sign it out and change your password."
        actions={
          <Button disabled={!others} loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Sign out other devices
          </Button>
        }
      />
      <div className="flex flex-col divide-y divide-[var(--color-divider)] text-[13px]">
        {rows.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium">{device(s.userAgent)}</div>
              <div className="text-muted text-[12px]">
                {s.ipAddress ?? "Unknown IP"} · signed in {new Date(s.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
              </div>
            </div>
            {s.id === current.data?.session.id ? <Tag tone="ok">This device</Tag> : null}
          </div>
        ))}
        {list.isLoading ? <div className="text-muted py-2">Loading…</div> : null}
      </div>
    </Card>
  );
}
