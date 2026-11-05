import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";

export interface AuditRow {
  id: string;
  actorName: string | null;
  action: string;
  entity: string;
  summary: string | null;
  ip: string | null;
  createdAt: string;
  tenantName?: string | null;
}

export function AuditTable({ rows, showTenant }: { rows: AuditRow[]; showTenant?: boolean }) {
  return (
    <div className="scroll-thin min-w-0 overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            {showTenant ? <th>Tenant</th> : null}
            <th>Action</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{new Date(a.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
              <td className="whitespace-nowrap font-semibold">{a.actorName ?? "System"}</td>
              {showTenant ? <td className="whitespace-nowrap">{a.tenantName ?? "Platform"}</td> : null}
              <td className="min-w-[260px]">
                {a.summary ?? a.action}
                <div className="text-muted text-[11.5px]">{a.action}</div>
              </td>
              <td className="text-muted text-[12px]">{a.ip ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-muted text-center">
                No activity found
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function Audit() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ["audit", term],
    queryFn: ({ pageParam }) => api.get<AuditRow[]>(`/admin/audit${qs({ q: term, before: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1]!.createdAt : undefined),
  });
  return (
    <TableCard>
      <CardHeader className="py-2" title="Audit log" sub="Every change made in the admin console, newest first." actions={<Input className="!w-[240px]" placeholder="Search actions or people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />} />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : <AuditTable rows={list.data?.pages.flat() ?? []} />}
      {list.hasNextPage ? (
        <Button className="self-start" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          Load older
        </Button>
      ) : null}
    </TableCard>
  );
}
