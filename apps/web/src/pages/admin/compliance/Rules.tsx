import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { CardHeader, TableCard, Card } from "@/components/ui/card";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Rules {
  statutory: Record<string, { enabled: boolean; registration?: string | null }>;
  rules: { rule: string; value: string; scope: string; source: string }[];
}
const REG = [["epf", "EPF"], ["esi", "ESI"], ["pt", "Professional Tax"], ["lwf", "LWF"], ["tds", "TDS (TAN)"], ["bonus", "Bonus"]] as const;

export default function RulesPage() {
  const q = useQuery({ queryKey: ["compliance", "rules"], queryFn: () => api.get<Rules>("/admin/compliance/rules") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  return (
    <>
      <Card className="!gap-3">
        <CardHeader title="Registrations" sub="Turn statutes on or off and keep registration numbers in Settings › Organization." actions={<Link to="/settings" className="btn btn-secondary">Edit in settings</Link>} />
        <div className="flex flex-wrap gap-2">
          {REG.map(([k, label]) => {
            const s = d.statutory[k];
            return (
              <Tag key={k} tone={s?.enabled ? "ok" : "neutral"}>
                {label}: {s?.enabled ? s.registration || "applicable" : "not applicable"}
              </Tag>
            );
          })}
        </div>
      </Card>
      <TableCard>
        <CardHeader className="py-2" title="Rules in force" sub="Rates and state tables used by payroll. Versioned, editable rules arrive with the platform statutory master." />
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Value</th>
                <th>Scope</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {d.rules.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap font-semibold">{r.rule}</td>
                  <td className="min-w-[260px]">{r.value}</td>
                  <td>{r.scope}</td>
                  <td className="text-muted text-[12.5px]">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    </>
  );
}
