import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, SOURCE_LABEL, type Source, type Stage } from "@hrms/shared";
import { api } from "@/lib/api";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/page";
import { StageTag } from "@/components/recruitment/shared";
import { RecruitmentHeader } from "./Jobs";

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  experienceYears: number | null;
  source: Source;
  createdAt: string;
  employeeId: string | null;
  applications: { id: string; job: string; jobId: string; stage: Stage }[];
}

export default function Candidates() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const list = useQuery({ queryKey: ["recruitment", "candidates", term], queryFn: () => api.get<Row[]>(`/admin/recruitment/candidates?q=${encodeURIComponent(term)}`) });
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Candidate", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{[r.currentTitle, r.currentCompany].filter(Boolean).join(" at ") || r.email}</div></div> },
      { id: "exp", header: "Experience", accessorKey: "experienceYears", cell: ({ getValue }) => (getValue<number | null>() != null ? `${getValue<number>()} yrs` : "—") },
      { id: "source", header: "Source", accessorKey: "source", cell: ({ getValue }) => SOURCE_LABEL[getValue<Source>()] },
      { id: "apps", header: "Applied for", enableSorting: false, cell: ({ row: { original: r } }) => <div className="flex flex-col gap-1">{r.applications.map((a) => <div key={a.id} className="flex items-center gap-2 text-[12.5px]"><span className="truncate">{a.job}</span><StageTag s={a.stage} /></div>)}</div> },
      { id: "added", header: "Added", accessorKey: "createdAt", cell: ({ getValue }) => fmtDate(getValue<string>().slice(0, 10)) },
    ],
    [],
  );
  return (
    <>
      <RecruitmentHeader />
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="All candidates" sub="Everyone who has applied or been added, across all jobs." />
        <DataTable
          data={list.data ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={list.isFetching}
          onRowClick={(r) => nav(`/recruitment/candidates/${r.id}`)}
          storageKey="candidates"
          toolbar={
            <form onSubmit={(e) => (e.preventDefault(), setTerm(q))} className="flex gap-2">
              <Input aria-label="Search candidates" placeholder="Name, email, phone or company" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTerm(q)} className="!w-[260px]" />
            </form>
          }
          empty={term ? "Nobody matches." : "No candidates yet."}
        />
      </TableCard>
    </>
  );
}
