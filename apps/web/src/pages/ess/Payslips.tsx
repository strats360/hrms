import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { fmtDate, inr } from "@hrms/shared";
import { api, ApiError } from "@/lib/api";
import { PillTabs } from "@/components/ui/tabs";
import { MySalary, type MySalaryData } from "@/components/ess/MySalary";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { monthLabel } from "@/components/payroll/Payslip";

interface MySlip {
  runId: string;
  month: string;
  payDate: string | null;
  status: string;
  gross: number;
  net: number;
  totalDeductions: number;
  onHold: boolean;
}

export default function EssPayslips() {
  const q = useQuery({ queryKey: ["ess", "payslips"], queryFn: () => api.get<MySlip[]>("/ess/payslips") });
  const [open, setOpen] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  // the company can hide the salary structure; payslips always show
  const salary = useQuery({
    queryKey: ["ess", "salary"],
    queryFn: async () => {
      try {
        return await api.get<MySalaryData>("/ess/salary");
      } catch (e) {
        if (e instanceof ApiError && e.code === "salary_hidden") return null;
        throw e;
      }
    },
    retry: false,
  });
  const view = params.get("view") === "salary" && salary.data ? "salary" : "payslips";
  const tabs = salary.data ? (
    <PillTabs<"payslips" | "salary">
      value={view}
      onChange={(v) => setParams(v === "salary" ? { view: "salary" } : {}, { replace: true })}
      tabs={[
        { value: "payslips", label: "Payslips" },
        { value: "salary", label: "My salary" },
      ]}
    />
  ) : null;

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (view === "salary" && salary.data) {
    return (
      <>
        <div>
          <h1 className="!mb-1 text-[26px]">My salary</h1>
          <div className="text-muted text-[13.5px]">Your salary structure as HR has it on record. Questions about it? Ask HR.</div>
        </div>
        {tabs}
        <MySalary data={salary.data} />
      </>
    );
  }
  const slips = q.data ?? [];
  const latest = slips[0];

  return (
    <>
      <div>
        <h1 className="!mb-1 text-[26px]">Payslips</h1>
        <div className="text-muted text-[13.5px]">Payslips appear here once HR publishes them each month. Use Download PDF to save a copy.</div>
      </div>
      {tabs}

      {!latest ? (
        <Card>
          <Empty title="No payslips yet" sub="Your first payslip shows up here after your first payroll is processed and published." />
        </Card>
      ) : (
        <>
          <button
            onClick={() => setOpen(latest.runId)}
            className="card cursor-pointer border-0 text-left text-[var(--color-text)]"
            style={{ padding: 20, font: "inherit", background: "var(--ok-bg)", color: "var(--ok-fg)" }}
          >
            <div className="text-[11px] uppercase tracking-[0.1em]">Latest · {monthLabel(latest.month)}</div>
            <div className="text-[32px] font-medium leading-tight num">{inr(latest.net)}</div>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span>Net pay{latest.payDate ? ` · paid ${fmtDate(latest.payDate)}` : ""}</span>
              {latest.onHold ? <Tag tone="warn">On hold</Tag> : null}
              <span className="ml-auto inline-flex items-center gap-0.5 font-medium">
                View payslip <ChevronRight size={14} />
              </span>
            </div>
          </button>

          <div className="flex flex-col gap-2">
            {slips.map((s) => (
              <button
                key={s.runId}
                onClick={() => setOpen(s.runId)}
                className="card flex cursor-pointer flex-row items-center justify-between gap-3 border-0 text-left text-[var(--color-text)] hover:shadow-[var(--shadow-sm)]"
                style={{ padding: "14px 16px", font: "inherit" }}
              >
                <div className="min-w-0">
                  <div className="font-medium">{monthLabel(s.month)}</div>
                  <div className="text-muted text-[12px]">
                    Gross {inr(s.gross)} · Deductions {inr(s.totalDeductions)}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                  {s.onHold ? <Tag tone="warn">On hold</Tag> : null}
                  <span className="num font-semibold">{inr(s.net)}</span>
                  <ChevronRight size={16} style={{ color: "var(--muted)" }} />
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <PayslipDialog source="ess" runId={open} onClose={() => setOpen(null)} />
    </>
  );
}
