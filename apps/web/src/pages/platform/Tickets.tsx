import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api, qs } from "@/lib/api";
import type { Ticket } from "@/lib/types";
import { StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input, Segmented, Select } from "@/components/ui/field";
import { ErrorState, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { ago, CATEGORY_LABEL, PriorityTag, SlaTag, TicketStatusTag } from "@/components/support/shared";

type F = "open" | "mine" | "resolved,closed" | "";

export default function Tickets() {
  const nav = useNavigate();
  const [status, setStatus] = useState<F>("open");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const summary = useQuery({ queryKey: ["platform", "support", "summary"], queryFn: () => api.get<{ open: number; p1: number; p2: number; breached: number; unassigned: number }>("/platform/support/summary") });
  const list = useQuery({
    queryKey: ["platform", "support", "tickets", status, priority, q],
    queryFn: () => api.get<Ticket[]>(`/platform/support/tickets${qs({ status: status === "mine" ? "open" : status, mine: status === "mine" ? 1 : undefined, priority, q })}`),
  });
  const s = summary.data;
  const columns = useMemo<ColumnDef<Ticket, any>[]>(
    () => [
      { id: "number", header: "Ticket", accessorFn: (t) => t.number, cell: ({ row: { original: t } }) => <span className="font-medium">#{t.number}</span> },
      { id: "tenant", header: "Tenant", accessorFn: (t) => t.tenantName, cell: ({ row: { original: t } }) => <div>{t.tenantName}<div className="text-muted text-[11.5px] capitalize">{t.tenantPlan}</div></div> },
      { id: "subject", header: "Subject", accessorFn: (t) => t.subject, cell: ({ row: { original: t } }) => <div className="max-w-[340px]"><div className="truncate" title={t.subject}>{t.subject}</div><div className="text-muted text-[11.5px]">{CATEGORY_LABEL[t.category] ?? t.category}{t.allowAccess ? " · access allowed" : ""}</div></div> },
      { id: "priority", header: "Priority", accessorFn: (t) => t.priority, cell: ({ row: { original: t } }) => <PriorityTag p={t.priority} /> },
      { id: "owner", header: "Owner", accessorFn: (t) => t.assigneeName ?? "", cell: ({ getValue }) => getValue<string>() || <Tag>Unassigned</Tag> },
      { id: "age", header: "Age", accessorFn: (t) => t.createdAt, cell: ({ getValue }) => ago(getValue<string>()).replace(" ago", "") },
      { id: "sla", header: "First response", accessorFn: (t) => t.slaState, cell: ({ row: { original: t } }) => <SlaTag t={t} /> },
      { id: "status", header: "Status", accessorFn: (t) => t.status, cell: ({ row: { original: t } }) => <TicketStatusTag status={t.status} /> },
    ],
    [],
  );
  return (
    <>
      <PageHeader title="Customer tickets" sub="Questions and problems that client companies raise with the Strats360 People team about the product, billing or their account. Employee helpdesk tickets stay inside each company and never show here. You can only view a customer's account if they allow it on the ticket, and every visit is logged." />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))" }}>
        <StatCard label="Open" value={s?.open ?? "—"} meta={s ? `${s.unassigned} unassigned` : undefined} onClick={() => setStatus("open")} />
        <StatCard label="P1 · respond in 1 h" value={s?.p1 ?? "—"} meta={s?.p1 ? <Tag tone="bad">urgent</Tag> : "none"} onClick={() => (setStatus("open"), setPriority("P1"))} />
        <StatCard label="P2 · respond in 4 h" value={s?.p2 ?? "—"} onClick={() => (setStatus("open"), setPriority("P2"))} />
        <StatCard label="SLA missed" value={s?.breached ?? "—"} meta="no first response in time" />
      </div>
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={list.data ?? []}
          columns={columns}
          getRowId={(t) => t.id}
          loading={list.isFetching}
          pageSize={15}
          storageKey="platform-tickets"
          onRowClick={(t) => nav(`/platform/tickets/${t.id}`)}
          empty="No tickets for this filter"
          toolbar={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, tenant or #number" className="!w-[240px]" aria-label="Search" />
              <Segmented<F> value={status} onChange={setStatus} options={[{ value: "open", label: "Open" }, { value: "mine", label: "Mine" }, { value: "resolved,closed", label: "Resolved" }, { value: "", label: "All" }]} />
              <Select className="!w-[130px]" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                <option value="">Any priority</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </Select>
            </>
          }
        />
      </TableCard>
    </>
  );
}
