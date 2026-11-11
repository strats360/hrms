import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, fmtDate, inrCompact, type EmployeeStatus } from "@hrms/shared";
import { DataTable } from "@/components/ui/data-table";
import { TableCard } from "@/components/ui/card";
import { Input, Segmented, Select } from "@/components/ui/field";
import { PersonCell } from "@/components/ui/avatar";
import { StatusTag } from "@/components/ui/tag";
import { ErrorState } from "@/components/ui/page";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { EmployeeRow, Lookups } from "@/lib/types";

const STATUS_FILTERS = {
  all: { label: "All", value: "" },
  active: { label: "Active", value: "active,notice" },
  probation: { label: "Probation", value: "probation" },
  onboarding: { label: "Onboarding", value: "onboarding" },
  exited: { label: "Exited / inactive", value: "inactive,exited" },
} as const;
type StatusKey = keyof typeof STATUS_FILTERS;

/** Column id -> API sort key */
const SORT_KEYS: Record<string, string> = { fullName: "name", department: "department", dateOfJoining: "doj", annualCtc: "ctc", status: "status", employeeCode: "code" };
const COL_FOR_SORT: Record<string, string> = Object.fromEntries(Object.entries(SORT_KEYS).map(([k, v]) => [v, k]));

interface ListResponse {
  rows: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportRows(rows: EmployeeRow[]) {
  const header = ["Employee ID", "Name", "Work email", "Phone", "Department", "Designation", "Branch", "Manager", "Status", "Type", "Date of joining", "Annual CTC"];
  const lines = rows.map((r) =>
    [r.employeeCode, r.fullName, r.workEmail, r.phone, r.department, r.designation, r.branch, r.manager, EMPLOYEE_STATUS_LABELS[r.status as EmployeeStatus] ?? r.status, EMPLOYMENT_TYPE_LABELS[r.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? r.employmentType, r.dateOfJoining, r.annualCtc ?? ""].map(csvCell).join(","),
  );
  const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employees-selected.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Directory() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const dept = params.get("dept") ?? "";
  const status = (params.get("status") as StatusKey) || "all";
  const page = Number(params.get("page") ?? 1) || 1;
  const sort = params.get("sort") ?? "name";
  const dir = (params.get("dir") as "asc" | "desc") ?? "asc";
  const pageSize = 25;

  const [search, setSearch] = useState(q);
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) update({ q: search.trim() || null, page: null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["employee-stats"], queryFn: () => api.get<{ byBranch: { branch: string | null; n: number }[] }>("/admin/employees/stats") });
  const list = useQuery({
    queryKey: ["employees", { q, dept, status, page, sort, dir }],
    queryFn: () => api.get<ListResponse>(`/admin/employees${qs({ q, departmentId: dept, status: STATUS_FILTERS[status]?.value, page, pageSize, sort, dir })}`),
    placeholderData: keepPreviousData,
  });

  const invite = useMutation({ mutationFn: (id: string) => api.post(`/admin/employees/${id}/invite`) });

  const columns = useMemo<ColumnDef<EmployeeRow>[]>(() => {
    const cols: ColumnDef<EmployeeRow>[] = [
      { id: "fullName", accessorKey: "fullName", header: "Employee", enableHiding: false, cell: ({ row }) => <PersonCell employeeId={row.original.id} name={row.original.fullName} sub={row.original.employeeCode} /> },
      { id: "department", accessorKey: "department", header: "Department", cell: ({ getValue }) => getValue() ?? "—" },
      { id: "designation", accessorKey: "designation", header: "Designation", enableSorting: false, cell: ({ getValue }) => getValue() ?? "—" },
      { id: "branch", accessorKey: "branch", header: "Branch", enableSorting: false, cell: ({ getValue }) => getValue() ?? "—" },
      { id: "manager", accessorKey: "manager", header: "Manager", enableSorting: false, cell: ({ getValue }) => getValue() ?? "—" },
      { id: "dateOfJoining", accessorKey: "dateOfJoining", header: "Joined", cell: ({ getValue }) => fmtDate(getValue() as string) },
    ];
    if (list.data?.rows.some((r) => r.annualCtc !== null)) {
      cols.push({ id: "annualCtc", accessorKey: "annualCtc", header: "Annual CTC", meta: { align: "right" }, cell: ({ getValue }) => (getValue() === null ? "—" : inrCompact(getValue() as number)) });
    }
    cols.push({ id: "status", accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusTag status={getValue() as string} label={EMPLOYEE_STATUS_LABELS[getValue() as EmployeeStatus]} /> });
    return cols;
  }, [list.data]);

  const branchText = (stats.data?.byBranch ?? [])
    .filter((b) => b.branch)
    .map((b) => `${b.branch} ${b.n}`)
    .join(" · ");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-[280px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <Input className="!pl-9" placeholder="Search name, ID, email or designation" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" />
        </div>
        <Select className="w-full sm:!w-[200px]" value={dept} onChange={(e) => update({ dept: e.target.value || null, page: null })} aria-label="Department">
          <option value="">All departments</option>
          {lookups.data?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <div className="scroll-thin max-w-full overflow-x-auto">
          <Segmented<StatusKey>
            value={status}
            onChange={(v) => update({ status: v === "all" ? null : v, page: null })}
            options={(Object.keys(STATUS_FILTERS) as StatusKey[]).map((k) => ({ value: k, label: STATUS_FILTERS[k].label }))}
          />
        </div>
        <div className="text-muted ml-auto text-[13px]">
          Showing {list.data?.total ?? "…"}
          {branchText ? ` · ${branchText}` : ""}
        </div>
      </div>
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <DataTable<EmployeeRow>
          data={list.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={list.isFetching}
          storageKey="employees"
          onRowClick={(r) => nav(`/employees/${r.id}`)}
          server={{ page, pageSize, total: list.data?.total ?? 0, onPageChange: (p) => update({ page: p > 1 ? String(p) : null }) }}
          serverSort={{
            sort: COL_FOR_SORT[sort] ?? "fullName",
            dir,
            onSortChange: (col, d) => update({ sort: SORT_KEYS[col] ?? "name", dir: d === "desc" ? "desc" : null, page: null }),
          }}
          empty={q || dept || status !== "all" ? "No employees match these filters" : "No employees yet. Add your first employee or import a CSV."}
          rowActions={(r) => [
            { label: "View profile", onSelect: () => nav(`/employees/${r.id}`) },
            ...(can("employees", "edit") ? [{ label: "Edit", onSelect: () => nav(`/employees/${r.id}/edit`) }] : []),
            ...(can("employees", "edit") && r.status === "onboarding"
              ? [
                  {
                    label: "Resend onboarding invite",
                    onSelect: () =>
                      invite.mutate(r.id, {
                        onSuccess: () => {
                          toast.success(`Invite sent to ${r.workEmail}`);
                          qc.invalidateQueries({ queryKey: ["onboarding"] });
                        },
                      }),
                  },
                ]
              : []),
          ]}
          bulkActions={[
            { label: "Export selected", onRun: (rows) => exportRows(rows) },
            ...(can("employees", "edit")
              ? [
                  {
                    label: "Send onboarding invites",
                    onRun: async (rows: EmployeeRow[]) => {
                      const targets = rows.filter((r) => r.status === "onboarding");
                      if (!targets.length) {
                        toast.error("None of the selected employees are in onboarding");
                        return;
                      }
                      let ok = 0;
                      const failed: string[] = [];
                      for (const r of targets) {
                        try {
                          await api.post(`/admin/employees/${r.id}/invite`);
                          ok++;
                        } catch (e) {
                          failed.push(`${r.fullName}: ${errorMessage(e)}`);
                        }
                      }
                      if (ok) toast.success(`Sent ${ok} invite${ok === 1 ? "" : "s"}`);
                      if (failed.length) toast.error(failed.join("\n"));
                      qc.invalidateQueries({ queryKey: ["onboarding"] });
                    },
                  },
                ]
              : []),
          ]}
        />
      </TableCard>
    </div>
  );
}
