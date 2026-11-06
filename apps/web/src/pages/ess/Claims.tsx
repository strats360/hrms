import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { fmtDate, inr } from "@hrms/shared";
import { api } from "@/lib/api";
import type { MyClaims } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { ClaimDetailDialog, ClaimDialog, ClaimStatusTag, limitText } from "@/components/reimbursements/shared";

export default function EssClaims() {
  const q = useQuery({ queryKey: ["claims", "mine"], queryFn: () => api.get<MyClaims>("/ess/claims") });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const waiting = d.claims.filter((c) => c.status === "pending_manager" || c.status === "pending_finance");
  const unpaid = d.claims.filter((c) => c.status === "approved");
  const sum = (xs: typeof d.claims) => xs.reduce((s, c) => s + Number(c.amount), 0);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!mb-1 text-[26px]">Claims</h1>
          <div className="text-muted text-[13.5px]">Submit expenses with a receipt. Approved claims are paid with your salary.</div>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)} disabled={!d.categories.length}>
          <Plus size={16} /> New claim
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="!gap-1">
          <div className="card-kicker">Waiting for approval</div>
          <div className="num text-[22px] font-medium">{inr(sum(waiting))}</div>
          <div className="card-meta">{waiting.length} claim{waiting.length === 1 ? "" : "s"}</div>
        </Card>
        <Card className="!gap-1">
          <div className="card-kicker">Approved, to be paid</div>
          <div className="num text-[22px] font-medium">{inr(sum(unpaid))}</div>
          <div className="card-meta">with your next salary</div>
        </Card>
        {d.usage.slice(0, 2).map((u) => (
          <Card key={u.categoryId} className="!gap-1">
            <div className="card-kicker">
              {u.name} · {monthLabel(d.month)}
            </div>
            <div className="num text-[22px] font-medium">{inr(u.used)}</div>
            <div className="card-meta">
              of {inr(u.limit)} {u.used > u.limit ? <Tag tone="warn">over limit</Tag> : null}
            </div>
          </Card>
        ))}
      </div>

      {!d.claims.length ? (
        <Card>
          <Empty title="No claims yet" sub="Travel, food, fuel, mobile and internet bills can be claimed here." action={<Button onClick={() => setCreating(true)}>Submit your first claim</Button>} />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {d.claims.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c.id)}
              className="card flex cursor-pointer flex-row items-center justify-between gap-3 border-0 text-left text-[var(--color-text)] hover:shadow-[var(--shadow-sm)]"
              style={{ padding: "14px 16px", font: "inherit" }}
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {c.category} <span className="text-muted text-[12.5px] font-normal">· {c.code}</span>
                </div>
                <div className="text-muted truncate text-[12px]">
                  {fmtDate(c.expenseDate)} · {c.description}
                </div>
                {c.payment ? <div className="text-muted text-[12px]">{c.payment}</div> : null}
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="hidden sm:inline">
                  <ClaimStatusTag status={c.status} />
                </span>
                <span className="num font-semibold">{inr(c.amount)}</span>
                <ChevronRight size={16} style={{ color: "var(--muted)" }} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Card>
        <div className="card-kicker">Policy</div>
        <div className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {d.categories.map((c) => (
            <div key={c.id} className="flex justify-between gap-3">
              <span>{c.name}</span>
              <span className="text-muted">{limitText(c)}</span>
            </div>
          ))}
        </div>
      </Card>

      <ClaimDialog open={creating} onClose={() => setCreating(false)} categories={d.categories} endpoint="/ess/claims" />
      <ClaimDetailDialog id={open} onClose={() => setOpen(null)} mode="ess" />
    </>
  );
}
