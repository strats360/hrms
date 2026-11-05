import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Cake, Check, Download, UserPlus, X } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { PersonCell } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/tag";
import { ReasonDialog } from "@/components/ui/reason-dialog";

interface Dashboard {
  date: string;
  employees: { total: number; active: number; inactive: number; onboarding: number; probation: number };
  attendance: { present: number; wfh: number; late: number; absent: number; notMarked: number; onLeave: number; off: number } | null;
  pendingLeaveCount: number;
  pendingLeaves: { id: string; code: string; employeeName: string; employeeCode: string; type: string; startDate: string; endDate: string; days: number }[];
  pendingCorrections: number;
  awaitingVerification: number;
  celebrations: { id: string; name: string; department: string | null; kind: "birthday" | "anniversary"; date: string; years: number }[];
}

function longDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function DashboardPage() {
  const { can, tenant } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/admin/dashboard") });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected"; note?: string }) => api.post(`/admin/leave/requests/${v.id}/decision`, { decision: v.decision, note: v.note }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approved" ? "Leave approved" : "Leave rejected");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const a = d.attendance;
  const canApprove = can("leave", "approve");

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`${longDate(d.date)} · ${tenant?.tenantName}`}
        actions={
          <>
            {can("employees", "export") ? (
              <Button onClick={() => download("/admin/employees/export.csv", "employee-master.csv").catch((e) => toast.error(e.message))}>
                <Download size={16} /> Export employees
              </Button>
            ) : null}
            {can("employees", "edit") ? (
              <Button variant="primary" onClick={() => nav("/employees/new")}>
                <UserPlus size={16} /> Add employee
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <StatCard label="Total employees" value={d.employees.active} meta={`${d.employees.probation} on probation · ${d.employees.inactive} inactive`} onClick={can("employees") ? () => nav("/employees") : undefined} />
        {a ? (
          <>
            <StatCard label="Present today" value={a.present} meta={a.wfh ? <Tag tone="ok">{a.wfh} WFH</Tag> : "In office and remote"} onClick={() => nav("/attendance")} />
            <StatCard label="Absent / not marked" value={a.absent + a.notMarked} meta={a.late ? <Tag tone="warn">{a.late} late arrivals</Tag> : "No late arrivals"} onClick={() => nav("/attendance")} />
            <StatCard label="On leave" value={a.onLeave} meta={a.off ? `${a.off} on weekly off or holiday` : "Approved leave today"} onClick={() => nav("/leave")} />
          </>
        ) : null}
        {can("leave") ? <StatCard label="Pending leave" value={d.pendingLeaveCount} meta="Awaiting a decision" onClick={() => nav("/leave")} /> : null}
        {can("employees") ? <StatCard label="New joiners" value={d.employees.onboarding} meta={d.awaitingVerification ? <Tag tone="warn">{d.awaitingVerification} to verify</Tag> : "Self-onboarding"} onClick={() => nav("/employees/onboarding")} /> : null}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
        {can("leave") ? (
          <Card className="!gap-3">
            <CardHeader title="Leave requests awaiting you" actions={<Button variant="ghost" onClick={() => nav("/leave")}>All requests</Button>} />
            {d.pendingLeaves.length === 0 ? (
              <div className="text-muted py-4 text-[13px]">Nothing waiting. Nice.</div>
            ) : (
              <div className="scroll-thin min-w-0 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Type</th>
                      <th>Dates</th>
                      <th>Days</th>
                      {canApprove ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {d.pendingLeaves.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <PersonCell name={l.employeeName} sub={l.employeeCode} />
                        </td>
                        <td className="whitespace-nowrap">{l.type}</td>
                        <td className="whitespace-nowrap">{l.startDate === l.endDate ? fmtDate(l.startDate, false) : `${fmtDate(l.startDate, false)} – ${fmtDate(l.endDate, false)}`}</td>
                        <td className="num">{l.days}</td>
                        {canApprove ? (
                          <td>
                            <div className="flex justify-end gap-1.5">
                              <Button icon size="sm" title="Reject" aria-label={`Reject ${l.code}`} onClick={() => setRejecting(l.id)}>
                                <X size={15} />
                              </Button>
                              <Button icon size="sm" variant="primary" title="Approve" aria-label={`Approve ${l.code}`} loading={decide.isPending && decide.variables?.id === l.id} onClick={() => decide.mutate({ id: l.id, decision: "approved" })}>
                                {decide.isPending && decide.variables?.id === l.id ? null : <Check size={15} />}
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}

        <Card className="!gap-3">
          <CardHeader title="Needs attention" icon={<AlertTriangle size={18} style={{ color: "var(--color-accent)" }} />} />
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            <AttentionRow to="/attendance/corrections" title="Attendance corrections" sub="Missed punches and WFH requests" count={d.pendingCorrections} show={can("attendance")} />
            <AttentionRow to="/employees/onboarding" title="Onboarding to verify" sub="New joiners who submitted their details" count={d.awaitingVerification} show={can("employees")} />
            <AttentionRow to="/attendance" title="Not marked yet today" sub="No punch recorded so far" count={a?.notMarked ?? 0} show={!!a} tone="neutral" />
            <div className="rounded-[var(--radius-md)] px-3 py-2.5" style={{ background: "var(--color-surface)" }}>
              <div className="font-semibold">Payroll and statutory compliance</div>
              <div className="text-muted text-[12px]">Payroll runs, challans and due-date alerts arrive in phase 2.</div>
            </div>
          </div>
        </Card>

        <Card className="!gap-3">
          <CardHeader title="Celebrations in the next 2 weeks" icon={<Cake size={18} style={{ color: "var(--ok-fg)" }} />} />
          {d.celebrations.length === 0 ? (
            <div className="text-muted py-2 text-[13px]">No birthdays or work anniversaries coming up.</div>
          ) : (
            <div className="flex flex-col gap-3 text-[13.5px]">
              {d.celebrations.map((c) => (
                <div key={c.id + c.kind} className="flex items-center gap-3">
                  <div className="w-11 rounded-[var(--radius-sm)] py-1 text-center leading-tight" style={{ background: "var(--color-surface)" }}>
                    <div className="text-[10px] uppercase" style={{ color: "var(--muted)" }}>{fmtDate(c.date).split(" ")[1]}</div>
                    <div className="text-[18px] font-medium">{c.date.slice(8)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-muted text-[12px]">
                      {c.kind === "birthday" ? "Birthday" : `${c.years} year${c.years === 1 ? "" : "s"} at ${tenant?.tenantName.split(" ")[0]}`}
                      {c.department ? ` · ${c.department}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(v) => !v && setRejecting(null)}
        title="Reject leave request"
        onConfirm={(note) => decide.mutateAsync({ id: rejecting!, decision: "rejected", note }).then(() => undefined)}
      />
    </>
  );
}

function AttentionRow({ to, title, sub, count, show, tone = "warn" }: { to: string; title: string; sub: string; count: number; show: boolean; tone?: "warn" | "neutral" }) {
  if (!show) return null;
  return (
    <Link to={to} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2.5 no-underline" style={{ background: count && tone === "warn" ? "var(--warn-bg)" : "var(--color-surface)", color: "var(--color-text)" }}>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-muted text-[12px]">{sub}</div>
      </div>
      <Tag tone={count ? tone : "ok"}>{count ? count : "Clear"}</Tag>
    </Link>
  );
}
