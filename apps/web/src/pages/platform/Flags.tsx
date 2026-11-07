import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Plan } from "@/lib/types";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Flag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rollout: "all" | "plans" | "tenants" | "percent";
  plans: string[];
  tenantIds: string[];
  excludedTenantIds: string[];
  percent: number;
  tenantsOn: number;
  tenantsTotal: number;
  updatedAt: string;
}
interface FlagList {
  release: { version: string; name: string };
  known: Record<string, string>;
  flags: Flag[];
  tenants: { id: string; name: string; plan: string; status: string }[];
}

const scopeText = (f: Flag, names: Map<string, string>) => {
  const extra = f.excludedTenantIds.length ? ` · ${f.excludedTenantIds.length} excluded` : "";
  if (f.rollout === "all") return `All tenants${extra}`;
  if (f.rollout === "plans") return `Plans: ${f.plans.join(", ") || "none"}${f.tenantIds.length ? ` + ${f.tenantIds.length} tenant${f.tenantIds.length === 1 ? "" : "s"}` : ""}${extra}`;
  if (f.rollout === "tenants") return `${f.tenantIds.map((t) => names.get(t) ?? t).slice(0, 2).join(", ")}${f.tenantIds.length > 2 ? ` + ${f.tenantIds.length - 2}` : ""}${extra}`;
  return `${f.percent}% of tenants${f.tenantIds.length ? ` + ${f.tenantIds.length} named` : ""}${extra}`;
};

