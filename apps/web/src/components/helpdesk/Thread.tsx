import { useState } from "react";
import { Lock, Paperclip } from "lucide-react";
import { Body } from "@/components/announcements/Body";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { openFile } from "@/pages/admin/recruitment/CandidateDetail";
import { Tag, type Tone } from "@/components/ui/tag";
import type { TicketStatus } from "@hrms/shared";

export interface Message { id: string; authorName: string; fromTeam: boolean; internal: boolean; body: string; hasAttachment: boolean; attachmentName: string | null; createdAt: string }
export const STATUS_TONE: Record<TicketStatus, Tone> = { open: "warn", in_progress: "accent", waiting: "neutral", resolved: "ok", closed: "outline" };
export const whenShort = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const StatusTag = ({ s, label }: { s: TicketStatus; label: string }) => <Tag tone={STATUS_TONE[s]}>{label}</Tag>;

export function Thread({ messages, fileBase }: { messages: Message[]; fileBase: string }) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div key={m.id} className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: m.internal ? "color-mix(in srgb, var(--warn, #d9a441) 45%, transparent)" : "var(--color-divider)", background: m.internal ? "color-mix(in srgb, var(--warn, #d9a441) 8%, transparent)" : m.fromTeam ? "var(--tint-1)" : "transparent" }}>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <b>{m.authorName}</b>
            {m.internal ? <span className="inline-flex items-center gap-1 text-[12px]"><Lock size={12} /> Team note, not shown to the employee</span> : null}
            <span className="text-muted">{whenShort(m.createdAt)}</span>
          </div>
          <Body text={m.body} className="!text-[13.5px]" />
          {m.hasAttachment ? <Button size="sm" className="mt-2" onClick={() => openFile(`${fileBase}/${m.id}/file`)}><Paperclip size={13} /> {m.attachmentName ?? "Attachment"}</Button> : null}
        </div>
      ))}
    </div>
  );
}

/** Reply box with an optional attachment. */
export function ReplyBox({ placeholder, busy, onSend, extra, sendLabel = "Send" }: { placeholder: string; busy: boolean; onSend: (body: string, file: File | null) => Promise<unknown> | void; extra?: React.ReactNode; sendLabel?: string }) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <Textarea aria-label="Reply" rows={4} placeholder={placeholder} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input key={key} type="file" aria-label="Attach a file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12.5px]" />
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={async () => { await onSend(body, file); setBody(""); setFile(null); setKey((k) => k + 1); }}>{sendLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function multipart(data: unknown, file: File | null) {
  if (!file) return data;
  const f = new FormData();
  f.append("data", JSON.stringify(data));
  f.append("file", file);
  return f;
}
