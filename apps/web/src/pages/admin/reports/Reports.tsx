import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { todayIST } from "@hrms/shared";
import { api, download, errorMessage, qs } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Empty, ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";

interface ReportMeta {
  key: string;
  name: string;
  group: string;
  description: string;
  usesPeriod: boolean;
  allowed: boolean;
}
interface ReportList {
  reports: ReportMeta[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  canExport: boolean;
}
interface Preview {
  name: string;
  period: string | null;
  header: string[];
  rows: unknown[][];
  total: number;
  note: string | null;
  extraSheets: string[];
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function periodOptions() {
  const today = todayIST();
  const [y, m] = today.split("-").map(Number) as [number, number];
  const fyStart = m >= 4 ? y : y - 1;
  const fy = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  const months: { value: string; label: string }[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push({ value: d.toISOString().slice(0, 7), label: `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  const cq = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  const quarters = [1, 2, 3, 4].filter((q) => q <= cq).map((q) => ({ value: `${fy(fyStart)}:Q${q}`, label: `Q${q} FY ${fy(fyStart)}` }));
  const prevQuarters = [1, 2, 3, 4].map((q) => ({ value: `${fy(fyStart - 1)}:Q${q}`, label: `Q${q} FY ${fy(fyStart - 1)}` }));
  return {
    groups: [
      { label: "Month", options: months },
      { label: "Quarter", options: [...quarters.reverse(), ...prevQuarters.reverse()] },
      { label: "Financial year", options: [{ value: fy(fyStart), label: `FY ${fy(fyStart)} to date` }, { value: fy(fyStart - 1), label: `FY ${fy(fyStart - 1)}` }] },
    ],
    // default: last month (usually the latest locked payroll)
    default: months[1]!.value,
  };
}

export default function Reports() {
  const list = useQuery({ queryKey: ["reports"], queryFn: () => api.get<ReportList>("/admin/reports") });
  const periods = useMemo(periodOptions, []);
  const [period, setPeriod] = useState(periods.default);
  const [branchId, setBranch] = useState("");
  const [departmentId, setDept] = useState("");
  const [status, setStatus] = useState<"all" | "active">("all");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<ReportMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filters = { period, branchId, departmentId, status };
  const run = async (r: ReportMeta, format: "csv" | "xlsx") => {
    setBusy(`${r.key}-${format}`);
    try {
      await download(`/admin/reports/${r.key}${qs({ ...filters, format })}`, `${r.key}.${format}`);
      toast.success(`${r.name} downloaded`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const shown = (list.data?.reports ?? []).filter((r) => !q.trim() || `${r.name} ${r.group} ${r.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Reports" sub="Download reports with filters, as CSV or Excel" />
      {list.isLoading ? <Loading /> : null}
      {list.error ? <ErrorState error={list.error} retry={() => list.refetch()} /> : null}
      {list.data ? (
        <>
          <Card className="!flex-row flex-wrap items-end !gap-3" style={{ padding: "16px 20px" }}>
            <Field label="Period" className="min-w-[200px]">
              <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {periods.groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Branch" className="min-w-[170px]">
              <Select value={branchId} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches</option>
                {list.data.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" className="min-w-[180px]">
              <Select value={departmentId} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>
                {list.data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employee status" className="min-w-[160px]">
              <Select value={status} onChange={(e) => setStatus(e.target.value as "all" | "active")}>
                <option value="all">Active and exited</option>
                <option value="active">Active only</option>
              </Select>
            </Field>
            <Field label="Find a report" className="min-w-[180px]">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Salary, PF, leave…" />
            </Field>
            <div className="text-muted ml-auto pb-2 text-[12.5px]">Filters apply to every report below</div>
          </Card>
          {!list.data.canExport ? <Notice tone="sel">You can preview reports. Ask an admin for export rights to download them.</Notice> : null}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
            {shown.map((r) => (
              <Card key={r.key} className="!gap-1.5" style={{ padding: "18px 20px" }}>
                <div className="card-kicker">{r.group}</div>
                <div className="card-title flex items-center gap-2 !text-[16px]">
                  {r.name} {!r.allowed ? <Lock size={14} aria-label="No access" /> : null}
                </div>
                <div className="card-body text-[13.5px]">{r.description}</div>
                <div className="text-muted text-[12px]">{r.usesPeriod ? "Uses the period filter" : "Current snapshot"}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.allowed ? (
                    <>
                      <Button size="sm" disabled={!list.data!.canExport} loading={busy === `${r.key}-csv`} onClick={() => run(r, "csv")}>
                        CSV
                      </Button>
                      <Button size="sm" disabled={!list.data!.canExport} loading={busy === `${r.key}-xlsx`} onClick={() => run(r, "xlsx")}>
                        Excel
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPreview(r)}>
                        Preview
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted text-[12.5px]">Your role doesn't include this data</span>
                  )}
                </div>
              </Card>
            ))}
          </div>
          {!shown.length ? <Empty title="No report matches" /> : null}
        </>
      ) : null}
      <PreviewDialog report={preview} filters={filters} onClose={() => setPreview(null)} />
    </>
  );
}

function PreviewDialog({ report, filters, onClose }: { report: ReportMeta | null; filters: Record<string, string>; onClose: () => void }) {
  const q = useQuery({ queryKey: ["reports", "preview", report?.key, filters], queryFn: () => api.get<Preview>(`/admin/reports/${report!.key}${qs(filters)}`), enabled: !!report });
  const d = q.data;
  const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : v === null || v === undefined ? "" : String(v));
  return (
    <Dialog open={!!report} onOpenChange={(v) => !v && onClose()} title={report?.name ?? "Report"} description={d ? `${d.period ? d.period + " · " : ""}${d.total} row${d.total === 1 ? "" : "s"}${d.total > d.rows.length ? `, first ${d.rows.length} shown` : ""}${d.extraSheets.length ? ` · Excel also has: ${d.extraSheets.join(", ")}` : ""}` : undefined} width={1100}>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} /> : null}
      {d?.note ? <Notice tone="sel">{d.note}</Notice> : null}
      {d ? (
        d.rows.length ? (
          <div className="max-h-[60vh] overflow-auto">
            <table className="table text-[12.5px]">
              <thead>
                <tr>
                  {d.header.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className="whitespace-nowrap" style={{ textAlign: typeof v === "number" ? "right" : undefined, fontVariantNumeric: "tabular-nums" }}>
                        {fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No rows for these filters" sub="Try a different period, or check that payroll for the period is locked." />
        )
      ) : null}
    </Dialog>
  );
}
