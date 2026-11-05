import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fmtDate } from "@hrms/shared";
import { api } from "@/lib/api";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { StatusTag, Tag } from "@/components/ui/tag";

interface Overview {
  byStatus: { status: string; n: number }[];
  byPlan: { plan: string; n: number }[];
  activeEmployees: number;
  users: number;
  recent: { id: string; name: string; code: string; status: string; plan: string; createdAt: string }[];
  trialsEnding: { id: string; name: string; trialEndsAt: string }[];
}

export default function PlatformOverview() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["platform", "overview"], queryFn: () => api.get<Overview>("/platform/overview") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const s = (k: string) => d.byStatus.find((x) => x.status === k)?.n ?? 0;
  const total = d.byStatus.reduce((a, b) => a + b.n, 0);
  return (
    <>
      <PageHeader title="Platform overview" sub="Tenants, usage and accounts that need attention" />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <StatCard label="Tenants" value={total} meta={`${s("active")} active · ${s("trial")} on trial`} onClick={() => nav("/platform/tenants")} />
        <StatCard label="Past due" value={s("past_due")} meta={s("past_due") ? <Tag tone="warn">Follow up</Tag> : "All paid"} />
        <StatCard label="Suspended" value={s("suspended")} meta="Sign-in blocked" />
        <StatCard label="Active employees" value={d.activeEmployees.toLocaleString("en-IN")} meta="Across all tenants" />
        <StatCard label="Logins" value={d.users.toLocaleString("en-IN")} meta="Admins and employees" />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
        <Card className="!gap-3">
          <CardHeader title="Newest tenants" />
          <table className="table">
            <tbody>
              {d.recent.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-muted text-[12px]">
                      {t.code} · joined {fmtDate(t.createdAt.slice(0, 10))}
                    </div>
                  </td>
                  <td className="capitalize">{t.plan}</td>
                  <td>
                    <StatusTag status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="!gap-3">
          <CardHeader title="Trials ending within 7 days" />
          {d.trialsEnding.length === 0 ? (
            <div className="text-muted text-[13px]">No trials ending soon.</div>
          ) : (
            d.trialsEnding.map((t) => (
              <div key={t.id} className="flex justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2.5" style={{ background: "var(--warn-bg)" }}>
                <span className="font-medium">{t.name}</span>
                <span className="text-[12.5px]">{fmtDate(t.trialEndsAt.slice(0, 10))}</span>
              </div>
            ))
          )}
          <div className="text-muted text-[12.5px]">Billing, invoices and MRR arrive with the billing module in phase 2.</div>
        </Card>
        <Card className="!gap-3">
          <CardHeader title="By plan" />
          {d.byPlan.map((p) => (
            <div key={p.plan} className="flex items-center justify-between text-[14px]">
              <span className="capitalize">{p.plan}</span>
              <span className="num font-semibold">{p.n}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
