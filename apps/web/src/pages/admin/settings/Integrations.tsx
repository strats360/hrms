import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Send, Trash2 } from "lucide-react";
import { API_SCOPE_LABELS, API_SCOPES, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, fmtDate, type ApiScope, type WebhookEvent } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { confirmAction } from "@/components/ui/confirm";

interface Key {
  id: string;
  name: string;
  keyHint: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface Hook {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  secretHint: string;
  failed: number;
  pending: number;
  last: string | null;
}
interface Delivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
}

const day = (s: string | null) => (s ? fmtDate(s.slice(0, 10)) : "never");
const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success("Copied"), () => {});

/** API keys for reading data out, and webhooks for being told when things happen. */
export default function Integrations() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["integrations", "keys"], queryFn: () => api.get<{ endpoint: string; rows: Key[] }>("/admin/integrations/keys") });
  const hooks = useQuery({ queryKey: ["integrations", "hooks"], queryFn: () => api.get<{ rows: Hook[] }>("/admin/integrations/webhooks") });
  const [newKey, setNewKey] = useState<{ name: string; scopes: ApiScope[] } | null>(null);
  const [newHook, setNewHook] = useState<{ url: string; events: WebhookEvent[] } | null>(null);
  const [shown, setShown] = useState<{ title: string; value: string; note: string } | null>(null);
  const [log, setLog] = useState<Hook | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  const createKey = useMutation({
    mutationFn: () => api.post<Key & { key: string }>("/admin/integrations/keys", newKey),
    onSuccess: (k) => {
      setNewKey(null);
      setShown({ title: `API key for ${k.name}`, value: k.key, note: "Copy it now. It isn't shown again; if it's lost, revoke it and make a new one." });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createHook = useMutation({
    mutationFn: () => api.post<Hook & { secret: string }>("/admin/integrations/webhooks", newHook),
    onSuccess: (h) => {
      setNewHook(null);
      setShown({ title: "Webhook signing secret", value: h.secret, note: "Use it to check the X-Saralix-Signature header on each delivery. It isn't shown again." });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; responseCode: number | null; error: string | null }>(`/admin/integrations/webhooks/${id}/test`),
    onSuccess: (r) => (r.ok ? toast.success(`Test delivered (${r.responseCode})`) : toast.error(r.error ?? "Test didn't get through")),
    onSettled: refresh,
  });
  const toggle = useMutation({ mutationFn: (h: Hook) => api.patch(`/admin/integrations/webhooks/${h.id}`, { active: !h.active }), onSettled: refresh });

  if (keys.isLoading || hooks.isLoading) return <Loading />;
  if (keys.error) return <ErrorState error={keys.error} retry={() => keys.refetch()} />;

  return (
    <>
      <Card className="!gap-4">
        <CardHeader
          title="API keys"
          sub={<>Let another system read your data: a BI dashboard, an ERP or your own scripts. Keys are read only. Send them as <code>Authorization: Bearer sx_…</code> to <code>{keys.data?.endpoint}</code>, for example <code>GET /employees</code>, <code>/payroll/runs</code>, <code>/attendance?from=&amp;to=</code> and <code>/leave?from=&amp;to=</code>.</>}
          actions={<Button variant="primary" onClick={() => setNewKey({ name: "", scopes: ["employees:read"] })}><Plus size={14} /> New key</Button>}
        />
        {keys.data?.rows.length ? (
          <div className="flex flex-col divide-y divide-[var(--color-border)]">
            {keys.data.rows.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-semibold">{k.name} <span className="text-muted font-normal">…{k.keyHint}</span></div>
                  <div className="text-muted text-[12.5px]">{k.scopes.map((s) => API_SCOPE_LABELS[s]).join(" · ")} · last used {day(k.lastUsedAt)}</div>
                </div>
                {k.revokedAt ? (
                  <Tag tone="neutral">Revoked {day(k.revokedAt)}</Tag>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!(await confirmAction({ title: `Revoke ${k.name}?`, body: "Anything using it stops working straight away.", confirmLabel: "Revoke", danger: true }))) return;
                      await api.del(`/admin/integrations/keys/${k.id}`).catch((e) => toast.error(errorMessage(e)));
                      refresh();
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-[13.5px]">No keys yet.</div>
        )}
      </Card>

      <Card className="!gap-4">
        <CardHeader
          title="Webhooks"
          sub="We'll send a signed POST to your address when these things happen, and retry for about 15 hours if it doesn't answer with a 2xx. Payroll events carry run totals, never anyone's pay."
          actions={<Button variant="primary" onClick={() => setNewHook({ url: "https://", events: ["employee.created", "employee.updated"] })}><Plus size={14} /> New webhook</Button>}
        />
        {hooks.data?.rows.length ? (
          <div className="flex flex-col divide-y divide-[var(--color-border)]">
            {hooks.data.rows.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="break-all font-semibold">{h.url}</div>
                  <div className="text-muted text-[12.5px]">{h.events.join(", ")} · last delivered {day(h.last)}</div>
                  <div className="mt-1 flex gap-1.5">
                    {!h.active ? <Tag tone="neutral">Off</Tag> : null}
                    {h.pending ? <Tag tone="warn">{h.pending} retrying</Tag> : null}
                    {h.failed ? <Tag tone="bad">{h.failed} failed</Tag> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={test.isPending && test.variables === h.id} onClick={() => test.mutate(h.id)}><Send size={14} /> Test</Button>
                  <Button size="sm" onClick={() => setLog(h)}>Deliveries</Button>
                  <Button size="sm" onClick={() => toggle.mutate(h)}>{h.active ? "Turn off" : "Turn on"}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove webhook"
                    onClick={async () => {
                      if (!(await confirmAction({ title: "Remove this webhook?", body: h.url, confirmLabel: "Remove", danger: true }))) return;
                      await api.del(`/admin/integrations/webhooks/${h.id}`).catch((e) => toast.error(errorMessage(e)));
                      refresh();
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted text-[13.5px]">No webhooks yet.</div>
        )}
        <div className="text-muted text-[12px]">
          To check a delivery, take <code>t</code> from the <code>X-Saralix-Signature</code> header, compute HMAC SHA-256 of <code>t.body</code> with your signing secret, and compare it with <code>v1</code>. Reject timestamps older than five minutes.
        </div>
      </Card>

      <Dialog
        open={!!newKey}
        onOpenChange={(v) => !v && setNewKey(null)}
        title="New API key"
        footer={<><Button onClick={() => setNewKey(null)}>Cancel</Button><Button variant="primary" loading={createKey.isPending} onClick={() => createKey.mutate()}>Create key</Button></>}
      >
        {newKey ? (
          <div className="flex flex-col gap-3">
            <Field label="Name" hint="The system that will use it"><Input value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} placeholder="Power BI" /></Field>
            <Field label="It can read">
              <div className="flex flex-col gap-2 pt-1">
                {API_SCOPES.map((s) => (
                  <Checkbox key={s} checked={newKey.scopes.includes(s)} onChange={(v) => setNewKey({ ...newKey, scopes: v ? [...newKey.scopes, s] : newKey.scopes.filter((x) => x !== s) })} label={API_SCOPE_LABELS[s]} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={!!newHook}
        onOpenChange={(v) => !v && setNewHook(null)}
        title="New webhook"
        footer={<><Button onClick={() => setNewHook(null)}>Cancel</Button><Button variant="primary" loading={createHook.isPending} onClick={() => createHook.mutate()}>Add webhook</Button></>}
      >
        {newHook ? (
          <div className="flex flex-col gap-3">
            <Field label="Address" hint="A public https address"><Input value={newHook.url} onChange={(e) => setNewHook({ ...newHook, url: e.target.value })} /></Field>
            <Field label="Send when">
              <div className="flex flex-col gap-2 pt-1">
                {WEBHOOK_EVENTS.map((ev) => (
                  <Checkbox key={ev} checked={newHook.events.includes(ev)} onChange={(v) => setNewHook({ ...newHook, events: v ? [...newHook.events, ev] : newHook.events.filter((x) => x !== ev) })} label={<span>{WEBHOOK_EVENT_LABELS[ev]} <span className="text-muted">({ev})</span></span>} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={!!shown} onOpenChange={(v) => !v && setShown(null)} title={shown?.title ?? ""} footer={<Button variant="primary" onClick={() => setShown(null)}>Done</Button>}>
        {shown ? (
          <div className="flex flex-col gap-3">
            <Notice tone="warn">{shown.note}</Notice>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[var(--radius-md)] bg-[var(--tint-1)] p-2 text-[12.5px]">{shown.value}</code>
              <Button size="sm" aria-label="Copy" onClick={() => copy(shown.value)}><Copy size={14} /></Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {log ? <DeliveryLog hook={log} onClose={() => setLog(null)} /> : null}
    </>
  );
}

function DeliveryLog({ hook, onClose }: { hook: Hook; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["integrations", "deliveries", hook.id], queryFn: () => api.get<{ rows: Delivery[] }>(`/admin/integrations/webhooks/${hook.id}/deliveries`) });
  const retry = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/admin/integrations/deliveries/${id}/retry`),
    onSuccess: (r) => (r.ok ? toast.success("Delivered") : toast.error("Still not getting through")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
  });
  const tone = { delivered: "ok", pending: "warn", failed: "bad" } as const;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Recent deliveries" description={hook.url} width={640} footer={<Button onClick={onClose}>Close</Button>}>
      {q.isLoading ? <Loading /> : !q.data?.rows.length ? <div className="text-muted text-[13.5px]">Nothing sent yet.</div> : (
        <div className="flex flex-col divide-y divide-[var(--color-border)]">
          {q.data.rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 text-[13px]">
                <div><b className="font-semibold">{d.event}</b> · {new Date(d.createdAt).toLocaleString("en-IN")}</div>
                <div className="text-muted text-[12px]">{d.attempts} {d.attempts === 1 ? "try" : "tries"}{d.responseCode ? ` · answered ${d.responseCode}` : ""}{d.lastError ? ` · ${d.lastError}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <Tag tone={tone[d.status]}>{d.status}</Tag>
                {d.status !== "delivered" ? <Button size="sm" loading={retry.isPending && retry.variables === d.id} onClick={() => retry.mutate(d.id)}>Retry now</Button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
