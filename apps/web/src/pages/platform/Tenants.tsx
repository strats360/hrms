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
import { StatusTag } from "@/components/ui/tag";

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
                  { label: "Change plan", onSelect: () => setPlan(t) },
                  t.status === "suspended" ? { label: "Reactivate", onSelect: () => update.mutate({ id: t.id, status: "active" }) } : { label: "Suspend (blocks sign-in)", danger: true, onSelect: () => confirm(`Suspend ${t.name}? Their users won't be able to sign in.`) && update.mutate({ id: t.id, status: "suspended" }) },
                  ...(t.status === "past_due" || t.status === "trial" ? [{ label: "Mark as active (paid)", onSelect: () => update.mutate({ id: t.id, status: "active" }) }] : []),
                ]
              : []),
          ]}
        />
      </TableCard>
      <TenantDialog id={view} onClose={() => setView(null)} />
      <Dialog
        open={!!plan}
        onOpenChange={(v) => !v && setPlan(null)}
        title={`Change plan · ${plan?.name ?? ""}`}
        footer={
          <>
            <Button onClick={() => setPlan(null)}>Cancel</Button>
            <Button variant="primary" loading={update.isPending} onClick={() => plan && update.mutateAsync({ id: plan.id, plan: plan.plan }).then(() => setPlan(null))}>
              Save plan
            </Button>
          </>
        }
      >
        {plan ? (
          <Field label="Plan">
            <Select value={plan.plan} onChange={(e) => setPlan({ ...plan, plan: e.target.value })}>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </Field>
        ) : null}
      </Dialog>
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
          <div className="text-muted text-[12.5px]">Platform staff can't read a tenant's employee data from here. Support access to a tenant account is planned with the support tickets module, and every access will be logged.</div>
        </>
      )}
    </Dialog>
  );
}
