import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate } from "@hrms/shared";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Segmented, Select } from "@/components/ui/field";
import { KV, Loading, PageHeader } from "@/components/ui/page";
import type { Plan } from "@/lib/types";
import { StatusTag } from "@/components/ui/tag";
import { confirmAction } from "@/components/ui/confirm";

interface TenantRow {
  id: string;
  code: string;
  name: string;
  state: string | null;
  plan: string;
  status: string;
  gstin: string | null;
  trialEndsAt: string | null;
  setupCompletedAt: string | null;
  createdAt: string;
  employees: number;
}
interface TenantDetail extends TenantRow {
  legalName: string | null;
  contactEmail: string | null;
  admins: { name: string; email: string; role: string; status: string; lastActiveAt: string | null }[];
}

export default function Tenants() {
  const { me } = useSession();
  const superAdmin = me?.platformRole === "super_admin";
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [plan, setPlan] = useState<TenantRow | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({ queryKey: ["platform", "tenants", term, status], queryFn: () => api.get<TenantRow[]>(`/platform/tenants${qs({ q: term, status })}`) });
  const update = useMutation({
    mutationFn: (v: { id: string; status?: string; plan?: string }) => api.patch(`/platform/tenants/${v.id}`, v),
    onSuccess: () => {
      toast.success("Tenant updated");
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
  });

  const columns = useMemo<ColumnDef<TenantRow>[]>(
    () => [
      { id: "name", header: "Tenant", accessorKey: "name", cell: ({ row: { original: t } }) => <div><div className="font-medium">{t.name}</div><div className="text-muted text-[12px]">{t.code}{t.state ? ` · ${t.state}` : ""}</div></div> },
      { id: "plan", header: "Plan", accessorKey: "plan", cell: ({ getValue }) => <span className="capitalize">{getValue<string>()}</span> },
      { id: "employees", header: "Employees", accessorKey: "employees", meta: { align: "right" } },
      { id: "setup", header: "Setup", accessorFn: (t) => (t.setupCompletedAt ? 1 : 0), cell: ({ row }) => (row.original.setupCompletedAt ? "Live" : "In setup") },
      { id: "since", header: "Since", accessorKey: "createdAt", cell: ({ getValue }) => fmtDate(getValue<string>().slice(0, 10)) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <div className="flex flex-col items-start gap-0.5"><StatusTag status={row.original.status} />{row.original.status === "trial" && row.original.trialEndsAt ? <span className="text-muted text-[11px]">ends {fmtDate(row.original.trialEndsAt.slice(0, 10))}</span> : null}</div> },
    ],
    [],
  );

  return (
    <>
      <PageHeader title="Tenants" sub="Every company on the platform" />
      <div className="flex flex-wrap items-center gap-2.5">
        <Input className="!w-[280px]" placeholder="Search name, code or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tenants" />
        <Segmented value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "trial", label: "Trial" }, { value: "past_due", label: "Past due" }, { value: "suspended", label: "Suspended" }]} />
      </div>
      <TableCard>
        <DataTable
          data={list.data ?? []}
          loading={list.isLoading}
          columns={columns}
          getRowId={(t) => t.id}
          onRowClick={(t) => setView(t.id)}
          storageKey="platform-tenants"
          rowActions={(t) => [
            { label: "View details", onSelect: () => setView(t.id) },
            ...(superAdmin
              ? [
                  { label: "Plan & billing", onSelect: () => setPlan(t) },
                  t.status === "suspended" ? { label: "Reactivate", onSelect: () => update.mutate({ id: t.id, status: "active" }) } : { label: "Suspend (blocks sign-in)", danger: true, onSelect: () => void confirmAction({ title: `Suspend ${t.name}?`, body: "Their users won't be able to sign in until you reactivate the account.", confirmLabel: "Suspend", danger: true }).then((ok) => ok && update.mutate({ id: t.id, status: "suspended" })) },
                  ...(t.status === "past_due" || t.status === "trial" ? [{ label: "Mark as active (paid)", onSelect: () => update.mutate({ id: t.id, status: "active" }) }] : []),
                ]
              : []),
          ]}
        />
      </TableCard>
      <TenantDialog id={view} onClose={() => setView(null)} />
      <TenantBillingDialog tenant={plan} onClose={() => setPlan(null)} />
    </>
  );
}

function TenantDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["platform", "tenant", id], queryFn: () => api.get<TenantDetail>(`/platform/tenants/${id}`), enabled: !!id });
  const t = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={t?.name ?? "Tenant"} description={t ? `${t.code} · ${t.employees} active employees` : undefined} width={640}>
      {q.isLoading || !t ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <KV label="Legal name">{t.legalName}</KV>
            <KV label="GSTIN">{t.gstin}</KV>
            <KV label="State">{t.state}</KV>
            <KV label="Contact">{t.contactEmail}</KV>
            <KV label="Plan">
              <span className="capitalize">{t.plan}</span>
            </KV>
            <KV label="Status">
              <StatusTag status={t.status} />
            </KV>
          </div>
          <div className="card-title !mt-2 text-[15px]">Admin users</div>
          <table className="table">
            <tbody>
              {t.admins.map((a) => (
                <tr key={a.email}>
                  <td>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-muted text-[12px]">{a.email}</div>
                  </td>
                  <td>{a.role}</td>
                  <td>
                    <StatusTag status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-muted text-[12.5px]">Platform staff can't read a tenant's employee data from here. You can only view a customer's account from a customer ticket where they allowed it. Every visit is logged.</div>
        </>
      )}
    </Dialog>
  );
}

/** Plan, contract rate and billing contact for a tenant. */
function TenantBillingDialog({ tenant, onClose }: { tenant: TenantRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["platform", "plans"], queryFn: () => api.get<Plan[]>("/platform/billing/plans"), enabled: !!tenant });
  const detail = useQuery({ queryKey: ["platform", "tenant", tenant?.id], queryFn: () => api.get<TenantDetail & { customPrice: number | null; billingEmail: string | null; paymentMethod: string | null }>(`/platform/tenants/${tenant!.id}`), enabled: !!tenant });
  const [f, setF] = useState({ plan: "", customPrice: "", billingEmail: "", paymentMethod: "" });
  useEffect(() => {
    const d = detail.data;
    if (d) setF({ plan: d.plan, customPrice: d.customPrice === null ? "" : String(d.customPrice), billingEmail: d.billingEmail ?? "", paymentMethod: d.paymentMethod ?? "" });
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => api.patch(`/platform/billing/tenants/${tenant!.id}`, { plan: f.plan, customPrice: f.customPrice === "" ? null : Number(f.customPrice), billingEmail: f.billingEmail.trim() || null, paymentMethod: f.paymentMethod.trim() || null }),
    onSuccess: () => {
      toast.success("Billing updated. It applies from the next billing run.");
      qc.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
  });
  const chosen = plans.data?.find((p) => p.key === f.plan);
  return (
    <Dialog
      open={!!tenant}
      onOpenChange={(v) => !v && onClose()}
      title={`Plan & billing · ${tenant?.name ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!detail.data} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {!detail.data ? <Loading /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan">
            <Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
              <option value="trial">Trial</option>
              {(plans.data ?? []).filter((p) => p.active || p.key === f.plan).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                  {p.pricePerEmployee !== null ? ` · ₹${p.pricePerEmployee}` : " · custom"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contract rate per employee (₹)" hint={chosen?.pricePerEmployee !== null && chosen ? `Blank uses the plan price (₹${chosen.pricePerEmployee})` : "Required for custom-priced plans"}>
            <Input inputMode="decimal" value={f.customPrice} onChange={(e) => setF({ ...f, customPrice: e.target.value.replace(/[^\d.]/g, "") })} />
          </Field>
          <Field label="Billing email" hint="Blank uses the company contact email">
            <Input type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} />
          </Field>
          <Field label="Payment method (shown to the tenant)">
            <Input value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} placeholder="UPI autopay · company@hdfcbank" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
