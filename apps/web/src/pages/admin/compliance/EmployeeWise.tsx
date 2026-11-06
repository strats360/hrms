import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { inr } from "@hrms/shared";
import { api, download, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ContributionRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { monthLabel } from "@/components/payroll/Payslip";

interface Resp {
  month: string;
  months: string[];
  rows: ContributionRow[];
  missing: { uan: number; esicIp: number; pan: number };
}

const money = (k: keyof ContributionRow, header: string): ColumnDef<ContributionRow> => ({ id: k, header, accessorKey: k, meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) });

export default function EmployeeWise() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? undefined;
  const [q, setQ] = useState("");
  const data = useQuery({ queryKey: ["compliance", "employee", month], queryFn: () => api.get<Resp>(`/admin/compliance/employee${qs({ month })}`), retry: false });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data.data?.rows ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.uan ?? "").includes(s));
  }, [data.data, q]);
  const cols = useMemo<ColumnDef<ContributionRow>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code}</div></div> },
      { id: "uan", header: "UAN", accessorKey: "uan", cell: ({ getValue }) => getValue<string>() ?? <span style={{ color: "var(--warn-fg)" }}>Missing</span> },
      money("pfWage", "PF wage"),
      money("epfEe", "EPF (EE)"),
      money("eps", "EPS (ER)"),
      money("epfEr", "EPF (ER)"),
      money("edliAdmin", "EDLI + admin"),
      money("esiEe", "ESI (EE)"),
      money("esiEr", "ESI (ER)"),
      money("pt", "PT"),
      money("lwf", "LWF"),
      money("tds", "TDS"),
      { id: "ncpDays", header: "NCP days", accessorKey: "ncpDays", meta: { align: "right" } },
    ],
    [],
  );

  if (data.isLoading) return <Loading />;
  if (data.error) {
    if ((data.error as { status?: number }).status === 404) return <Empty title="No locked payroll yet" sub="Contributions appear here once a payroll month is approved and locked." />;
    return <ErrorState error={data.error} />;
  }
  const d = data.data!;
  const file = (path: string, name: string) =>
    download(`/admin/compliance/files/${path}${qs({ month: d.month })}`, name).catch((e) => toast.error(e.message));
  const canExport = can("compliance", "export");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Select className="!w-[200px]" value={d.month} onChange={(e) => setParams({ month: e.target.value })} aria-label="Month">
          {d.months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Input className="!w-[240px]" placeholder="Search name, ID or UAN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {canExport ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => file("ecr.txt", `ECR-${d.month}.txt`)}>
              <Download size={15} /> EPF ECR
            </Button>
            <Button onClick={() => file("esi.csv", `ESI-${d.month}.csv`)}>
              <Download size={15} /> ESI return
            </Button>
            <Button onClick={() => file("pt.csv", `PT-${d.month}.csv`)}>
              <Download size={15} /> PT summary
            </Button>
            <Button onClick={() => file("tds.csv", `TDS-${d.month}.csv`)}>
              <Download size={15} /> TDS deductions
            </Button>
          </div>
        ) : null}
      </div>
      {d.missing.uan || d.missing.esicIp || d.missing.pan ? (
        <Notice tone="warn">
          {[d.missing.uan && `${d.missing.uan} PF member(s) have no UAN and are left out of the ECR`, d.missing.esicIp && `${d.missing.esicIp} ESI member(s) have no IP number`, d.missing.pan && `${d.missing.pan} employee(s) with TDS have no PAN`].filter(Boolean).join(" · ")}. Update them on the employee's Statutory tab.
        </Notice>
      ) : null}
      <TableCard>
        <div className="card-title py-2 text-[17px]">{monthLabel(d.month)} · contributions per employee</div>
        <DataTable data={rows} columns={cols} getRowId={(r) => r.employeeId} pageSize={15} storageKey="compliance-employee" />
      </TableCard>
      <div className="text-muted text-[12.5px]">
        The ECR file uses EPFO's ECR 2.0 text format (11 fields separated by #~#) for upload on the employer portal. The ESI file has the columns of the ESIC monthly contribution template; paste it into the portal's Excel template. Check the files on the portal before you pay.
      </div>
    </>
  );
}
