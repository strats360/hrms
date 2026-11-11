import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, CONDITION_LABEL, CONDITIONS, todayIST, type AssetCategory, type AssetStatus, type Condition } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Tag, type Tone } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";

export interface Asset {
  id: string;
  tag: string;
  name: string;
  category: AssetCategory;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  vendor: string | null;
  invoiceNumber: string | null;
  warrantyUntil: string | null;
  branchId: string | null;
  status: AssetStatus;
  condition: Condition;
  notes: string | null;
  holderId: string | null;
  warranty: "expired" | "ending" | "ok" | null;
}
export const STATUS_TONE: Record<AssetStatus, Tone> = { available: "ok", assigned: "accent", in_repair: "warn", retired: "outline", lost: "bad" };
export const AssetStatusTag = ({ s }: { s: AssetStatus }) => <Tag tone={STATUS_TONE[s]}>{ASSET_STATUS_LABEL[s]}</Tag>;

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export function AssetDialog({ asset, onClose, onSaved }: { asset?: Asset; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const [f, setF] = useState({ tag: asset?.tag ?? "", name: asset?.name ?? "", category: (asset?.category ?? "laptop") as AssetCategory, serialNumber: asset?.serialNumber ?? "", purchaseDate: asset?.purchaseDate ?? "", purchaseCost: asset?.purchaseCost != null ? String(asset.purchaseCost) : "", vendor: asset?.vendor ?? "", invoiceNumber: asset?.invoiceNumber ?? "", warrantyUntil: asset?.warrantyUntil ?? "", branchId: asset?.branchId ?? "", condition: (asset?.condition ?? "new") as Condition, notes: asset?.notes ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, serialNumber: f.serialNumber || null, purchaseDate: f.purchaseDate || null, purchaseCost: num(f.purchaseCost), vendor: f.vendor || null, invoiceNumber: f.invoiceNumber || null, warrantyUntil: f.warrantyUntil || null, branchId: f.branchId || null };
      return asset ? api.put<Asset>(`/admin/assets/${asset.id}`, body) : api.post<Asset>("/admin/assets", body);
    },
    onSuccess: (a) => (toast.success(asset ? "Saved" : `${a.tag} added`), qc.invalidateQueries({ queryKey: ["assets"] }), onClose(), onSaved?.(a.id)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={asset ? `Edit ${asset.tag}` : "Add an asset"} width={680} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={f.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>{asset ? "Save" : "Add asset"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" span><Input value={f.name} onChange={set("name")} placeholder="e.g. Dell Latitude 5440" /></Field>
        <Field label="Category"><Select value={f.category} onChange={set("category")}>{ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>)}</Select></Field>
        <Field label="Asset tag" hint={asset ? undefined : "Leave empty to number it automatically"}><Input value={f.tag} onChange={set("tag")} placeholder="AST-0001" /></Field>
        <Field label="Serial number"><Input value={f.serialNumber} onChange={set("serialNumber")} /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={set("condition")}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</Select></Field>
        <Field label="Purchase date"><Input type="date" value={f.purchaseDate} onChange={set("purchaseDate")} /></Field>
        <Field label="Cost (₹)"><Input type="number" min={0} value={f.purchaseCost} onChange={set("purchaseCost")} /></Field>
        <Field label="Vendor"><Input value={f.vendor} onChange={set("vendor")} /></Field>
        <Field label="Invoice number"><Input value={f.invoiceNumber} onChange={set("invoiceNumber")} /></Field>
        <Field label="Warranty until"><Input type="date" value={f.warrantyUntil} onChange={set("warrantyUntil")} /></Field>
        <Field label="Branch"><Select value={f.branchId} onChange={set("branchId")}><option value="">—</option>{L.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Notes" span><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Dialog>
  );
}

export function AssignDialog({ asset, onClose }: { asset: Pick<Asset, "id" | "tag" | "name" | "condition">; onClose: () => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const [find, setFind] = useState("");
  const [f, setF] = useState({ employeeId: "", date: todayIST(), condition: asset.condition, expectedReturn: "", note: "" });
  const people = (L.data?.employees ?? []).filter((e) => find.trim().length >= 2 && `${e.name} ${e.code}`.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 8);
  const chosen = L.data?.employees.find((e) => e.id === f.employeeId);
  const save = useMutation({
    mutationFn: () => api.post(`/admin/assets/${asset.id}/assign`, { ...f, expectedReturn: f.expectedReturn || null }),
    onSuccess: () => (toast.success(`${asset.tag} given to ${chosen?.name}. They've been asked to confirm.`), qc.invalidateQueries({ queryKey: ["assets"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Give ${asset.name} to someone`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.employeeId} loading={save.isPending} onClick={() => save.mutate()}>Assign</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee" span>
          {chosen ? (
            <div className="flex items-center justify-between gap-2 text-[13.5px]"><span>{chosen.name} ({chosen.code})</span><Button size="sm" variant="ghost" onClick={() => setF({ ...f, employeeId: "" })}>Change</Button></div>
          ) : (
            <div className="flex flex-col gap-1">
              <Input aria-label="Find an employee" placeholder="Type a name or employee ID" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
              {people.map((p) => <button key={p.id} type="button" className="rounded px-2 py-1.5 text-left text-[13.5px] hover:bg-[var(--tint-1)]" onClick={() => setF({ ...f, employeeId: p.id })}>{p.name} <span className="text-muted">({p.code})</span></button>)}
            </div>
          )}
        </Field>
        <Field label="Given on"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Condition })}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</Select></Field>
        <Field label="Due back (optional)" hint="For loans, e.g. a projector"><Input type="date" value={f.expectedReturn} onChange={(e) => setF({ ...f, expectedReturn: e.target.value })} /></Field>
        <Field label="Note (optional)" hint="e.g. With charger and bag"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export function ReturnDialog({ asset, holder, onClose }: { asset: Pick<Asset, "id" | "tag" | "name" | "condition">; holder: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ date: todayIST(), condition: asset.condition, status: "available" as "available" | "in_repair" | "retired" | "lost", note: "" });
  const save = useMutation({
    mutationFn: () => api.post(`/admin/assets/${asset.id}/return`, f),
    onSuccess: () => (toast.success(`${asset.tag} returned`), qc.invalidateQueries({ queryKey: ["assets"] }), qc.invalidateQueries({ queryKey: ["exit"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Take ${asset.name} back from ${holder}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record return</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Returned on"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Condition })}>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}</Select></Field>
        <Field label="Then it's" span>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
            <option value="available">Available to give out</option>
            <option value="in_repair">Going for repair</option>
            <option value="retired">Retired</option>
            <option value="lost">Lost (not actually returned)</option>
          </Select>
        </Field>
        <Field label="Note (optional)" span><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}
