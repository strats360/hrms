import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Plus } from "lucide-react";
import { CONTRACTOR_SECTIONS, contractorPaymentSchema, contractorSchema, fmtDate, fmtMoney, todayLocal, type ContractorSection } from "@hrms/shared";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Contractor {
  id: string;
  name: string;
  pan: string | null;
  kind: "individual" | "company";
  section: ContractorSection;
  email: string | null;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  active: boolean;
  paidThisYear: number;
  tdsThisYear: number;
}
interface Payment {
  id: string;
  contractorName: string;
  invoiceNo: string | null;
  invoiceDate: string;
  gross: number;
  tds: number;
  net: number;
  sectionName: string;
  tdsNote: string | null;
  status: "draft" | "paid";
  paidOn: string | null;
}

/** Contractors and professionals paid against invoices, with TDS under 194C or 194J (section 393 from 2026-27). */
export default function Contractors() {
  const { can } = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["contractors"], queryFn: () => api.get<{ fy: string; rows: Contractor[] }>("/admin/contractors") });
  const fy = list.data?.fy ?? "";
  const pays = useQuery({ queryKey: ["contractors", "payments", fy], enabled: !!fy, queryFn: () => api.get<{ rows: Payment[] }>(`/admin/contractors/payments?fy=${fy}`) });
  const [edit, setEdit] = useState<Partial<Contractor> & { accountNumber?: string } | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["contractors"] });
  const markPaid = useMutation({
    mutationFn: (id: string) => api.post(`/admin/contractors/payments/${id}/paid`, { paidOn: todayLocal() }),
    onSuccess: () => {
      toast.success("Marked as paid");
      invalidate();
    },
  });

  const cols = useMemo<ColumnDef<Contractor>[]>(
    () => [
      { id: "name", header: "Contractor", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-semibold">{r.name}</div><div className="text-muted text-[12px]">{r.pan ?? "No PAN: TDS at 20%"}</div></div> },
      { id: "section", header: "Section", accessorFn: (r) => CONTRACTOR_SECTIONS[r.section].label },
      { id: "paid", header: "Paid this year", accessorKey: "paidThisYear", meta: { align: "right" }, cell: ({ getValue }) => fmtMoney(getValue<number>()) },
      { id: "tds", header: "TDS this year", accessorKey: "tdsThisYear", meta: { align: "right" }, cell: ({ getValue }) => fmtMoney(getValue<number>()) },
    ],
    [],
  );
  const payCols = useMemo<ColumnDef<Payment>[]>(
    () => [
      { id: "date", header: "Invoice", accessorKey: "invoiceDate", cell: ({ row: { original: p } }) => <div><div>{fmtDate(p.invoiceDate)}</div><div className="text-muted text-[12px]">{p.invoiceNo ?? ""}</div></div> },
      { id: "who", header: "Contractor", accessorKey: "contractorName" },
      { id: "sec", header: "Section", accessorKey: "sectionName" },
      { id: "gross", header: "Amount", accessorKey: "gross", meta: { align: "right" }, cell: ({ getValue }) => fmtMoney(Number(getValue())) },
      { id: "tdsamt", header: "TDS", accessorKey: "tds", meta: { align: "right" }, cell: ({ row: { original: p } }) => <span title={p.tdsNote ?? undefined}>{fmtMoney(Number(p.tds))}</span> },
      { id: "net", header: "Net", accessorKey: "net", meta: { align: "right" }, cell: ({ getValue }) => <span className="font-semibold">{fmtMoney(Number(getValue()))}</span> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: p } }) => (p.status === "paid" ? <Tag tone="ok">Paid {p.paidOn ? fmtDate(p.paidOn) : ""}</Tag> : <Tag tone="warn">To pay</Tag>) },
    ],
    [],
  );

  return (
    <>
      <Notice tone="sel">Pay contractors and professionals against their invoices. TDS follows 194C (contract work, 1% or 2%) or 194J (professional fees 10%, technical services 2%), which the Income Tax Act 2025 puts in section 393 from 2026-27, with the yearly thresholds and 20% without a PAN.</Notice>
      <TableCard>
        <CardHeader className="py-2" title="Contractors" sub={`Totals for ${fy}`} actions={can("payroll", "edit") ? <Button variant="primary" onClick={() => setEdit({ kind: "individual", section: "194C", active: true })}><Plus size={16} /> Add contractor</Button> : null} />
        <DataTable data={list.data?.rows ?? []} columns={cols} getRowId={(r) => r.id} storageKey="contractors" empty="No contractors yet" rowActions={(r) => [{ label: "Edit", onSelect: () => setEdit(r) }, ...(can("payroll", "edit") ? [{ label: "Record a payment", onSelect: () => setPaying(r.id) }] : [])]} />
      </TableCard>
      <TableCard>
        <CardHeader
          className="py-2"
          title="Payments"
          sub={fy}
          actions={
            can("payroll", "export") ? (
              <div className="flex gap-1.5">
                {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                  <Button key={q} size="sm" onClick={() => download(`/admin/contractors/tds.csv?fy=${fy}&quarter=${q}`, `contractor-tds-${fy}-${q}.csv`).catch((e) => toast.error(e.message))}>
                    <Download size={14} /> {q}
                  </Button>
                ))}
              </div>
            ) : null
          }
        />
        <DataTable data={pays.data?.rows ?? []} columns={payCols} getRowId={(r) => r.id} storageKey="contractor-payments" empty="No payments this year" rowActions={(p) => (p.status === "draft" && can("payroll", "approve") ? [{ label: "Mark as paid today", onSelect: () => markPaid.mutate(p.id) }] : [])} />
      </TableCard>
      {edit ? <ContractorDialog value={edit} onClose={() => setEdit(null)} onSaved={invalidate} /> : null}
      {paying ? <PaymentDialog contractor={list.data?.rows.find((r) => r.id === paying)!} onClose={() => setPaying(null)} onSaved={invalidate} /> : null}
    </>
  );
}