export default function Flags() {
  const { me } = useSession();
  const superAdmin = me?.platformRole === "super_admin";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "flags"], queryFn: () => api.get<FlagList>("/platform/flags") });
  const [edit, setEdit] = useState<Flag | "new" | null>(null);
  const toggle = useMutation({
    mutationFn: (f: Flag) => api.patch(`/platform/flags/${f.id}`, { enabled: !f.enabled }),
    onSuccess: (_r, f) => {
      toast.success(`${f.name} switched ${f.enabled ? "off" : "on"}`);
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  const names = useMemo(() => new Map((q.data?.tenants ?? []).map((t) => [t.id, t.name])), [q.data]);
  const columns = useMemo<ColumnDef<Flag, any>[]>(
    () => [
      { id: "name", header: "Feature", accessorFn: (f) => f.name, cell: ({ row: { original: f } }) => <div><div className="font-medium">{f.name}</div><div className="text-muted text-[12px]">{f.key}</div></div> },
      { id: "scope", header: "Scope", accessorFn: (f) => f.rollout, cell: ({ row: { original: f } }) => scopeText(f, names) },
      { id: "reach", header: "Tenants with it", accessorFn: (f) => f.tenantsOn, meta: { align: "right" }, cell: ({ row: { original: f } }) => `${f.tenantsOn} of ${f.tenantsTotal}` },
      { id: "state", header: "State", accessorFn: (f) => (f.enabled ? 1 : 0), cell: ({ row: { original: f } }) => (f.enabled ? <Tag tone="ok">On</Tag> : <Tag tone="bad">Off</Tag>) },
    ],
    [names],
  );
  return (
    <>
      <PageHeader
        title="Feature flags"
        sub={q.data ? `Current release: v${q.data.release.version} · ${q.data.release.name}` : "Switch features on or off by plan or tenant"}
        actions={
          superAdmin ? (
            <Button variant="primary" onClick={() => setEdit("new")}>
              <Plus size={16} /> New flag
            </Button>
          ) : null
        }
      />
      <Notice tone="sel">Module flags gate the API as well as the screens, so a tenant without a feature can't use it at all. Plan gates follow the pricing page: Starter has no TDS, claims or bank files. Changes apply within 30 seconds.</Notice>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable
          data={q.data?.flags ?? []}
          columns={columns}
          getRowId={(f) => f.id}
          loading={q.isFetching}
          columnToggle={false}
          onRowClick={superAdmin ? (f) => setEdit(f) : undefined}
          rowActions={superAdmin ? (f) => [{ label: "Edit rollout", onSelect: () => setEdit(f) }, { label: f.enabled ? "Switch off everywhere" : "Switch on", danger: f.enabled, onSelect: () => toggle.mutate(f) }] : undefined}
          empty="No flags yet"
        />
      </TableCard>
      <FlagDialog value={edit} data={q.data} onClose={() => setEdit(null)} />
    </>
  );
}

function FlagDialog({ value, data, onClose }: { value: Flag | "new" | null; data?: FlagList; onClose: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api.get<Plan[]>("/platform/billing/plans"), enabled: !!value });
  const existing = value && value !== "new" ? value : null;
  const blank = { key: "", name: "", description: "", enabled: true, rollout: "all" as Flag["rollout"], plans: [] as string[], tenantIds: [] as string[], excludedTenantIds: [] as string[], percent: "100" };
  const [f, setF] = useState(blank);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setSearch("");
    setF(existing ? { key: existing.key, name: existing.name, description: existing.description ?? "", enabled: existing.enabled, rollout: existing.rollout, plans: existing.plans, tenantIds: existing.tenantIds, excludedTenantIds: existing.excludedTenantIds, percent: String(existing.percent) } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const body = { name: f.name, description: f.description || null, enabled: f.enabled, rollout: f.rollout, plans: f.plans, tenantIds: f.tenantIds, excludedTenantIds: f.excludedTenantIds, percent: Number(f.percent || 0) };
      return existing ? api.patch(`/platform/flags/${existing.id}`, body) : api.post("/platform/flags", { ...body, key: f.key });
    },
    onSuccess: () => {
      toast.success("Flag saved");
      qc.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const toggleIn = (k: "plans" | "tenantIds" | "excludedTenantIds", id: string) => setF((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));
  const tenants = (data?.tenants ?? []).filter((t) => !search.trim() || t.name.toLowerCase().includes(search.toLowerCase()));
  const planKeys = ["trial", ...(plans.data ?? []).map((p) => p.key)];
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? existing.name : "New feature flag"}
      description={existing ? existing.key : "The app checks this key. Module keys gate whole modules."}
      width={620}
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
        {!existing ? (
          <Field label="Key" hint={data ? `Known: ${Object.keys(data.known).join(", ")}` : undefined}>
            <Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} placeholder="ess.mobile-punch-v2" />
          </Field>
        ) : null}
        <Field label="Name" span={!!existing}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Description" span>
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} />
        </Field>
        <Field label="Rollout">
          <Select value={f.rollout} onChange={(e) => setF({ ...f, rollout: e.target.value as Flag["rollout"] })}>
            <option value="all">All tenants</option>
            <option value="plans">By plan</option>
            <option value="tenants">Named tenants only</option>
            <option value="percent">Percentage of tenants</option>
          </Select>
        </Field>
        {f.rollout === "percent" ? (
          <Field label="Percentage" hint="Each tenant stays in the same bucket">
            <Input inputMode="numeric" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </Field>
        ) : null}
      </div>
      {f.rollout === "plans" ? (
        <div className="flex flex-wrap gap-3">
          {planKeys.map((p) => (
            <Checkbox key={p} checked={f.plans.includes(p)} onChange={() => toggleIn("plans", p)} label={<span className="capitalize">{p}</span>} />
          ))}
        </div>
      ) : null}
      <Field label={f.rollout === "tenants" ? "Tenants that get it" : "Always include or exclude tenants"}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tenants" />
      </Field>
      <div className="max-h-[200px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-divider)]">
        {tenants.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] px-3 py-1.5 text-[13px] last:border-b-0">
            <span>
              {t.name} <span className="text-muted capitalize">· {t.plan}</span>
            </span>
            <span className="flex gap-3">
              {f.rollout !== "all" ? <Checkbox checked={f.tenantIds.includes(t.id)} onChange={() => toggleIn("tenantIds", t.id)} label="Include" /> : null}
              <Checkbox checked={f.excludedTenantIds.includes(t.id)} onChange={() => toggleIn("excludedTenantIds", t.id)} label="Exclude" />
            </span>
          </div>
        ))}
      </div>
      <Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="On (switching off removes it from every tenant)" />
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Dialog>
  );
}
