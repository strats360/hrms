import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { inr } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Plan } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

export default function Plans() {
  const { me } = useSession();
  const superAdmin = me?.platformRole === "super_admin";
  const q = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api.get<Plan[]>("/platform/billing/plans") });
  const [edit, setEdit] = useState<Plan | "new" | null>(null);
  return (
    <>
      <PageHeader
        title="Plans & pricing"
        sub="Per employee per month, before 18% GST. Tenants are billed on active employees, at least the plan minimum."
        actions={
          superAdmin ? (
            <Button variant="primary" onClick={() => setEdit("new")}>
              <Plus size={16} /> Add plan
            </Button>
          ) : null
        }
      />
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))" }}>
        {(q.data ?? []).map((p) => (
          <Card key={p.id} className="!gap-2" style={{ padding: 22, opacity: p.active ? 1 : 0.6 }}>
            <div className="flex items-center justify-between">
              <div className="card-kicker">{p.name}</div>
              {!p.active ? <Tag>Inactive</Tag> : <Tag tone="accent">{p.tenants ?? 0} tenants</Tag>}
            </div>
            <div className="text-[30px] font-medium leading-tight">{p.pricePerEmployee === null ? "Custom" : inr(p.pricePerEmployee)}</div>
            <div className="text-muted text-[13px]">{p.description}</div>
            <div className="text-muted text-[12.5px]">
              Minimum {p.minSeats} seats{p.maxEmployees ? ` · up to ${p.maxEmployees.toLocaleString("en-IN")} employees` : ""}
              {p.includedAdmins ? ` · ${p.includedAdmins} admins` : ""}
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check size={15} style={{ color: "var(--ok)", marginTop: 2, flex: "none" }} /> {f}
                </li>
              ))}
            </ul>
            {superAdmin ? (
              <Button className="mt-auto self-start" onClick={() => setEdit(p)}>
                Edit plan
              </Button>
            ) : null}
          </Card>
        ))}
      </div>
      <Notice tone="sel">Enterprise has no list price. Set a negotiated rate on the tenant (Tenants › Billing), and it's used on their invoices.</Notice>
      <PlanDialog value={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PlanDialog({ value, onClose }: { value: Plan | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = value && value !== "new" ? value : null;
  const blank = { key: "", name: "", price: "", minSeats: "0", maxEmployees: "", includedAdmins: "", description: "", features: "", active: true, sortOrder: "5" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setF(existing ? { key: existing.key, name: existing.name, price: existing.pricePerEmployee === null ? "" : String(existing.pricePerEmployee), minSeats: String(existing.minSeats), maxEmployees: existing.maxEmployees ? String(existing.maxEmployees) : "", includedAdmins: existing.includedAdmins ? String(existing.includedAdmins) : "", description: existing.description ?? "", features: existing.features.join("\n"), active: existing.active, sortOrder: String(existing.sortOrder) } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const body = {
        name: f.name,
        pricePerEmployee: f.price === "" ? null : Number(f.price),
        minSeats: Number(f.minSeats || 0),
        maxEmployees: f.maxEmployees ? Number(f.maxEmployees) : null,
        includedAdmins: f.includedAdmins ? Number(f.includedAdmins) : null,
        description: f.description || null,
        features: f.features.split("\n").map((x) => x.trim()).filter(Boolean),
        active: f.active,
        sortOrder: Number(f.sortOrder || 0),
      };
      return existing ? api.patch(`/platform/billing/plans/${existing.id}`, body) : api.post("/platform/billing/plans", { ...body, key: f.key });
    },
    onSuccess: () => {
      toast.success(existing ? "Plan updated. New invoices use it from the next billing run." : "Plan added");
      qc.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? `Edit ${existing.name}` : "Add plan"}
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
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={40} />
        </Field>
        <Field label="Key" hint={existing ? "Can't change: tenants reference it" : "Lowercase, e.g. growth"}>
          <Input value={f.key} disabled={!!existing} onChange={(e) => set("key", e.target.value.toLowerCase())} maxLength={30} />
        </Field>
        <Field label="Price per employee (₹)" hint="Leave blank for custom pricing">
          <Input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label="Minimum seats">
          <Input inputMode="numeric" value={f.minSeats} onChange={(e) => set("minSeats", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Maximum employees">
          <Input inputMode="numeric" value={f.maxEmployees} onChange={(e) => set("maxEmployees", e.target.value.replace(/\D/g, ""))} placeholder="No limit" />
        </Field>
        <Field label="Admin users included">
          <Input inputMode="numeric" value={f.includedAdmins} onChange={(e) => set("includedAdmins", e.target.value.replace(/\D/g, ""))} placeholder="Unlimited" />
        </Field>
        <Field label="Short description" span>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Features (one per line)" span>
          <Textarea rows={4} value={f.features} onChange={(e) => set("features", e.target.value)} />
        </Field>
      </div>
      <Checkbox checked={f.active} onChange={(v) => set("active", v)} label="Active (can be assigned to tenants)" />
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}
