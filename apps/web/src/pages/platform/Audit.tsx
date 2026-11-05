import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TableCard } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { AuditTable, type AuditRow } from "@/pages/admin/settings/Audit";

export default function PlatformAudit() {
  const q = useQuery({ queryKey: ["platform", "audit"], queryFn: () => api.get<AuditRow[]>("/platform/audit") });
  return (
    <>
      <PageHeader title="Audit log" sub="Latest 200 actions across the platform" />
      <TableCard>{q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : <AuditTable rows={q.data!} showTenant />}</TableCard>
    </>
  );
}
