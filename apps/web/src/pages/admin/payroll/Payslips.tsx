import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Mail, Send } from "lucide-react";
import { fmtDate, inr } from "@hrms/shared";
import { api, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { PayrollItem, PayrollRun } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { monthLabel } from "@/components/payroll/Payslip";
import { confirmAction } from "@/components/ui/confirm";

export default function Payslips() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [slip, setSlip] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const runs = useQuery({ queryKey: ["payroll", "runs"], queryFn: () => api.get<PayrollRun[]>("/admin/payroll/runs") });
  const locked = useMemo(() => (runs.data ?? []).filter((r) => r.status === "approved" || r.status === "paid"), [runs.data]);
  const pending = (runs.data ?? []).find((r) => r.status === "draft" || r.status === "calculated");
  const run = locked.find((r) => r.id === params.get("run")) ?? locked[0] ?? null;

  const items = useQuery({
    queryKey: ["payroll", "items", run?.id, term, "", "all"],
    queryFn: () => api.get<PayrollItem[]>(`/admin/payroll/runs/${run!.id}/items${qs({ q: term })}`),
    enabled: !!run,
  });

  const publish = useMutation({
    mutationFn: () => api.post<{ emailed: number; held: number }>(`/admin/payroll/runs/${run!.id}/publish`),
    onSuccess: (r) => {
      toast.success(`Payslips published. ${r.emailed} employees emailed${r.held ? `, ${r.held} on hold not sent` : ""}.`);
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // email PDFs in batches until none are left, showing progress
  const [mailing, setMailing] = useState<{ sent: number; failed: number } | null>(null);
  const emailPdfs = async (resend: boolean) => {
    if (!run) return;
    setMailing({ sent: 0, failed: 0 });
    let sent = 0;
    let failed = 0;
    try {
      let first = true;
      for (;;) {
        const r = await api.post<{ sent: number; failed: string[]; remaining: number }>(`/admin/payroll/runs/${run.id}/payslips/email`, { resend: resend && first });
        first = false;
        sent += r.sent;
        failed += r.failed.length;
        setMailing({ sent, failed });
        if (!r.remaining || r.sent + r.failed.length === 0) break;
      }
      toast.success(`Emailed ${sent} payslip PDF${sent === 1 ? "" : "s"}${failed ? `. ${failed} couldn't be sent` : ""}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMailing(null);
      qc.invalidateQueries({ queryKey: ["payroll", "items"] });
    }
  };
  const [zipping, setZipping] = useState(false);

  const columns = useMemo<ColumnDef<PayrollItem>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.snapshot.name,
        cell: ({ row: { original: r } }) => (
          <div>
            <div className="font-medium">{r.snapshot.name}</div>
            <div className="text-muted text-[12px]">
              {r.snapshot.code}
              {r.snapshot.designation ? ` · ${r.snapshot.designation}` : ""}
            </div>
          </div>
        ),
      },
      { id: "month", header: "Month", enableSorting: false, cell: () => (run ? monthLabel(run.month) : "") },
      { id: "paid", header: "Paid days", accessorFn: (r) => r.paidDays, cell: ({ row: { original: r } }) => `${r.paidDays} / ${r.daysInMonth}` },
      { id: "gross", header: "Gross", accessorFn: (r) => r.gross, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "net", header: "Net pay", accessorFn: (r) => r.net, meta: { align: "right" }, cell: ({ getValue }) => <span className="font-semibold">{inr(getValue<number>())}</span> },
      {
        id: "delivery",
        header: "Delivery",
        accessorFn: (r) => (r.onHold ? 0 : run?.publishedAt ? 2 : 1),
        cell: ({ row: { original: r } }) =>
          r.onHold ? (
            <Tag tone="bad" title={r.holdReason ?? undefined}>On hold</Tag>
          ) : r.payslipEmailedAt ? (
            <Tag tone="ok" title={new Date(r.payslipEmailedAt).toLocaleString("en-IN")}>PDF emailed</Tag>
          ) : run?.publishedAt ? (
            <Tag tone="ok">Published</Tag>
          ) : (
            <Tag tone="neutral">Not published</Tag>
          ),
      },
    ],
    [run],
  );

  if (runs.isLoading) return <Loading />;
  if (runs.error) return <ErrorState error={runs.error} retry={() => runs.refetch()} />;
  if (!run)
    return (
      <Empty
        title="No payslips yet"
        sub="Payslips are created when a payroll run is approved and locked."
        action={
          <Link to="/payroll" className="btn btn-primary self-start no-underline">
            Go to payroll runs
          </Link>
        }
      />
    );

  const canPublish = run.status === "approved" && !run.publishedAt && can("payroll", "approve");

  return (
    <>
      {pending ? (
        <Notice tone="sel">
          {monthLabel(pending.month)} payslips appear here once that payroll is approved and locked. <Link to={`/payroll/run/${pending.id}`}>Open the run</Link>
        </Notice>
      ) : null}
      <TableCard>
        <CardHeader
          className="py-2"
          title={`Payslips · ${monthLabel(run.month)} ${run.publishedAt ? "(published)" : "(not published yet)"}`}
          sub={run.publishedAt ? `Published ${fmtDate(run.publishedAt.slice(0, 10))}. Employees see these in self-service.` : "Employees can't see these until you publish them."}
          actions={
            <>
              <Select className="!w-[200px]" value={run.id} onChange={(e) => setParams({ run: e.target.value })} aria-label="Payroll month">
                {locked.map((r) => (
                  <option key={r.id} value={r.id}>
                    {monthLabel(r.month)}
                  </option>
                ))}
              </Select>
              {can("payroll", "export") ? (
                <Button
                  loading={zipping}
                  onClick={() => {
                    setZipping(true);
                    download(`/admin/payroll/runs/${run.id}/payslips.zip`, `payslips-${run.month}.zip`)
                      .catch((e) => toast.error(errorMessage(e)))
                      .finally(() => setZipping(false));
                  }}
                >
                  <Download size={15} /> All PDFs
                </Button>
              ) : null}
              {run.publishedAt && can("payroll", "approve") ? (
                <Button loading={!!mailing} onClick={() => void confirmAction({ title: `Email ${monthLabel(run.month)} payslips?`, body: "Each employee gets their payslip as a PDF. Anyone already sent one is skipped.", confirmLabel: "Send emails" }).then((ok) => { if (ok) void emailPdfs(false); })}>
                  <Mail size={15} /> {mailing ? `Sent ${mailing.sent}…` : "Email PDFs"}
                </Button>
              ) : null}
              {canPublish ? (
                <Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>
                  <Send size={15} /> Publish & email
                </Button>
              ) : null}
            </>
          }
        />
        {items.error ? (
          <ErrorState error={items.error} retry={() => items.refetch()} />
        ) : (
          <DataTable
            data={items.data ?? []}
            loading={items.isLoading}
            columns={columns}
            getRowId={(r) => r.employeeId}
            pageSize={15}
            storageKey="payroll-payslips"
            onRowClick={(r) => setSlip(r.employeeId)}
            toolbar={<Input className="!w-[220px]" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />}
            rowActions={(r) => [{ label: "Preview payslip", onSelect: () => setSlip(r.employeeId) }]}
          />
        )}
      </TableCard>
      <PayslipDialog runId={slip ? run.id : null} employeeId={slip} onClose={() => setSlip(null)} />
    </>
  );
}
