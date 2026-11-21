import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CONSENT_PURPOSE_LABELS, CONSENT_PURPOSES, type ConsentPurpose } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";

interface Data {
  notice: { version: number; text: string };
  needsAcknowledgement: boolean;
  consents: Record<ConsentPurpose, { granted: boolean; at: string } | null>;
  officer: { name: string | null; email: string | null };
}

/** The privacy notice to read, and the optional consents to give or withdraw. */
export function MyPrivacyCard() {
  const { tenant } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ess", "dpdp"], queryFn: () => api.get<Data>("/ess/dpdp"), enabled: !!tenant?.employeeId && !tenant.support });
  const [open, setOpen] = useState(false);
  const ack = useMutation({
    mutationFn: () => api.post("/ess/dpdp/acknowledge", { version: q.data!.notice.version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ess", "dpdp"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const consent = useMutation({
    mutationFn: (b: { purpose: ConsentPurpose; granted: boolean }) => api.post("/ess/dpdp/consents", b),
    onSuccess: (_r, b) => {
      toast.success(b.granted ? "Consent given" : "Consent withdrawn");
      qc.invalidateQueries({ queryKey: ["ess", "dpdp"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  if (!d) return null;
  return (
    <Card className="!gap-3">
      <CardHeader title="Privacy notice and consents" sub="What the company does with your data, and the optional uses you can say yes or no to." />
      {d.needsAcknowledgement ? <Notice tone="warn">Please read the privacy notice{d.notice.version > 1 ? "; it has changed" : ""}.</Notice> : null}
      <div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide the notice" : "Read the notice"}</Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2">
          <div className="max-h-80 overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 text-[13px]">{d.notice.text}</div>
          {d.needsAcknowledgement ? <div><Button variant="primary" size="sm" loading={ack.isPending} onClick={() => ack.mutate()}>I've read it</Button></div> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 pt-1">
        {CONSENT_PURPOSES.map((p) => (
          <div key={p}>
            <Checkbox checked={!!d.consents[p]?.granted} onChange={(v) => consent.mutate({ purpose: p, granted: v })} label={<span className="font-medium">{CONSENT_PURPOSE_LABELS[p].title}</span>} />
            <div className="text-muted ps-6 text-[12.5px]">{CONSENT_PURPOSE_LABELS[p].detail}</div>
          </div>
        ))}
      </div>
      {d.officer.email ? <div className="text-muted text-[12.5px]">Questions or complaints: {d.officer.name ? `${d.officer.name}, ` : ""}<a href={`mailto:${d.officer.email}`}>{d.officer.email}</a>. You can also complain to the Data Protection Board of India.</div> : null}
    </Card>
  );
}
