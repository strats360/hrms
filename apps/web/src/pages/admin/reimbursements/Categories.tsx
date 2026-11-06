import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { inr } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ClaimApproval, ExpenseCategory, LimitPeriod } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { APPROVAL_TEXT, limitText } from "@/components/reimbursements/shared";
import { useCategories } from "./ReimbursementsLayout";

export default function Categories() {
  const { can } = useSession();
  const q = useCategories();
  const [edit, setEdit] = useState<ExpenseCategory | "new" | null>(null);
  const canEdit = can("reimbursements", "configure");
  const columns = useMemo<ColumnDef<ExpenseCategory, any>[]>(
    () => [
      { id: "name", header: "Category", accessorFn: (c) => c.name, cell: ({ row: { original: c } }) => <span className="font-semibold">{c.name}</span> },
      { id: "limit", header: "Limit", accessorFn: (c) => Number(c.limitAmount ?? c.ratePerKm ?? 0), cell: ({ row: { original: c } }) => limitText(c) },
      { id: "gst", header: "GST capture", accessorFn: (c) => (c.gstCapture ? 1 : 0), cell: ({ row: { original: c } }) => (c.gstCapture ? "Yes" : "No") },
      { id: "receipt", header: "Receipt", accessorFn: (c) => Number(c.receiptRequiredAbove), cell: ({ row: { original: c } }) => (Number(c.receiptRequiredAbove) ? `Above ${inr(c.receiptRequiredAbove)}` : "Always") },
      { id: "approval", header: "Approval chain", accessorFn: (c) => c.approval, cell: ({ row: { original: c } }) => APPROVAL_TEXT[c.approval] },
      { id: "active", header: "Status", accessorFn: (c) => (c.active ? 1 : 0), cell: ({ row: { original: c } }) => (c.active ? <Tag tone="ok">Active</Tag> : <Tag>Inactive</Tag>) },
    ],
    [],
  );
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <Notice tone="sel">Day and month limits add up the employee's claims in that period. Claims over a limit still go through, but finance reviews them after the manager.</Notice>
      <TableCard>
        <DataTable
          data={q.data ?? []}
          columns={columns}
          getRowId={(c) => c.id}
          pageSize={20}
          columnToggle={false}
          onRowClick={canEdit ? (c) => setEdit(c) : undefined}
          rowActions={canEdit ? (c) => [{ label: "Edit", onSelect: () => setEdit(c) }] : undefined}
          toolbar={
            canEdit ? (
              <Button variant="primary" onClick={() => setEdit("new")}>
                <Plus size={16} /> Add category
              </Button>
            ) : undefined
          }
        />
      </TableCard>
      <CategoryDialog value={edit} onClose={() => setEdit(null)} />
    </>
  );
}

const PERIODS: { value: LimitPeriod; label: string }[] = [
  { value: "claim", label: "Per claim" },
  { value: "day", label: "Per day" },
  { value: "month", label: "Per month" },
  { value: "trip", label: "Per trip" },
  { value: "night", label: "Per night" },
  { value: "km", label: "Per km (rate x distance)" },
];

function CategoryDialog({ value, onClose }: { value: ExpenseCategory | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = value && value !== "new" ? value : null;
  const [f, setF] = useState({ name: "", limitAmount: "", limitPeriod: "claim" as LimitPeriod, ratePerKm: "", gstCapture: false, approval: "manager" as ClaimApproval, receiptRequiredAbove: "0", active: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setF(
      existing
        ? { name: existing.name, limitAmount: existing.limitAmount === null ? "" : String(existing.limitAmount), limitPeriod: existing.limitPeriod, ratePerKm: existing.ratePerKm === null ? "" : String(existing.ratePerKm), gstCapture: existing.gstCapture, approval: existing.approval, receiptRequiredAbove: String(existing.receiptRequiredAbove), active: existing.active }
        : { name: "", limitAmount: "", limitPeriod: "claim", ratePerKm: "", gstCapture: false, approval: "manager", receiptRequiredAbove: "0", active: true },
    );
  }, [value, existing]);
  const perKm = f.limitPeriod === "km";
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      if (!f.name.trim()) throw new Error("Enter a name");
      const body = {
        name: f.name.trim(),
        limitPeriod: f.limitPeriod,
        limitAmount: perKm || f.limitAmount === "" ? null : Number(f.limitAmount),
        ratePerKm: perKm ? Number(f.ratePerKm || 0) : null,
        gstCapture: f.gstCapture,
        approval: f.approval,
        receiptRequiredAbove: Number(f.receiptRequiredAbove || 0),
        active: f.active,
      };
      return existing ? api.patch(`/admin/reimbursements/categories/${existing.id}`, body) : api.post("/admin/reimbursements/categories", body);
    },
    onSuccess: () => {
      toast.success(existing ? "Category updated" : "Category added");
      qc.invalidateQueries({ queryKey: ["claims", "categories"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? `Edit ${existing.name}` : "Add expense category"}
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
        <Field label="Name" span>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={60} placeholder="Travel" />
        </Field>
        <Field label="Limit applies">
          <Select value={f.limitPeriod} onChange={(e) => set("limitPeriod", e.target.value as LimitPeriod)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {perKm ? (
          <Field label="Rate per km (₹)">
            <Input inputMode="decimal" value={f.ratePerKm} onChange={(e) => set("ratePerKm", e.target.value.replace(/[^\d.]/g, ""))} placeholder="8" />
          </Field>
        ) : (
          <Field label="Limit (₹)" hint="Leave blank for no limit">
            <Input inputMode="decimal" value={f.limitAmount} onChange={(e) => set("limitAmount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="No limit" />
          </Field>
        )}
        <Field label="Approval chain">
          <Select value={f.approval} onChange={(e) => set("approval", e.target.value as ClaimApproval)}>
            <option value="manager">Manager</option>
            <option value="finance">Finance</option>
            <option value="manager_finance">Manager, then finance</option>
          </Select>
        </Field>
        <Field label="Receipt required above (₹)" hint="0 means always">
          <Input inputMode="decimal" value={f.receiptRequiredAbove} onChange={(e) => set("receiptRequiredAbove", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
      </div>
      <Checkbox checked={f.gstCapture} onChange={(v) => set("gstCapture", v)} label="Capture vendor GSTIN and GST amount" />
      <Checkbox checked={f.active} onChange={(v) => set("active", v)} label="Active (employees can claim under it)" />
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}
