import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Repeat } from "lucide-react";
import { fmtDate, inr } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { openMandateCheckout } from "@/lib/cashfree";
import { useSession } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { confirmAction } from "@/components/ui/confirm";

interface Autopay {
  available: boolean;
  mandate: { subscriptionId: string; method: "upi" | "enach"; maxAmount: number; status: string; payer: string | null; label: string; authorizedAt: string | null; failureReason: string | null } | null;
  suggestedMax: number;
  upiLimit: number;
  nextCharge: { orderId: string; invoice: string; amount: number; scheduledFor: string } | null;
}

/** Autopay: one mandate per company, charged for each invoice after the bank's pre-debit notice. */
export function AutopayCard() {
  const { can, tenant } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["billing", "autopay"], queryFn: () => api.get<Autopay>("/admin/billing/autopay") });
  const [method, setMethod] = useState<"upi" | "enach">("enach");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const d = q.data;
  const canEdit = can("billing", "edit") && !tenant?.support;

  useEffect(() => {
    if (d && !limit) {
      setLimit(String(d.suggestedMax));
      setMethod(d.suggestedMax <= d.upiLimit ? "upi" : "enach");
    }
  }, [d, limit]);

  // back from Cashfree: ?autopay=<subscription id>; banks can take a while to approve an e-mandate
  const back = params.get("autopay");
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!back || done.current === back) return;
    done.current = back;
    setConfirming(true);
    let tries = 0;
    const finish = () => {
      const p = new URLSearchParams(params);
      p.delete("autopay");
      setParams(p, { replace: true });
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["billing"] });
    };
    const check = async () => {
      try {
        const r = await api.get<{ mandate: Autopay["mandate"] }>(`/admin/billing/autopay/${encodeURIComponent(back)}`);
        const st = r.mandate?.status;
        if (st === "active") return (toast.success("Autopay is on. Invoices will be collected automatically."), finish());
        if (st === "failed" || st === "expired" || st === "cancelled") return (toast.error("The mandate wasn't approved. You can try again."), finish());
      } catch (e) {
        toast.error(errorMessage(e));
        return finish();
      }
      if (++tries < 6) setTimeout(check, 3000);
      else {
        toast.message("Your bank is still approving the mandate. This page updates once it does; e-mandates can take up to a day.");
        finish();
      }
    };
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  const cancel = useMutation({
    mutationFn: () => api.post("/admin/billing/autopay/cancel"),
    onSuccess: () => {
      toast.success("Autopay cancelled. Pay invoices online or by bank transfer.");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });

  const skip = useMutation({
    mutationFn: (orderId: string) => api.post(`/admin/billing/autopay/charges/${encodeURIComponent(orderId)}/cancel`),
    onSuccess: () => {
      toast.success("Debit cancelled. Please pay this invoice online or by bank transfer.");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!d?.available) return null;
  const m = d.mandate;
  const active = m?.status === "active";
  const pending = m && (m.status === "pending" || m.status === "initialized");
  const amount = Number(limit || 0);
  const overUpi = method === "upi" && amount > d.upiLimit;

  const setup = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ subscriptionId: string; sessionId: string; mode: "sandbox" | "production" }>("/admin/billing/autopay", { method, maxAmount: amount });
      await openMandateCheckout(r.sessionId, r.mode);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card className="!gap-3" style={{ padding: 18 }}>
      <CardHeader
        icon={<Repeat size={18} />}
        title="Autopay"
        sub={active ? "Invoices are collected automatically, after your bank's pre-debit notice." : "Let us collect each monthly invoice automatically, by UPI autopay or a bank e-mandate."}
        actions={active ? <Tag tone="ok">On</Tag> : pending ? <Tag tone="warn">Waiting for bank approval</Tag> : <Tag>Off</Tag>}
      />
      {confirming ? <Notice tone="sel">Checking the mandate with your bank…</Notice> : null}
      {active && m ? (
        <div className="flex flex-wrap items-end justify-between gap-3 text-[13.5px]">
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-3">
            <div>
              <div className="text-muted text-[12px]">Pays from</div>
              {m.label}
            </div>
            <div>
              <div className="text-muted text-[12px]">Limit per invoice</div>
              {inr(m.maxAmount)}
            </div>
            <div>
              <div className="text-muted text-[12px]">Next debit</div>
              {d.nextCharge ? `${inr(d.nextCharge.amount)} for ${d.nextCharge.invoice}, on ${fmtDate(d.nextCharge.scheduledFor.slice(0, 10))}` : "With the next invoice"}
              {d.nextCharge && canEdit ? (
                <button
                  type="button"
                  className="text-accent ml-2 text-[12px] underline disabled:opacity-50"
                  disabled={skip.isPending}
                  onClick={() => void confirmAction({ title: `Skip the debit for ${d.nextCharge!.invoice}?`, body: "You'll need to pay this invoice yourself. Autopay stays on for later invoices.", confirmLabel: "Skip debit" }).then((ok) => ok && skip.mutate(d.nextCharge!.orderId))}
                >
                  Skip this debit
                </button>
              ) : null}
            </div>
          </div>
          {canEdit ? (
            <Button variant="danger" size="sm" loading={cancel.isPending} onClick={() => void confirmAction({ title: "Cancel autopay?", body: "Future invoices will need to be paid by hand.", confirmLabel: "Cancel autopay", danger: true }).then((ok) => ok && cancel.mutate())}>
              Cancel autopay
            </Button>
          ) : null}
        </div>
      ) : canEdit ? (
        <>
          {m?.status === "failed" && m.failureReason ? <Notice tone="warn">The last attempt didn't complete: {m.failureReason}</Notice> : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Pay by">
              <Segmented<"upi" | "enach">
                value={method}
                onChange={setMethod}
                options={[
                  { value: "upi", label: `UPI autopay (up to ${inr(d.upiLimit)})` },
                  { value: "enach", label: "Bank e-mandate (eNACH)" },
                ]}
              />
            </Field>
            <Field label="Limit per invoice (₹)" hint="Invoices above this aren't debited; you pay those by hand">
              <Input inputMode="numeric" className="!w-[160px]" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button variant="primary" disabled={!amount || overUpi} loading={busy} onClick={setup}>
              {pending ? "Try again" : "Set up autopay"}
            </Button>
          </div>
          {overUpi ? <Notice tone="warn">UPI autopay debits above {inr(d.upiLimit)} need your approval in the UPI app every month (RBI rules). Choose a bank e-mandate for a higher limit.</Notice> : null}
          <div className="text-muted text-[12px]">You'll approve the mandate on Cashfree's secure page{method === "upi" ? " in your UPI app" : " with net banking or a debit card"}. A ₹1 authorisation is refunded. You can cancel autopay here any time.</div>
        </>
      ) : (
        <div className="text-muted text-[13px]">Ask an admin with billing rights to set up autopay.</div>
      )}
    </Card>
  );
}
