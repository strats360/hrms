import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { InvoicingEntity } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

export default function PlatformSettings() {
  const { me } = useSession();
  const superAdmin = me?.platformRole === "super_admin";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "settings"], queryFn: () => api.get<{ entity: InvoicingEntity }>("/platform/billing/settings") });
  const gw = useQuery({ queryKey: ["platform", "gateway"], queryFn: () => api.get<{ provider: string; configured: boolean; mode: string | null; apiVersion: string | null; webhookUrl: string }>("/platform/billing/gateway") });
  const [f, setF] = useState<InvoicingEntity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setF(q.data.entity);
  }, [q.data]);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => api.put("/platform/billing/settings", { ...f, dueDays: Number(f!.dueDays) }),
    onSuccess: () => {
      toast.success("Invoicing entity saved. New invoices use it.");
      setError(null);
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (q.isLoading || !f) return q.error ? <ErrorState error={q.error} /> : <Loading />;
  const set = <K extends keyof InvoicingEntity>(k: K, v: InvoicingEntity[K]) => setF((x) => ({ ...x!, [k]: v }));
  return (
    <>
      <PageHeader title="Platform settings" sub="The company that issues invoices to tenants" />
      <Card style={{ padding: 22 }} className="!gap-3">
        <CardHeader title="Payment gateway · Cashfree" sub="Tenants pay invoices online by UPI, card or netbanking. Paid invoices settle automatically from Cashfree's webhook." />
        {gw.data ? (
          <div className="grid gap-3 text-[13.5px] sm:grid-cols-3">
            <div>
              <div className="text-muted text-[12px]">Status</div>
              {gw.data.configured ? <Tag tone="ok">Connected · {gw.data.mode}</Tag> : <Tag tone="warn">Not connected</Tag>}
            </div>
            <div className="sm:col-span-2">
              <div className="text-muted text-[12px]">Webhook URL (add it in Cashfree › Developers › Webhooks, for payment events)</div>
              <code className="break-all text-[12.5px]">{gw.data.webhookUrl}</code>
            </div>
          </div>
        ) : null}
        {gw.data && !gw.data.configured ? <Notice tone="sel">Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY as GitHub environment secrets and CASHFREE_ENV (sandbox or production) as a variable, then deploy. See docs/DEPLOY.md.</Notice> : null}
      </Card>
      <Card style={{ padding: 22 }} className="!gap-3">
        <CardHeader title="Invoicing entity" sub="Printed on every invoice. Its state decides CGST + SGST or IGST." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal name">
            <Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} disabled={!superAdmin} />
          </Field>
          <Field label="GSTIN">
            <Input value={f.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase() || null)} disabled={!superAdmin} maxLength={15} />
          </Field>
          <Field label="PAN">
            <Input value={f.pan ?? ""} onChange={(e) => set("pan", e.target.value.toUpperCase() || null)} disabled={!superAdmin} maxLength={10} />
          </Field>
          <Field label="State">
            <Input value={f.state ?? ""} onChange={(e) => set("state", e.target.value || null)} disabled={!superAdmin} />
          </Field>
          <Field label="Address" span>
            <Textarea rows={2} value={f.address ?? ""} onChange={(e) => set("address", e.target.value || null)} disabled={!superAdmin} />
          </Field>
          <Field label="SAC code" hint="998314: IT design and development services">
            <Input value={f.sac} onChange={(e) => set("sac", e.target.value)} disabled={!superAdmin} />
          </Field>
          <Field label="Invoice prefix" hint="INV-P- gives INV-P-2611-0001">
            <Input value={f.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} disabled={!superAdmin} />
          </Field>
          <Field label="Payment due (days after issue)">
            <Input inputMode="numeric" value={String(f.dueDays)} onChange={(e) => set("dueDays", Number(e.target.value.replace(/\D/g, "") || 0))} disabled={!superAdmin} />
          </Field>
          <Field label="Billing email">
            <Input value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} disabled={!superAdmin} />
          </Field>
          <Field label="UPI ID">
            <Input value={f.upiId ?? ""} onChange={(e) => set("upiId", e.target.value || null)} disabled={!superAdmin} />
          </Field>
          <Field label="Bank details for transfers">
            <Input value={f.bankDetails ?? ""} onChange={(e) => set("bankDetails", e.target.value || null)} disabled={!superAdmin} />
          </Field>
        </div>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {superAdmin ? (
          <Button variant="primary" className="self-start" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        ) : (
          <Notice tone="sel">Only a platform super admin can change these.</Notice>
        )}
      </Card>
    </>
  );
}
