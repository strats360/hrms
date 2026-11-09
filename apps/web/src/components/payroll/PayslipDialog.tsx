import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { api, download, errorMessage } from "@/lib/api";
import type { PayslipView } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Payslip, printPayslip } from "./Payslip";

/** Payslip preview. `source` picks the admin or self-service endpoint. */
export function PayslipDialog({ runId, employeeId, onClose, source = "admin" }: { runId: string | null; employeeId?: string | null; onClose: () => void; source?: "admin" | "ess" }) {
  const open = !!runId && (source === "ess" || !!employeeId);
  const path = source === "ess" ? `/ess/payslips/${runId}` : `/admin/payroll/runs/${runId}/items/${employeeId}`;
  const q = useQuery({ queryKey: ["payslip", source, runId, employeeId], queryFn: () => api.get<PayslipView>(path), enabled: open });
  const [busy, setBusy] = useState(false);
  const pdf = source === "ess" ? `/ess/payslips/${runId}/pdf` : `/admin/payroll/runs/${runId}/payslips/${employeeId}/pdf`;
  const save = () => {
    setBusy(true);
    download(pdf, `payslip-${q.data?.run.month ?? ""}-${q.data?.employee.code ?? ""}.pdf`)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Payslip"
      width={780}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button onClick={printPayslip} disabled={!q.data}>
            <Printer size={16} /> Print
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!q.data}>
            <Download size={16} /> Download PDF
          </Button>
        </>
      }
    >
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data ? (
        <>
          {q.data.warnings.length && source === "admin" ? <Notice tone="warn">{q.data.warnings.join(" · ")}</Notice> : null}
          <div id="payslip-print">
            <Payslip slip={q.data} />
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
