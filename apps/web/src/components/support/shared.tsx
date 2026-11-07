import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Upload, X } from "lucide-react";
import { errorMessage, openFile } from "@/lib/api";
import type { Ticket, TicketMessage, TicketStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/field";
import { Tag, type Tone } from "@/components/ui/tag";

export const CATEGORY_LABEL: Record<string, string> = { payroll: "Payroll", attendance: "Attendance", leave: "Leave", compliance: "Statutory compliance", tax: "TDS & tax", payments: "Payments & bank files", billing: "Billing", access: "Users & access", bug: "Something's broken", other: "Other" };
const STATUS_TONE: Record<TicketStatus, Tone> = { open: "warn", in_progress: "accent", waiting_on_customer: "neutral", resolved: "ok", closed: "neutral" };
const STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", in_progress: "In progress", waiting_on_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" };
export function TicketStatusTag({ status, forCustomer }: { status: TicketStatus; forCustomer?: boolean }) {
  return <Tag tone={STATUS_TONE[status]}>{forCustomer && status === "waiting_on_customer" ? "Waiting for your reply" : STATUS_LABEL[status]}</Tag>;
}
export function PriorityTag({ p }: { p: Ticket["priority"] }) {
  return <Tag tone={p === "P1" ? "bad" : p === "P2" ? "warn" : "neutral"}>{p}</Tag>;
}
export function SlaTag({ t }: { t: Ticket }) {
  if (t.slaState === "met") return <span className="text-muted text-[12px]">Responded</span>;
  if (t.slaState === "breached") return <Tag tone="bad">SLA missed</Tag>;
  if (t.slaState === "pending") {
    const mins = Math.round((Date.parse(t.responseDueAt) - Date.now()) / 60000);
    return <span className="text-[12px]" style={{ color: mins < 60 ? "var(--warn-fg)" : undefined }}>Respond in {mins >= 120 ? `${Math.round(mins / 60)} h` : `${Math.max(0, mins)} min`}</span>;
  }
  return null;
}
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** The conversation: tenant on one side, support on the other, system notes centred. */
export function Thread({ messages, attachmentBase, viewer }: { messages: TicketMessage[]; attachmentBase: string; viewer: "tenant" | "platform" }) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m) =>
        m.authorKind === "system" ? (
          <div key={m.id} className="text-muted self-center text-center text-[12px]">
            {m.body} · {ago(m.createdAt)}
          </div>
        ) : (
          <div
            key={m.id}
            className="max-w-[85%] rounded-[var(--radius-md)] px-3.5 py-2.5 text-[13.5px]"
            style={{
              alignSelf: (m.authorKind === "platform") === (viewer === "platform") ? "flex-end" : "flex-start",
              background: m.internal ? "var(--warn-bg)" : m.authorKind === "platform" ? "var(--sel-bg)" : "var(--tint-1)",
              color: m.internal ? "var(--warn-fg)" : undefined,
            }}
          >
            <div className="mb-1 text-[12px] font-medium">
              {m.authorName}
              {m.authorKind === "platform" ? " · Support" : ""}
              {m.internal ? " · internal note" : ""}
              <span className="text-muted font-normal"> · {ago(m.createdAt)}</span>
            </div>
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
            {m.attachments.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.attachments.map((a, i) => (
                  <Button key={i} size="sm" onClick={() => openFile(`${attachmentBase}/${m.id}/${i}`).catch((e) => toast.error(errorMessage(e)))}>
                    <Paperclip size={13} /> {a.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

/** Reply box with up to 3 attachments; platform staff also get "internal note". */
export function ReplyBox({ onSend, internalOption, disabled, placeholder = "Write a reply" }: { onSend: (body: string, files: File[], internal: boolean) => Promise<void>; internalOption?: boolean; disabled?: boolean; placeholder?: string }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const send = async () => {
    setBusy(true);
    try {
      await onSend(body.trim(), files, internal);
      setBody("");
      setFiles([]);
      setInternal(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} disabled={disabled} maxLength={5000} />
      {files.length ? (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="tag tag-neutral inline-flex items-center gap-1">
              <Paperclip size={12} /> {f.name}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-inherit" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={disabled || files.length >= 3} onClick={() => ref.current?.click()}>
          <Upload size={14} /> Attach
        </Button>
        <input ref={ref} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => (setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 3)), (e.target.value = ""))} />
        {internalOption ? <Checkbox checked={internal} onChange={setInternal} label="Internal note (customer can't see it)" /> : null}
        <Button variant="primary" className="ml-auto" disabled={disabled || !body.trim()} loading={busy} onClick={send}>
          {internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}

export function formOf(data: Record<string, unknown>, files: File[] = []) {
  const f = new FormData();
  f.set("data", JSON.stringify(data));
  for (const x of files) f.append("files", x);
  return f;
}
