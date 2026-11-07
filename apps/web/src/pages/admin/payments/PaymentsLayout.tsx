import { useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, inr, inrCompact } from "@hrms/shared";
import { download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PaymentType } from "@/lib/types";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Menu } from "@/components/ui/menu";
import { Tag } from "@/components/ui/tag";
import { GenerateBatchDialog, usePaymentsSummary } from "@/components/payments/shared";

const TYPE_BY_PATH: Record<string, PaymentType> = { "/payments": "salary", "/payments/reimbursements": "reimbursement", "/payments/bonus": "bonus", "/payments/other": "other" };

export default function PaymentsLayout() {
  const { can } = useSession();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const s = usePaymentsSummary().data;
  const ready = s?.readySalary[0];
  // /payments?generate=salary&run=<id> opens the dialog (link from the payroll wizard)
  const deepLink = params.get("generate") as PaymentType | null;
  const close = () => {
    setOpen(false);
    if (deepLink) {
      const p = new URLSearchParams(params);
      p.delete("generate");
      p.delete("run");
      setParams(p, { replace: true });
    }
  };
  const report = (format: "csv" | "xlsx", status?: string) =>
    download(`/admin/payments/report?format=${format}${status ? `&status=${status}` : ""}`, `payments.${format}`).catch((e) => toast.error(errorMessage(e)));
  return (
    <>
      <PageHeader
        title="Payments"
        sub="Salary, reimbursement and bonus disbursements"
        actions={
          <>
            {can("payments", "export") ? (
              <Menu
                trigger={
                  <Button>
                    <Download size={16} /> Reports
                  </Button>
                }
                items={[
                  { label: "All payments (Excel)", onSelect: () => report("xlsx") },
                  { label: "All payments (CSV)", onSelect: () => report("csv") },
                  { label: "Paid (Excel)", onSelect: () => report("xlsx", "paid") },
                  { label: "Unpaid: pending, failed, held (Excel)", onSelect: () => report("xlsx", "pending,failed,held") },
                ]}
              />
            ) : null}
            {can("payments", "edit") ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus size={16} /> Generate batch
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}>
        <StatCard label={ready ? `Ready to pay · ${ready.label}` : "Ready to pay · salary"} value={ready ? inr(ready.net) : "—"} meta={ready ? `${ready.employees} employees · locked` : "No locked payroll waiting"} />
        <StatCard label="Approved claims unpaid" value={s ? inr(s.claimsUnpaid.amount) : "—"} meta={s ? `${s.claimsUnpaid.claims} claim${s.claimsUnpaid.claims === 1 ? "" : "s"} · next reimbursement batch or payroll` : undefined} />
        <StatCard label="Failed or held" value={s ? s.attention.count : "—"} meta={s?.attention.count ? <Tag tone="warn">{inr(s.attention.amount)} to resolve</Tag> : "Nothing to resolve"} />
        <StatCard
          label={s?.account ? `${s.account.label} account` : "Payroll account"}
          value={s?.account?.balance !== null && s?.account?.balance !== undefined ? inrCompact(s.account.balance) : "—"}
          meta={s?.account ? `${s.account.bankName} ····${s.account.accountLast4}${s.account.balanceAsOf ? ` · balance on ${fmtDate(s.account.balanceAsOf, false)}` : ""}` : "Add a debit account"}
        />
      </div>
      <RouteTabs
        tabs={[
          { to: "/payments", label: "Salary", end: true },
          { to: "/payments/reimbursements", label: "Reimbursements" },
          { to: "/payments/bonus", label: "Bonus" },
          { to: "/payments/other", label: "Other" },
          { to: "/payments/reconciliation", label: "Reconciliation" },
          { to: "/payments/accounts", label: "Debit accounts" },
        ]}
      />
      <Outlet />
      {can("payments", "edit") ? <GenerateBatchDialog open={open || !!deepLink} onClose={close} initialType={deepLink ?? TYPE_BY_PATH[pathname] ?? "salary"} initialRunId={params.get("run") ?? undefined} /> : null}
    </>
  );
}