function ContractorDialog({ value, onClose, onSaved }: { value: Partial<Contractor> & { accountNumber?: string }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const parsed = contractorSchema.safeParse({ ...f, accountNumber: f.accountNumber || undefined });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return f.id ? api.patch(`/admin/contractors/${f.id}`, parsed.data) : api.post("/admin/contractors", parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Contractor saved");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(e.message),
  });
  const text = (k: "name" | "pan" | "email" | "bankName" | "accountNumber" | "ifsc") => ({ value: (f[k] as string | null | undefined) ?? "", onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={f.id ? "Edit contractor" : "Add contractor"} width={600} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input {...text("name")} autoFocus /></Field>
        <Field label="PAN" hint="Without one, TDS is 20%"><Input {...text("pan")} className="uppercase" maxLength={10} /></Field>
        <Field label="Type">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Contractor["kind"] })}>
            <option value="individual">Individual or HUF</option>
            <option value="company">Firm or company</option>
          </Select>
        </Field>
        <Field label="What they're paid for">
          <Select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value as ContractorSection })}>
            {Object.entries(CONTRACTOR_SECTIONS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Email"><Input type="email" {...text("email")} /></Field>
        <Field label="Bank name"><Input {...text("bankName")} /></Field>
        <Field label="Account number" hint={f.accountLast4 ? `Leave blank to keep ···· ${f.accountLast4}` : undefined}><Input inputMode="numeric" {...text("accountNumber")} /></Field>
        <Field label="IFSC"><Input {...text("ifsc")} className="uppercase" /></Field>
      </div>
    </Dialog>
  );
}

function PaymentDialog({ contractor, onClose, onSaved }: { contractor: Contractor; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ invoiceNo: "", invoiceDate: todayLocal(), description: "", gross: "" });
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ tds: number; net: number; note: string; sectionName: string } | null>(null);
  const body = { contractorId: contractor.id, ...f, gross: Number(f.gross.replace(/[,₹\s]/g, "")) };
  useEffect(() => {
    const parsed = contractorPaymentSchema.safeParse(body);
    if (!parsed.success) return setPreview(null);
    const t = setTimeout(() => void api.post<{ tds: number; net: number; note: string; sectionName: string }>("/admin/contractors/preview", parsed.data).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.gross, f.invoiceDate]);
  const save = useMutation({
    mutationFn: async () => {
      const parsed = contractorPaymentSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return api.post("/admin/contractors/payments", parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Payment recorded");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(e.message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Pay ${contractor.name}`} width={520} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record payment</Button></>}>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number"><Input value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} /></Field>
        <Field label="Invoice date"><Input type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} /></Field>
        <Field label="Amount (before TDS)"><Input inputMode="decimal" value={f.gross} onChange={(e) => setF({ ...f, gross: e.target.value })} autoFocus /></Field>
        <Field label="For"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      {preview ? (
        <Notice tone="sel">
          {preview.sectionName}: TDS {fmtMoney(preview.tds)}, pay {fmtMoney(preview.net)}. {preview.note}.
        </Notice>
      ) : null}
    </Dialog>
  );
}
