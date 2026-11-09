import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api, download, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { monthLabel } from "@/components/payroll/Payslip";
import { Form16Dialog } from "./Computation";
import { useFy } from "./shared";

interface Quarter {
  quarter: string;
  months: string[];
  due: string;
  lockedMonths: number;
  tdsDeducted: number;
  amountPaid: number;
  tdsDeposited: number;
  challansMissing: string[];
  filed: { filedOn: string; acknowledgement: string | null; notes: string | null } | null;
}
interface F16List {
  fy: string;
  closed: boolean;
  lockedMonths: number;
  q4Filed: boolean;
  quartersFiled: string[];
  employees: { id: string; name: string; code: string; pan: string | null; gross: number; tds: number }[];
}
type F16Row = F16List["employees"][number];

const span = (months: string[]) => `${monthLabel(months[0]!).split(" ")[0]!.slice(0, 3)}–${monthLabel(months[2]!).split(" ")[0]!.slice(0, 3)} ${months[2]!.slice(0, 4)}`;

export default function Form16Page() {
  const fy = useFy();
  const { can } = useSession();
  const returns = useQuery({ queryKey: ["tds", "returns", fy], queryFn: () => api.get<{ fy: string; quarters: Quarter[] }>(`/admin/tds/returns${qs({ fy })}`) });
  const list = useQuery({ queryKey: ["tds", "form16-list", fy], queryFn: () => api.get<F16List>(`/admin/tds/form16${qs({ fy })}`) });
  const [filing, setFiling] = useState<Quarter | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [zipping, setZipping] = useState(false);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data?.employees ?? []).filter((e) => !s || e.name.toLowerCase().includes(s) || e.code.toLowerCase().includes(s) || (e.pan ?? "").toLowerCase().includes(s));
  }, [list.data, search]);
  const cols = useMemo<ColumnDef<F16Row>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: e } }) => <div><div className="font-medium">{e.name}</div><div className="text-muted text-[12px]">{e.code}</div></div> },
      { id: "pan", header: "PAN", accessorKey: "pan", cell: ({ getValue }) => getValue<string>() ?? <span style={{ color: "var(--warn-fg)" }}>Missing</span> },
      { id: "gross", header: "Salary paid", accessorKey: "gross", meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
      { id: "tds", header: "TDS", accessorKey: "tds", meta: { align: "right" }, cell: ({ getValue }) => inr(getValue<number>()) },
    ],
    [],
  );

  return (
    <>
      <div className="card-title text-[17px]">24Q quarterly returns · FY {fy}</div>
      {returns.isLoading ? (
        <Loading />
      ) : returns.error ? (
        <ErrorState error={returns.error} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {returns.data!.quarters.map((q) => {
            const overdue = !q.filed && q.due < todayIST() && q.lockedMonths > 0;
            return (
              <Card key={q.quarter} className="!gap-2 !p-[18px]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="card-kicker">{q.quarter}</div>
                    <div className="font-semibold">{span(q.months)}</div>
                  </div>
                  {q.filed ? <Tag tone="ok">Filed {fmtDate(q.filed.filedOn, false)}</Tag> : overdue ? <Tag tone="bad">Overdue</Tag> : <Tag tone="neutral">Due {fmtDate(q.due, false)}</Tag>}
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted">TDS deducted</span>
                  <span className="num">{inr(q.tdsDeducted)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted">Deposited</span>
                  <span className="num">{inr(q.tdsDeposited)}</span>
                </div>
                <div className="text-muted text-[12px]">
                  {q.lockedMonths}/3 months locked{q.filed?.acknowledgement ? ` · ack ${q.filed.acknowledgement}` : ""}
                </div>
                {q.challansMissing.length ? <div className="text-[12px]" style={{ color: "var(--warn-fg)" }}>No TDS challan recorded for {q.challansMissing.map((m) => monthLabel(m)).join(", ")}</div> : null}
                <div className="mt-1 flex flex-wrap gap-2">
                  {can("tds", "export") && q.lockedMonths > 0 ? (
                    <Button size="sm" onClick={() => download(`/admin/tds/returns/${fy}/${q.quarter}/annexure.csv`, `24Q-${fy}-${q.quarter}.csv`).catch((e) => toast.error(e.message))}>
                      <Download size={14} /> Annexure CSV
                    </Button>
                  ) : null}
                  {can("tds", "edit") && q.lockedMonths > 0 ? (
                    <Button size="sm" variant={q.filed ? "ghost" : "primary"} onClick={() => setFiling(q)}>
                      {q.filed ? "Edit filing" : "Mark as filed"}
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="text-muted text-[12.5px]">The annexure has one line per employee per month (PAN, amount paid, TDS, challan) to prepare the return in the NSDL return preparation utility.</div>

      <div className="card-title mt-2 text-[17px]">Form 16 · FY {fy}</div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : (
        <>
          {list.data!.closed && list.data!.q4Filed ? (
            <Notice tone="ok">The year is closed and Q4 is filed. Form 16 Part B is final; merge it with Part A downloaded from TRACES before issuing.</Notice>
          ) : (
            <Notice tone="warn">
              Provisional: {list.data!.lockedMonths} of 12 months locked. Final Form 16 is available after March payroll is locked and Q4 is filed (due 31 May).
            </Notice>
          )}
          <TableCard>
            <div className="flex flex-wrap items-center gap-2 py-2">
              <CardHeader
                title={`${list.data!.employees.length} employees`}
                actions={
                  can("tds", "export") ? (
                    <Button
                      loading={zipping}
                      onClick={() => {
                        setZipping(true);
                        download(`/admin/tds/form16.zip?fy=${fy}`, `form16-${fy}.zip`)
                          .catch((e) => toast.error(e.message))
                          .finally(() => setZipping(false));
                      }}
                    >
                      <Download size={15} /> All Form 16 PDFs
                    </Button>
                  ) : null
                }
              />
              <Input className="ml-auto !w-[220px]" placeholder="Search name, ID or PAN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            </div>
            <DataTable
              data={rows}
              columns={cols}
              getRowId={(e) => e.id}
              pageSize={15}
              storageKey="tds-form16"
              onRowClick={(e) => setPreview(e.id)}
              rowActions={(e) => [{ label: "Preview Form 16", onSelect: () => setPreview(e.id) }]}
            />
          </TableCard>
        </>
      )}
      <FilingDialog fy={fy} q={filing} onClose={() => setFiling(null)} />
      <Form16Dialog employeeId={preview} fy={fy} onClose={() => setPreview(null)} />
    </>
  );
}

function FilingDialog({ fy, q, onClose }: { fy: string; q: Quarter | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ filedOn: todayIST(), acknowledgement: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (q && lastKey !== q.quarter) {
    setLastKey(q.quarter);
    setError(null);
    setForm({ filedOn: q.filed?.filedOn ?? todayIST(), acknowledgement: q.filed?.acknowledgement ?? "", notes: q.filed?.notes ?? "" });
  }
  if (!q && lastKey) setLastKey(null);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => api.put(`/admin/tds/returns/${fy}/${q!.quarter}`, { filedOn: form.filedOn, acknowledgement: form.acknowledgement.trim() || null, notes: form.notes.trim() || null }),
    onSuccess: () => {
      toast.success(`24Q ${q!.quarter} marked as filed`);
      qc.invalidateQueries({ queryKey: ["tds"] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog
      open={!!q}
      onOpenChange={(o) => !o && onClose()}
      title={q ? `24Q ${q.quarter} filing` : "24Q filing"}
      description={q ? `${span(q.months)} · due ${fmtDate(q.due)}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Field label="Filed on">
        <Input type="date" max={todayIST()} value={form.filedOn} onChange={(e) => setForm({ ...form, filedOn: e.target.value })} />
      </Field>
      <Field label="Token / provisional receipt number">
        <Input value={form.acknowledgement} onChange={(e) => setForm({ ...form, acknowledgement: e.target.value })} />
      </Field>
      <Field label="Notes">
        <Textarea className="!min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}
