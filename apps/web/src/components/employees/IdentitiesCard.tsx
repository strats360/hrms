import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { COUNTRIES, COUNTRY_CODES, fmtDate, identitySchema } from "@hrms/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { confirmAction } from "@/components/ui/confirm";

export interface Identity {
  id: string;
  type: string;
  name: string | null;
  label: string;
  number: string;
  issuingCountry: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  note: string | null;
  state: "expired" | "due" | "ok" | "none";
  daysLeft: number | null;
}
interface View {
  identities: Identity[];
  types: { key: string; label: string; expires: boolean }[];
}
type Draft = Partial<Identity> & { type: string };

export function ExpiryTag({ i }: { i: Pick<Identity, "state" | "daysLeft"> }) {
  if (i.state === "none" || i.daysLeft === null) return null;
  if (i.state === "expired") return <Tag tone="bad">Expired {-i.daysLeft} day{i.daysLeft === -1 ? "" : "s"} ago</Tag>;
  if (i.state === "due") return <Tag tone="warn">{i.daysLeft === 0 ? "Expires today" : `Expires in ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"}`}</Tag>;
  return <span className="text-muted text-[12.5px]">In {i.daysLeft} days</span>;
}

/**
 * Passports, visas, Emirates ID, Iqama and other IDs with their expiry dates.
 * `employeeId` set: HR view (editable when `editable`). Not set: your own, read only.
 */
export function IdentitiesCard({ employeeId, editable }: { employeeId?: string; editable?: boolean }) {
  const qc = useQueryClient();
  const key = ["identities", employeeId ?? "me"];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<View>(employeeId ? `/admin/employees/${employeeId}/identities` : "/ess/identities") });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const parsed = identitySchema.safeParse(d);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return d.id ? api.patch(`/admin/employees/identities/${d.id}`, parsed.data) : api.post(`/admin/employees/${employeeId}/identities`, parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Saved");
      setEdit(null);
      refresh();
    },
    onError: (e) => setErr(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/employees/identities/${id}`),
    onSuccess: () => {
      toast.success("Removed");
      refresh();
    },
  });

  if (q.isLoading) return <Loading />;
  const list = q.data?.identities ?? [];
  const types = q.data?.types ?? [];
  const expires = edit ? (types.find((t) => t.key === edit.type)?.expires ?? true) : true;
  const open = (d: Draft) => {
    setErr(null);
    setEdit(d);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-[13px]">
          {employeeId ? "Passports, visas and permits. HR and the employee get a reminder before each one expires." : "Your passport, visa and permits on file. HR keeps these up to date, and you'll get a reminder before one expires."}
        </p>
        {editable ? (
          <Button variant="primary" size="sm" onClick={() => open({ type: types[0]?.key ?? "passport" })}>
            <Plus size={15} /> Add ID
          </Button>
        ) : null}
      </div>
      {list.length === 0 ? <div className="text-muted py-2 text-[13px]">No IDs on file yet.</div> : null}
      {list.map((i) => (
        <div key={i.id} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {i.label} <ExpiryTag i={i} />
            </div>
            <div className="text-muted text-[12.5px]">
              {[i.number, i.issuingCountry ? (COUNTRIES[i.issuingCountry as keyof typeof COUNTRIES]?.name ?? i.issuingCountry) : null, i.expiresOn ? `expires ${fmtDate(i.expiresOn)}` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          {editable ? (
            <div className="flex gap-1">
              <Button icon size="sm" variant="ghost" aria-label={`Edit ${i.label}`} onClick={() => open({ ...i })}>
                <Pencil size={14} />
              </Button>
              <Button icon size="sm" variant="ghost" aria-label={`Remove ${i.label}`} onClick={() => void confirmAction({ title: `Remove this ${i.label.toLowerCase()}?`, body: "Its number and dates will be deleted.", confirmLabel: "Remove", danger: true }).then((ok) => ok && del.mutate(i.id))}>
                <Trash2 size={14} />
              </Button>
            </div>
          ) : null}
        </div>
      ))}

      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit?.id ? `Edit ${edit.label?.toLowerCase() ?? "ID"}` : "Add ID"}
        width={560}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Save
            </Button>
          </>
        }
      >
        {err ? <Notice tone="bad">{err}</Notice> : null}
        {edit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {types.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </Select>
            </Field>
            {edit.type === "other" ? (
              <Field label="What is it">
                <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Medical insurance card" />
              </Field>
            ) : null}
            <Field label="Number">
              <Input value={edit.number ?? ""} onChange={(e) => setEdit({ ...edit, number: e.target.value })} autoFocus />
            </Field>
            <Field label="Issued by">
              <Select value={edit.issuingCountry ?? ""} onChange={(e) => setEdit({ ...edit, issuingCountry: e.target.value || null })}>
                <option value="">Not set</option>
                {COUNTRY_CODES.map((c) => (
                  <option key={c} value={c}>{COUNTRIES[c].name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Issued on">
              <Input type="date" value={edit.issuedOn ?? ""} onChange={(e) => setEdit({ ...edit, issuedOn: e.target.value || null })} />
            </Field>
            {expires ? (
              <Field label="Expires on">
                <Input type="date" value={edit.expiresOn ?? ""} onChange={(e) => setEdit({ ...edit, expiresOn: e.target.value || null })} />
              </Field>
            ) : null}
            <Field label="Note" span>
              <Textarea rows={2} value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Optional, e.g. visa sponsored by the company" />
            </Field>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
