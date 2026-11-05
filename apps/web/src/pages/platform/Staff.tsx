import { useQuery } from "@tanstack/react-query";
import { fmtDate } from "@hrms/shared";
import { api } from "@/lib/api";
import { CardHeader, TableCard } from "@/components/ui/card";
import { ErrorState, Loading, PageHeader } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";

interface Staff {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

const ROLE: Record<string, string> = { super_admin: "Super admin", support: "Support", finance: "Finance" };

export default function PlatformStaff() {
  const q = useQuery({ queryKey: ["platform", "staff"], queryFn: () => api.get<Staff[]>("/platform/staff") });
  return (
    <>
      <PageHeader title="Platform staff" sub="SaaS-side users and their access" />
      <TableCard>
        <CardHeader className="py-2" title="Staff" sub="Add staff by running the provisioning script for now; an invite flow comes with the support module." />
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Since</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.map((s) => (
                <tr key={s.userId}>
                  <td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-muted text-[12px]">{s.email}</div>
                  </td>
                  <td>{ROLE[s.role] ?? s.role}</td>
                  <td>{fmtDate(s.createdAt.slice(0, 10))}</td>
                  <td>
                    <StatusTag status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
