import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ExternalLink, X } from "lucide-react";
import { fmtDate, inr, TAX_SECTION_LABELS, TAX_SECTIONS, type TaxSection } from "@hrms/shared";
import { api, ApiError, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { TaxDeclaration, TaxProof } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Input, Segmented } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { DECL_STATUS_LABEL, DECL_STATUS_TONE, useFy } from "./shared";

type Declared = Record<TaxSection, number>;
interface Row {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  pan: string | null;
  regime: "new" | "old";
  status: TaxDeclaration["status"];
  submittedAt: string | null;
  declared: Declared;
  verified: Partial<Declared>;
  proofs: { total: number; pending: number };
}
interface Detail extends TaxDeclaration {
  employeeName: string;
  employeeCode: string;
  declared: Declared;
  proofs: TaxProof[];
}
type Filter = "" | "submitted" | "verified" | "draft";

const OTHER: TaxSection[] = ["80CCD1B", "80E", "80G", "80TTA", "previousEmployer"];
const amt = (k: TaxSection, header: string): ColumnDef<Row> => ({ id: k, header, accessorFn: (r) => r.declared[k], meta: { align: "right" }, cell: ({ getValue }) => (getValue<number>() ? inr(getValue<number>()) : "—") });

export default function Declarations() {
  const fy = useFy();
  const [status, setStatus] = useState<Filter>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["tds", "declarations", fy, status], queryFn: () => api.get<Row[]>(`/admin/tds/declarations${qs({ fy, status })}`) });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [q.data, search]);
  const cols = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code}{r.submittedAt ? ` · submitted ${fmtDate(r.submittedAt.slice(0, 10))}` : ""}</div></div> },
      { id: "regime", header: "Regime", accessorKey: "regime", cell: ({ getValue }) => (getValue<string>() === "old" ? "Old" : "New") },
      amt("80C", "80C"),
      amt("80D", "80D"),
      amt("hra", "HRA rent"),
      amt("24b", "24(b)"),
      { id: "other", header: "Other", accessorFn: (r) => OTHER.reduce((s, k) => s + (r.declared[k] ?? 0), 0), meta: { align: "right" }, cell: ({ getValue }) => (getValue<number>() ? inr(getValue<number>()) : "—") },
      { id: "proofs", header: "Proofs", accessorFn: (r) => r.proofs.pending, cell: ({ row: { original: r } }) => (r.proofs.total ? <Tag tone={r.proofs.pending ? "warn" : "ok"}>{r.proofs.pending ? `${r.proofs.pending} of ${r.proofs.total} to review` : `${r.proofs.total} reviewed`}</Tag> : <span className="text-muted">None</span>) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ getValue }) => <Tag tone={DECL_STATUS_TONE[getValue<string>()] ?? "neutral"}>{DECL_STATUS_LABEL[getValue<string>()] ?? getValue<string>()}</Tag> },
    ],
    [],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented<Filter> value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "submitted", label: "Submitted" }, { value: "verified", label: "Verified" }, { value: "draft", label: "Draft" }]} />
        <Input className="!w-[240px]" placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      </div>
      <TableCard>
        <div className="card-title py-2 text-[17px]">Declarations & proofs · FY {fy}</div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : <DataTable data={rows} columns={cols} getRowId={(r) => r.id} pageSize={15} storageKey="tds-declarations" onRowClick={(r) => setOpen(r.id)} empty="No declarations for this filter" />}
      </TableCard>
      <div className="text-muted text-[12.5px]">Verified amounts replace declared amounts in TDS from the next payroll run. Employees who don't declare are taxed under the new regime with no deductions.</div>
      <ReviewDialog id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ReviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tds", "declaration", id], queryFn: () => api.get<Detail>(`/admin/tds/declarations/${id}`), enabled: !!id });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const d = q.data;
  const sections = useMemo(() => (d ? TAX_SECTIONS.filter((k) => (d.declared[k] ?? 0) > 0 || d.proofs.some((p) => p.section === k)) : []), [d]);
  useEffect(() => {
    setError(null);
    if (d) setValues(Object.fromEntries(sections.map((k) => [k, String(d.verified[k] ?? d.declared[k] ?? 0)])));
  }, [d, sections]);
  const canEdit = can("tds", "edit");
  const locked = d?.status === "verified";

  const done = () => qc.invalidateQueries({ queryKey: ["tds"] });
  const verify = useMutation({
    meta: { silent: true },
    mutationFn: (lock: boolean) => {
      const verified: Record<string, number> = {};
      for (const k of sections) {
        const n = Number(values[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`Enter a valid amount for ${TAX_SECTION_LABELS[k]}`);
        verified[k] = n;
      }
      return api.post(`/admin/tds/declarations/${id}/verify`, { verified, lock });
    },
    onSuccess: (_r, lock) => {
      toast.success(lock ? "Declaration verified and locked" : "Verified amounts saved");
      done();
      if (lock) onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 403 ? e.message : e.message),
  });
  const proof = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; status: "accepted" | "rejected" }) => api.patch(`/admin/tds/proofs/${v.id}`, { status: v.status }),
    onSuccess: () => done(),
    onError: (e) => setError(e.message),
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`/admin/tds/declarations/${id}/reopen`),
    onSuccess: () => {
      toast.success("Declaration reopened");
      done();
    },
  });

  return (
    <Dialog
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={d ? `${d.employeeName} · tax declaration` : "Tax declaration"}
      description={d ? `${d.employeeCode} · FY ${d.fy} · ${d.regime === "old" ? "Old" : "New"} regime · ${DECL_STATUS_LABEL[d.status]}` : undefined}
      width={760}
      footer={
        d ? (
          <>
            <Button onClick={onClose}>Close</Button>
            {locked && can("tds", "configure") ? (
              <Button loading={reopen.isPending} onClick={() => reopen.mutate()}>
                Reopen
              </Button>
            ) : null}
            {!locked && canEdit && d.status !== "draft" ? (
              <>
                <Button loading={verify.isPending && verify.variables === false} onClick={() => verify.mutate(false)}>
                  Save verified amounts
                </Button>
                <Button variant="primary" loading={verify.isPending && verify.variables === true} onClick={() => verify.mutate(true)}>
                  Verify & lock
                </Button>
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {q.isLoading || !d ? (
        <Loading />
      ) : (
        <>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {d.status === "draft" ? <Notice tone="warn">The employee hasn't submitted this declaration yet, so it can't be verified.</Notice> : null}
          {locked ? <Notice tone="ok">Verified{d.verifiedAt ? ` on ${fmtDate(d.verifiedAt.slice(0, 10))}` : ""}. The employee can't change it unless it's reopened.</Notice> : null}
          {d.regime === "new" ? <Notice tone="sel">New regime: deductions below don't reduce tax. Only previous employer income counts.</Notice> : null}
          {sections.length === 0 ? (
            <div className="text-muted text-[13px]">Nothing declared.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sections.map((k) => {
                const files = d.proofs.filter((p) => p.section === k);
                return (
                  <div key={k} className="rounded-[var(--radius-md)] px-3.5 py-3" style={{ background: "var(--tint-1)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{TAX_SECTION_LABELS[k]}</div>
                        <div className="text-muted text-[12.5px]">
                          Declared {inr(d.declared[k] ?? 0)}
                          {k === "hra" && d.data.rent ? ` · ${inr(d.data.rent.monthlyRent)} × ${d.data.rent.months} months · ${d.data.rent.metro ? "metro" : "non-metro"}${d.data.rent.landlordName ? ` · landlord ${d.data.rent.landlordName}` : ""}${d.data.rent.landlordPan ? ` (PAN ${d.data.rent.landlordPan})` : ""}` : ""}
                          {k === "previousEmployer" && d.data.previousEmployer ? ` · TDS ${inr(d.data.previousEmployer.tds ?? 0)}${d.data.previousEmployer.name ? ` · ${d.data.previousEmployer.name}` : ""}` : ""}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-[12.5px]">
                        <span className="text-muted">Verified</span>
                        <Input className="!w-[130px]" inputMode="decimal" value={values[k] ?? ""} disabled={!canEdit || locked || d.status === "draft"} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} aria-label={`Verified amount for ${TAX_SECTION_LABELS[k]}`} />
                      </label>
                    </div>
                    {files.length ? (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {files.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                            <a href={`/api/admin/tds/proofs/${p.id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
                              {p.fileName} <ExternalLink size={12} />
                            </a>
                            <Tag tone={p.status === "accepted" ? "ok" : p.status === "rejected" ? "bad" : "warn"}>{p.status === "pending" ? "To review" : p.status === "accepted" ? "Accepted" : "Rejected"}</Tag>
                            {canEdit && !locked ? (
                              <span className="ml-auto flex gap-1">
                                <Button size="sm" icon title="Accept" aria-label={`Accept ${p.fileName}`} disabled={p.status === "accepted"} onClick={() => proof.mutate({ id: p.id, status: "accepted" })}>
                                  <Check size={14} />
                                </Button>
                                <Button size="sm" icon title="Reject" aria-label={`Reject ${p.fileName}`} disabled={p.status === "rejected"} onClick={() => proof.mutate({ id: p.id, status: "rejected" })}>
                                  <X size={14} />
                                </Button>
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted mt-1 text-[12px]">No proof uploaded</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-muted text-[12px]">Set a verified amount to 0 to disallow a section. Caps (80C ₹1.5 L, 80D, 24(b) ₹2 L) are applied in the computation.</div>
        </>
      )}
    </Dialog>
  );
}
