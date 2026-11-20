import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ComplianceOverview, Obligation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { ObligationTag } from "@/components/compliance/shared";
import { RecordPaymentDialog } from "@/components/compliance/RecordPaymentDialog";

export default function ComplianceOverviewPage() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ["compliance", "overview"], queryFn: () => api.get<ComplianceOverview>("/admin/compliance/overview") });
  const [paying, setPaying] = useState<Obligation | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.latestMonth)
    return <Empty title="Nothing to file yet" sub="Statutory liabilities appear here once a payroll is approved and locked." action={<Link to="/payroll" className="btn btn-primary">Go to payroll</Link>} />;
  const canPay = can("compliance", "edit");

  return (
    <>
      {d.overdue ? (
        <div className="rounded-[var(--radius-md)] px-4 py-3 text-[13.5px]" style={{ background: "var(--bad-bg)", color: "var(--bad-fg)" }}>
          {d.overdue} payment{d.overdue === 1 ? " is" : "s are"} overdue. Late EPF and ESI attract interest and damages, so pay and record them as soon as you can. <Link to="/compliance/challans?status=open" style={{ color: "inherit", textDecoration: "underline" }}>See open items</Link>
        </div>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="card-title text-[17px]">{monthLabel(d.latestMonth)} liabilities</div>
        <span className="text-muted text-[13px]">From the locked payroll · due dates follow the statute and your branch states</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
        {d.cards.map((o) => (
          <Card key={o.key} className="!gap-2 !p-[18px]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="card-kicker">{o.label}</div>
                <div className="text-muted text-[12px]">{monthLabel(o.period)} · {o.employees} employees</div>
              </div>
              <ObligationTag o={o} />
            </div>
            <div className="stat-value !text-[26px]">{fmtMoney(o.amount)}</div>
            <div className="text-muted text-[12px]">{o.breakup.length > 1 ? o.breakup.map((b) => `${b.label.split(" · ").pop()} ${fmtMoneyCompact(b.amount)}`).join(" · ") : o.breakup[0]?.label}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted text-[12.5px]">{o.challan ? `Paid ${fmtDate(o.challan.paidOn)}${o.challan.reference ? ` · ${o.challan.reference}` : ""}` : `Due ${fmtDate(o.dueDate)}`}</span>
              {canPay ? (
                <Button size="sm" variant={o.challan ? "ghost" : "primary"} onClick={() => setPaying(o)}>
                  {o.challan ? "Edit" : "Record payment"}
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
        {!d.cards.some((c) => c.statute === "esi") ? (
          <Card className="!gap-2 !p-[18px]">
            <div className="card-kicker">ESI</div>
            <div className="text-muted text-[13px]">No employees within the ₹21,000 ESI wage limit this month, so nothing is payable.</div>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
        <Card className="!gap-3">
          <CardHeader title="Filing calendar" sub="Unpaid liabilities and upcoming returns" />
          {d.calendar.length === 0 ? (
            <div className="text-muted text-[13px]">Everything is paid. Nothing due right now.</div>
          ) : (
            <div className="flex flex-col gap-2 text-[13.5px]">
              {d.calendar.map((c) => (
                <div key={c.date + c.title} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5" style={{ background: c.daysLeft < 0 ? "var(--bad-bg)" : c.daysLeft <= 7 ? "var(--warn-bg)" : "var(--tint-1)" }}>
                  <div className="min-w-0">
                    <div className="font-semibold">{fmtDate(c.date)} · {c.title}</div>
                    {c.amount !== null ? <div className="text-muted text-[12px]">{fmtMoney(c.amount)}</div> : <div className="text-muted text-[12px]">Return filing</div>}
                  </div>
                  <ObligationTag o={{ status: c.daysLeft < 0 ? "overdue" : c.daysLeft <= 7 ? "due_soon" : "upcoming", daysLeft: c.daysLeft }} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="!gap-3">
          <CardHeader title="Also tracked" />
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            <Row label={`Gratuity provision (5+ years · ${d.tracked.gratuityEligible} employees)`} value={`${fmtMoneyCompact(d.tracked.gratuityProvision)} accrued`} />
            <Row label="EDLI cover" value={<Tag tone="ok">Active · {d.tracked.edliMembers} members</Tag>} />
            <Row label={`Overtime logged (${monthLabel(d.latestMonth)})`} value={`${d.tracked.overtimeHours} h`} />
            <Row label="Statutory bonus" value={<Link to="/payments?generate=bonus">Pay through Payments</Link>} />
          </div>
          <div className="text-muted text-[12px]">Gratuity is 15/26 of current Code wages for each completed year of service, capped at ₹20 lakh. It's an estimate for provisioning, not a payout.</div>
        </Card>
      </div>
      <Thresholds />
      <RecordPaymentDialog obligation={paying} onClose={() => setPaying(null)} />
    </>
  );
}

interface Threshold {
  entityId: string;
  entityName?: string;
  state: string;
  employees: number;
  workers: number;
  obligations: { at: number; count: "employees" | "workers"; obligation: string; law: string; current: number; status: "applies" | "near" }[];
}

/** What each establishment's headcount switches on under the Labour Codes, and what's close. */
function Thresholds() {
  const q = useQuery({ queryKey: ["compliance", "thresholds"], queryFn: () => api.get<Threshold[]>("/admin/compliance/thresholds") });
  if (!q.data?.length) return null;
  return (
    <Card className="!gap-3">
      <CardHeader title="Headcount thresholds" sub="By establishment (legal entity and state). Workers leave out managers earning over ₹18,000 a month." />
      {q.data.map((g) => (
        <div key={`${g.entityId}|${g.state}`} className="flex flex-col gap-1.5">
          <div className="font-semibold">
            {g.entityName} · {g.state || "No branch state"} <span className="text-muted font-normal">· {g.employees} employees, {g.workers} workers</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.obligations.map((o) => (
              <Tag key={o.obligation} tone={o.status === "applies" ? "accent" : "warn"} title={`${o.law} · from ${o.at} ${o.count}`}>
                {o.status === "near" ? `Soon (${o.current}/${o.at}): ` : ""}
                {o.obligation}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="num whitespace-nowrap font-semibold">{value}</span>
    </div>
  );
}
