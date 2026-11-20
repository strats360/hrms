import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtMoney } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface MyFbp {
  enabled: boolean;
  fy?: string;
  regime?: "new" | "old";
  annualSpecial?: number;
  heads?: { code: string; label: string; annualCap: number; newRegime: boolean }[];
  declaration?: { allocations: Record<string, number>; status: "submitted" | "approved" | "rejected"; note: string | null; total: number } | null;
  balances?: Record<string, { credited: number; claimed: number; balance: number }>;
}

const STATUS = { submitted: { label: "Waiting for HR", tone: "warn" }, approved: { label: "Approved", tone: "ok" }, rejected: { label: "Sent back", tone: "bad" } } as const;

/** The employee's flexible benefit plan: pick amounts, see what has built up and what's left to claim. */
export function MyBenefits() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ess", "fbp"], queryFn: () => api.get<MyFbp>("/ess/fbp"), retry: false });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data?.declaration) setAlloc(Object.fromEntries(Object.entries(q.data.declaration.allocations).map(([k, v]) => [k, String(v)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put<{ status: string }>("/ess/fbp", { allocations: Object.fromEntries(Object.entries(alloc).map(([k, v]) => [k, Number(v.replace(/[,\s]/g, "")) || 0])) }),
    onSuccess: (r) => {
      toast.success(r.status === "approved" ? "Your plan is saved" : "Sent to HR for approval");
      qc.invalidateQueries({ queryKey: ["ess", "fbp"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  if (!d?.enabled || !d.heads?.length) return null;
  const total = Object.values(alloc).reduce((s, v) => s + (Number(v.replace(/[,\s]/g, "")) || 0), 0);
  const left = (d.annualSpecial ?? 0) - total;
  const st = d.declaration ? STATUS[d.declaration.status] : null;
  return (
    <Card className="!gap-4">
      <CardHeader
        title="Flexible benefits"
        sub={`Move part of your special allowance into benefits you claim against bills, tax free. It builds up with each month's salary. Claim it under Claims; anything you haven't claimed by March is paid with your salary and taxed. Your special allowance is ${fmtMoney(d.annualSpecial ?? 0)} a year.`}
        actions={st ? <Tag tone={st.tone}>{st.label}</Tag> : undefined}
      />
      {d.declaration?.status === "rejected" && d.declaration.note ? <Notice tone="bad">HR sent your plan back: {d.declaration.note}</Notice> : null}
      {d.regime === "new" ? <div className="text-muted text-[12.5px]">You're on the new regime, so only benefits that save tax there are shown.</div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {d.heads.map((h) => {
          const b = d.balances?.[h.code];
          return (
            <Field key={h.code} label={`${h.label} (up to ${fmtMoney(h.annualCap)} a year)`} hint={b ? `Built up ${fmtMoney(b.credited)} · claimed ${fmtMoney(b.claimed)} · ${fmtMoney(b.balance)} left to claim` : undefined}>
              <Input inputMode="numeric" value={alloc[h.code] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [h.code]: e.target.value.replace(/[^\d]/g, "") }))} placeholder="0" />
            </Field>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`text-[13.5px] ${left < 0 ? "text-[var(--color-bad)]" : "text-muted"}`}>
          {fmtMoney(total)} a year in benefits ({fmtMoney(Math.round(total / 12))} a month). {left >= 0 ? `${fmtMoney(left)} stays as special allowance.` : `That's ${fmtMoney(-left)} more than your special allowance.`}
        </div>
        <Button variant="primary" loading={save.isPending} disabled={left < 0} onClick={() => save.mutate()}>
          {d.declaration ? "Update plan" : "Submit plan"}
        </Button>
      </div>
    </Card>
  );
}
