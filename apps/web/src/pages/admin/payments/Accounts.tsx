import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { BankFileFormat, DebitAccount } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { FORMAT_OPTIONS, useAccounts } from "@/components/payments/shared";

export default function Accounts() {
  const { can } = useSession();
  const q = useAccounts();
  const [edit, setEdit] = useState<DebitAccount | "new" | null>(null);
  const canEdit = can("payments", "configure");
  const columns = useMemo<ColumnDef<DebitAccount, any>[]>(
    () => [
      { id: "label", header: "Account", accessorFn: (a) => a.label, cell: ({ row: { original: a } }) => <div><span className="font-semibold">{a.label}</span> {a.isDefault ? <Tag tone="accent">Default</Tag> : null}</div> },
      { id: "bank", header: "Bank", accessorFn: (a) => a.bankName, cell: ({ row: { original: a } }) => <div>{a.bankName} ····{a.accountLast4}<div className="text-muted text-[11.5px]">{a.ifsc}</div></div> },
      { id: "format", header: "File format", accessorFn: (a) => a.formatLabel },
      { id: "balance", header: "Balance", accessorFn: (a) => Number(a.balance ?? 0), meta: { align: "right" }, cell: ({ row: { original: a } }) => (a.balance !== null ? <div>{inr(a.balance)}<div className="text-muted text-[11.5px]">{a.balanceAsOf ? `as of ${fmtDate(a.balanceAsOf)}` : ""}</div></div> : "—") },
      { id: "status", header: "Status", accessorFn: (a) => (a.active ? 1 : 0), cell: ({ row: { original: a } }) => (a.active ? <Tag tone="ok">Active</Tag> : <Tag>Inactive</Tag>) },
    ],
    [],
  );
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <Notice tone="sel">Debit accounts are the company accounts salaries and claims are paid from. Account numbers are encrypted and only used to build bank files. The balance is what finance last entered; it isn't read from the bank.</Notice>
      <TableCard>
        <DataTable
          data={q.data ?? []}
          columns={columns}
          getRowId={(a) => a.id}
          loading={q.isFetching}
          columnToggle={false}
          onRowClick={canEdit ? (a) => setEdit(a) : undefined}
          rowActions={canEdit ? (a) => [{ label: "Edit", onSelect: () => setEdit(a) }] : undefined}
          empty="No debit accounts yet"
          toolbar={
            canEdit ? (
              <Button variant="primary" onClick={() => setEdit("new")}>
                <Plus size={16} /> Add account
              </Button>
            ) : undefined
          }
        />
      </TableCard>
      <AccountDialog value={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function AccountDialog({ value, onClose }: { value: DebitAccount | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = value && value !== "new" ? value : null;
  const blank = { label: "", bankName: "", accountNumber: "", ifsc: "", fileFormat: "generic_csv" as BankFileFormat, clientCode: "", isDefault: false, balance: "", balanceAsOf: todayIST(), active: true };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setF(existing ? { label: existing.label, bankName: existing.bankName, accountNumber: "", ifsc: existing.ifsc, fileFormat: existing.fileFormat, clientCode: existing.clientCode ?? "", isDefault: existing.isDefault, balance: existing.balance === null ? "" : String(existing.balance), balanceAsOf: existing.balanceAsOf ?? todayIST(), active: existing.active } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const body = { label: f.label, bankName: f.bankName, ifsc: f.ifsc.toUpperCase(), fileFormat: f.fileFormat, clientCode: f.clientCode || null, isDefault: f.isDefault, balance: f.balance === "" ? null : Number(f.balance), balanceAsOf: f.balance === "" ? null : f.balanceAsOf, active: f.active, ...(f.accountNumber ? { accountNumber: f.accountNumber } : {}) };
      return existing ? api.patch(`/admin/payments/accounts/${existing.id}`, body) : api.post("/admin/payments/accounts", body);
    },
    onSuccess: () => {
      toast.success(existing ? "Account updated" : "Account added");
      qc.invalidateQueries({ queryKey: ["payments"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? `Edit ${existing.label}` : "Add debit account"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Payroll" maxLength={60} />
        </Field>
        <Field label="Bank">
          <Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="HDFC Bank" maxLength={80} />
        </Field>
        <Field label="Account number" hint={existing ? `Ends ${existing.accountLast4}. Leave blank to keep it.` : undefined}>
          <Input inputMode="numeric" value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))} maxLength={20} autoComplete="off" />
        </Field>
        <Field label="IFSC">
          <Input value={f.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} maxLength={11} placeholder="HDFC0000123" />
        </Field>
        <Field label="Bank file format">
          <Select value={f.fileFormat} onChange={(e) => set("fileFormat", e.target.value as BankFileFormat)}>
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Corporate client code" hint="If your bank's format needs one">
          <Input value={f.clientCode} onChange={(e) => set("clientCode", e.target.value)} maxLength={40} />
        </Field>
        <Field label="Balance (₹)" hint="Optional, for the dashboard card">
          <Input inputMode="decimal" value={f.balance} onChange={(e) => set("balance", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label="Balance as of">
          <Input type="date" value={f.balanceAsOf} onChange={(e) => set("balanceAsOf", e.target.value)} />
        </Field>
      </div>
      <Checkbox checked={f.isDefault} onChange={(v) => set("isDefault", v)} label="Default account for new batches" />
      <Checkbox checked={f.active} onChange={(v) => set("active", v)} label="Active" />
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}
