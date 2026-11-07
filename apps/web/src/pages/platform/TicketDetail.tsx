import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage, setActiveTenant } from "@/lib/api";
import type { TicketDetail as Detail } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice } from "@/components/ui/page";
import { CATEGORY_LABEL, formOf, PriorityTag, ReplyBox, SlaTag, Thread, TicketStatusTag } from "@/components/support/shared";

export default function TicketDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "support", "ticket", id], queryFn: () => api.get<Detail>(`/platform/support/tickets/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "support"] });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/platform/support/tickets/${id}`, b), onSuccess: () => (toast.success("Ticket updated"), refresh()) });
  const access = useMutation({
    mutationFn: () => api.post<{ tenantId: string }>(`/platform/support/tickets/${id}/access`),
    onSuccess: (a) => {
      // switch into the company's read-only view; a full reload picks up the session
      setActiveTenant(a.tenantId);
      window.location.href = "/";
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data;
  const open = ["open", "in_progress", "waiting_on_customer"].includes(t.status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button icon variant="ghost" aria-label="Back" onClick={() => nav("/platform/tickets")}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[20px] font-medium">
              #{t.number} · {t.subject}
            </div>
            <div className="text-muted text-[13px]">
              {t.tenantName} · {CATEGORY_LABEL[t.category] ?? t.category} · raised {fmtDate(t.createdAt.slice(0, 10))} by {t.raisedByName} ({t.raisedByEmail})
            </div>
          </div>
        </div>
        <Button variant="primary" disabled={!t.allowAccess || !open} title={!t.allowAccess ? "The customer hasn't allowed access on this ticket" : undefined} loading={access.isPending} onClick={() => access.mutate()}>
          <Eye size={15} /> {t.myAccess ? "Return to read-only view" : "View account (read-only)"}
        </Button>
      </div>
      {!t.allowAccess && open ? <Notice tone="sel">The customer hasn't allowed read-only access on this ticket. Ask them to switch it on from Help &amp; support if you need to look at their data.</Notice> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="!gap-3" style={{ padding: 18 }}>
          <Thread messages={t.thread} attachmentBase="/platform/support/attachments" viewer="platform" />
          {t.status !== "closed" ? (
            <ReplyBox
              internalOption
              onSend={async (body, files, internal) => {
                await api.upload(`/platform/support/tickets/${t.id}/messages`, formOf({ body, internal }, files));
                refresh();
              }}
            />
          ) : (
            <Notice tone="sel">Closed.</Notice>
          )}
        </Card>
        <Card className="!gap-3" style={{ padding: 18 }}>
          <div className="flex flex-wrap gap-2">
            <PriorityTag p={t.priority} />
            <TicketStatusTag status={t.status} />
            <SlaTag t={t} />
          </div>
          <KV label="Target">{t.sla}</KV>
          <Field label="Status">
            <Select value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="waiting_on_customer">Waiting on customer</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>
              <option value="P1">P1 · 1 hour</option>
              <option value="P2">P2 · 4 hours</option>
              <option value="P3">P3 · 1 business day</option>
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={t.assigneeId ?? ""} onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {(t.staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.role.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <KV label="Tenant plan">
            <span className="capitalize">{t.tenantPlan}</span>
          </KV>
          <div>
            <div className="text-muted text-[12px]">Read-only access</div>
            <div className="text-[13px]">{t.allowAccess ? "Allowed by the customer" : "Not allowed"}</div>
            {t.accessLog.map((a) => (
              <div key={a.id} className="text-muted text-[12px]">
                {a.staffName} · {new Date(a.startedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}
                {a.endedAt ? " · ended" : Date.parse(a.expiresAt) > Date.now() ? " · active" : " · expired"}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
