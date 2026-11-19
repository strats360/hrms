import { useQuery } from "@tanstack/react-query";
import { fmtDate } from "@hrms/shared";
import { api } from "@/lib/api";
import { CardHeader, TableCard } from "@/components/ui/card";
import { PersonCell } from "@/components/ui/avatar";
import { ErrorState, Loading } from "@/components/ui/page";
import { ExpiryTag, type Identity } from "@/components/employees/IdentitiesCard";

interface Row extends Pick<Identity, "state" | "daysLeft" | "label" | "expiresOn"> {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  numberEnding: string;
}

/** Passports, visas and permits that expire soon or already have, for HR to chase. */
export default function ExpiringIds() {
  const q = useQuery({ queryKey: ["identities", "expiring"], queryFn: () => api.get<Row[]>("/admin/employees/identities/expiring") });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <TableCard>
      <CardHeader className="py-2" title="Expiring IDs and visas" sub="Passports remind 180 days ahead, visas and permits 60, local IDs like Emirates ID or Iqama 30. Update the dates on the profile once renewed." />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <div className="text-muted px-5 py-6 text-[13.5px]">Nothing is expiring soon.</div>
      ) : (
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Document</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td><PersonCell employeeId={r.employeeId} name={r.employeeName} sub={r.employeeCode} /></td>
                  <td>{r.label} <span className="text-muted text-[12.5px]">ending {r.numberEnding}</span></td>
                  <td className="whitespace-nowrap">{fmtDate(r.expiresOn)}</td>
                  <td><ExpiryTag i={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
