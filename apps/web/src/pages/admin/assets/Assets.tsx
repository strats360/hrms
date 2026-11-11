import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ASSET_STATUSES, fmtDate, inr, ISSUE_LABEL } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { AssetDialog, AssetStatusTag, type Asset } from "./shared";

interface Row extends Asset {
  holder: { id: string; name: string; code: string; status: string } | null;
  branch: string | null;
  assignedOn: string | null;
  acknowledged: boolean;
  issue: keyof typeof ISSUE_LABEL | null;
}
interface Data { rows: Row[]; summary: { total: number; assigned: number; available: number; repair: number; value: number; withLeavers: number } }

export default function Assets() {
  const nav = useNavigate();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const qs = new URLSearchParams(Object.entries({ q, status, category }).filter(([, v]) => v)).toString();
  const list = useQuery({ queryKey: ["assets", qs], queryFn: () => api.get<Data>(`/admin/assets${qs ? `?${qs}` : ""}`) });
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "tag", header: "Tag", accessorKey: "tag", cell: ({ getValue }) => <span className="num font-medium">{getValue<string>()}</span> },
      { id: "name", header: "Asset", accessorKey: "name", cell: ({ row: { original: a } }) => <div><div>{a.name}</div><div className="text-muted text-[12px]">{[ASSET_CATEGORY_LABEL[a.category], a.serialNumber].filter(Boolean).join(" · ")}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: a } }) => <div className="flex flex-wrap items-center gap-1.5"><AssetStatusTag s={a.status} />{a.issue ? <Tag tone="bad">{ISSUE_LABEL[a.issue]}</Tag> : null}</div> },
      {
        id: "holder",
        header: "With",
        accessorFn: (a) => a.holder?.name ?? "",
        cell: ({ row: { original: a } }) =>
          a.holder ? (
            <div>
              <div>{a.holder.name}{["notice", "exited", "inactive"].includes(a.holder.status) ? <Tag tone="warn" className="ml-1.5">{a.holder.status === "notice" ? "Leaving" : "Left"}</Tag> : null}</div>
              <div className="text-muted text-[12px]">since {a.assignedOn ? fmtDate(a.assignedOn) : "—"}{a.acknowledged ? "" : " · not confirmed yet"}</div>
            </div>
          ) : <span className="text-muted">{a.branch ?? "—"}</span>,
      },
      { id: "warranty", header: "Warranty", accessorKey: "warrantyUntil", cell: ({ row: { original: a } }) => (a.warrantyUntil ? <span className={a.warranty === "expired" ? "text-muted" : a.warranty === "ending" ? "text-[var(--bad)]" : ""}>{a.warranty === "expired" ? "Ended " : "Until "}{fmtDate(a.warrantyUntil)}</span> : "—") },
      { id: "cost", header: "Cost", accessorKey: "purchaseCost", cell: ({ getValue }) => (getValue<number | null>() != null ? inr(getValue<number>()) : "—") },
    ],
    [],
  );
  const s = list.data?.summary;
  return (
    <>
      <PageHeader
        title="Assets"
        sub="Laptops, phones, cards and anything else the company hands out"
        actions={
          <>
            {can("assets", "export") ? <Button onClick={() => download(`/admin/assets/export.xlsx${qs ? `?${qs}` : ""}`, "assets.xlsx").catch((e) => toast.error(errorMessage(e)))}><Download size={16} /> Export</Button> : null}
            {can("assets", "edit") ? <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Add asset</Button> : null}
          </>
        }
      />
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Assets" value={s.total} />
          <StatCard label="With people" value={s.assigned} />
          <StatCard label="Available" value={s.available} onClick={() => setStatus("available")} />
          <StatCard label="In repair" value={s.repair} onClick={() => setStatus("in_repair")} />
          <StatCard label="With leavers" value={s.withLeavers} meta={s.withLeavers ? "to collect" : undefined} />
        </div>
      ) : null}
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="Register" sub={s ? `Current value at cost ${inr(s.value)}, not counting retired or lost assets.` : undefined} />
        <DataTable
          data={list.data?.rows ?? []}
          columns={columns}
          getRowId={(r) => r.id}
          loading={list.isFetching}
          onRowClick={(r) => nav(`/assets/${r.id}`)}
          storageKey="assets"
          toolbar={
            <div className="flex flex-wrap gap-2">
              <Input aria-label="Search assets" placeholder="Tag, name, serial or person" value={q} onChange={(e) => setQ(e.target.value)} className="!w-[230px]" />
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-[150px]"><option value="">All statuses</option>{ASSET_STATUSES.map((x) => <option key={x} value={x}>{ASSET_STATUS_LABEL[x]}</option>)}</Select>
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="!w-[150px]"><option value="">All categories</option>{ASSET_CATEGORIES.map((x) => <option key={x} value={x}>{ASSET_CATEGORY_LABEL[x]}</option>)}</Select>
            </div>
          }
          empty={q || status || category ? "Nothing matches." : "No assets yet. Add the first one."}
        />
      </TableCard>
      {adding ? <AssetDialog onClose={() => setAdding(false)} onSaved={(id) => nav(`/assets/${id}`)} /> : null}
    </>
  );
}
