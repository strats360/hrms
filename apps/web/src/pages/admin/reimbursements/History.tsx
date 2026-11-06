import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { api, download, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Claim } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/page";
import { ClaimDetailDialog } from "@/components/reimbursements/shared";
import { claimColumns } from "./columns";
import { useCategories } from "./ReimbursementsLayout";

export default function History() {
  const { can } = useSession();
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const cats = useCategories();
  const params = { status, categoryId, from, to };
  const list = useQuery({ queryKey: ["claims", "history", params], queryFn: () => api.get<Claim[]>(`/admin/reimbursements/claims${qs(params)}`) });
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list.data ?? []).filter((r) => !t || `${r.code} ${r.employeeName} ${r.employeeCode} ${r.project ?? ""} ${r.description}`.toLowerCase().includes(t));
  }, [list.data, q]);
  const columns = useMemo(() => claimColumns({ payment: true }), []);
  return (
    <div className="flex flex-col gap-4">
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={list.isFetching}
          pageSize={15}
          storageKey="claims-history"
          onRowClick={(r) => setOpen(r.id)}
          empty="No claims for this filter"
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="!w-[200px]" aria-label="Search" />
              <Select className="!w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                <option value="">All statuses</option>
                <option value="pending_manager,pending_finance">Waiting</option>
                <option value="approved">Approved, unpaid</option>
                <option value="paid">Paid</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </Select>
              <Select className="!w-[170px]" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {(cats.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input type="date" className="!w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <Input type="date" className="!w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              {can("reimbursements", "export") ? (
                <Button onClick={() => download(`/admin/reimbursements/export.csv${qs(params)}`, "reimbursements.csv").catch((e) => toast.error(errorMessage(e)))}>
                  <Download size={16} /> Export
                </Button>
              ) : null}
            </>
          }
        />
      </TableCard>
      <ClaimDetailDialog id={open} onClose={() => setOpen(null)} mode="admin" />
    </div>
  );
}
