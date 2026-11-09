export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Files to attach, base64-encoded. */
  attachments?: { filename: string; content: string }[];
}

export interface Mailer {
  send(msg: EmailMessage): Promise<void>;
}

/** Development mailer: prints emails to the log so links can be clicked locally. */
export class ConsoleMailer implements Mailer {
  public sent: EmailMessage[] = [];
  async send(msg: EmailMessage) {
    this.sent.push(msg);
    console.log(`[email] to=${msg.to} subject="${msg.subject}"${msg.attachments?.length ? ` attachments=${msg.attachments.map((a) => a.filename).join(",")}` : ""}\n${msg.text}`);
  }
}

/** Resend (https://resend.com) over plain fetch so it runs on Workers. */
/**
 * Production without an email provider: nothing is sent, and the message body is
 * never logged (it can hold password-reset and invite links).
 */
export class UnconfiguredMailer implements Mailer {
  async send(msg: EmailMessage) {
    console.warn(`[email] not sent (RESEND_API_KEY / EMAIL_FROM not set): "${msg.subject}" to ${msg.to.replace(/^[^@]+/, "***")}`);
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        reply_to: msg.replyTo,
        ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend error", res.status, body);
      throw new Error("Email could not be sent");
    }
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Minimal, client-safe HTML email layout. */
export function layout(opts: { company: string; heading: string; paragraphs: string[]; cta?: { label: string; url: string }; footer?: string }) {
  const p = opts.paragraphs.map((x) => `<p style="margin:0 0 14px;line-height:1.6">${esc(x)}</p>`).join("");
  const cta = opts.cta
    ? `<p style="margin:22px 0"><a href="${esc(opts.cta.url)}" style="display:inline-block;padding:10px 20px;border-radius:8px;background:#5b4fc4;color:#ffffff;text-decoration:none;font-weight:500">${esc(opts.cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1d1e26">
<div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="background:#ffffff;border-radius:12px;padding:28px 24px">
<div style="font-weight:600;margin-bottom:18px">${esc(opts.company)}</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 16px">${esc(opts.heading)}</h1>${p}${cta}
${opts.footer ? `<p style="margin:18px 0 0;font-size:12.5px;color:#6b6d7a">${esc(opts.footer)}</p>` : ""}
</div></div></body></html>`;
  const text = [opts.heading, "", ...opts.paragraphs, ...(opts.cta ? ["", `${opts.cta.label}: ${opts.cta.url}`] : []), ...(opts.footer ? ["", opts.footer] : [])].join("\n");
  return { html, text };
}
