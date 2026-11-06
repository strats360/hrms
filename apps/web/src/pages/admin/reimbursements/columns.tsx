import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, inr } from "@hrms/shared";
import type { Claim } from "@/lib/types";
import { PersonCell } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/tag";
import { ClaimStatusTag } from "@/components/reimbursements/shared";

/** Columns shared by the queue and history tables. */
export function claimColumns(opts: { payment?: boolean; gst?: boolean } = {}): ColumnDef<Claim, any>[] {
  return [
    {
      id: "code",
      header: "Claim",
      accessorFn: (r) => r.code,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <div className="font-semibold">{r.code}</div>
          <div className="text-muted max-w-[200px] truncate text-[11.5px]" title={r.description}>
            {r.description}
          </div>
        </div>
      ),
    },
    { id: "employee", header: "Employee", accessorFn: (r) => r.employeeName, cell: ({ row: { original: r } }) => <PersonCell name={r.employeeName} sub={`${r.employeeCode}${r.department ? " · " + r.department : ""}`} /> },
    { id: "category", header: "Category", accessorFn: (r) => r.category },
    { id: "date", header: "Date", accessorFn: (r) => r.expenseDate, cell: ({ getValue }) => fmtDate(getValue<string>()) },
    {
      id: "amount",
      header: "Amount",
      accessorFn: (r) => Number(r.amount),
      meta: { align: "right" },
      cell: ({ row: { original: r } }) => (
        <div>
          <span className="font-semibold">{inr(r.amount)}</span>
          {r.overLimit ? (
            <div>
              <Tag tone="warn" className="!text-[11px]">
                Over limit
              </Tag>
            </div>
          ) : null}
        </div>
      ),
    },
    ...(opts.gst === false ? [] : [{ id: "gst", header: "GSTIN", accessorFn: (r) => r.gstin ?? "", cell: ({ getValue }: { getValue: () => unknown }) => <span className="text-muted text-[12.5px]">{(getValue() as string) || "—"}</span> } as ColumnDef<Claim, any>]),
    { id: "project", header: "Project / client", accessorFn: (r) => r.project ?? "", cell: ({ getValue }) => getValue<string>() || <span className="text-muted">—</span> },
    { id: "status", header: "Stage", accessorFn: (r) => r.status, cell: ({ row: { original: r } }) => <ClaimStatusTag status={r.status} /> },
    ...(opts.payment ? [{ id: "payment", header: "Payment", accessorFn: (r: Claim) => r.payment ?? "", cell: ({ getValue }: { getValue: () => unknown }) => <span className="text-muted text-[12.5px]">{(getValue() as string) || "—"}</span> } as ColumnDef<Claim, any>] : []),
  ];
}
