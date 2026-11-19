import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { COUNTRIES, fmtDate, hasPackFor, INDIAN_STATES, legalEntitySchema, packFor, type CountryCode, type CountryInfo } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { confirmAction } from "@/components/ui/confirm";

interface Entity {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  country: CountryCode;
  countryName: string;
  currency: string;
  timeZone: string;
  state: string | null;
  address: string | null;
  registrations: Record<string, string | null>;
  isDefault: boolean;
  employees: number;
  emiratisation: {
    nationals: number;
    applies: boolean;
    share: number;
    current: { by: string; share: number; shortfall: number } | null;
    next: { by: string; share: number; shortfall: number };
  } | null;
}
type Draft = Partial<Entity> & { country: CountryCode };

export default function Entities() {
  const { can } = useSession();
  const editable = can("settings", "configure");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["org", "entities"], queryFn: () => api.get<{ entities: Entity[]; countries: CountryInfo[] }>("/admin/org/entities") });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org"] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const parsed = legalEntitySchema.safeParse({ ...d, registrations: d.registrations ?? {} });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return d.id ? api.patch(`/admin/org/entities/${d.id}`, parsed.data) : api.post("/admin/org/entities", parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Legal entity saved");
      setEdit(null);
      invalidate();
    },
    onError: (e) => setErr(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/org/entities/${id}`),
    onSuccess: () => {
      toast.success("Legal entity removed");
      invalidate();
    },
  });

  const countries = q.data?.countries ?? [];
  const open = (d: Draft) => {
    setErr(null);
    setEdit(d);
  };
  const info = edit ? COUNTRIES[edit.country] : null;
  // the country pack says which registration numbers the entity needs
  const pack = edit && hasPackFor(edit.country) ? packFor(edit.country) : null;
  const fields = pack?.entityRegistrations ?? [];
  const uae = (q.data?.entities ?? []).filter((e) => e.emiratisation);
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  return (
    <>
      <TableCard>
        <CardHeader
          className="py-2"
          title="Legal entities"
          sub="Each company you employ people through. Its country decides payroll, tax and compliance rules."
          actions={editable ? <Button variant="primary" onClick={() => open({ country: countries[0]?.code ?? "IN", name: "", registrations: {} })}><Plus size={16} /> Add entity</Button> : null}
        />
        {q.isLoading ? (
          <Loading />
        ) : (
          <div className="scroll-thin min-w-0 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Country</th>
                  <th>Currency</th>
                  <th>Time zone</th>
                  <th className="text-end">Employees</th>
                  {editable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {q.data?.entities.map((e) => (
                  <tr key={e.id}>
                    <td className="min-w-[220px]">
                      <div className="font-semibold">
                        {e.name} {e.isDefault ? <Tag tone="accent" className="ms-1">Default</Tag> : null}
                      </div>
                      <div className="text-muted text-[12px]">{[e.code, e.legalName && e.legalName !== e.name ? e.legalName : null].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>{e.countryName}</td>
                    <td>{e.currency}</td>
                    <td className="text-muted text-[12.5px]">{e.timeZone}</td>
                    <td className="num text-end">{e.employees}</td>
                    {editable ? (
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button icon size="sm" variant="ghost" aria-label={`Edit ${e.name}`} onClick={() => open({ ...e })}>
                            <Pencil size={14} />
                          </Button>
                          {!e.isDefault ? (
                            <Button icon size="sm" variant="ghost" aria-label={`Remove ${e.name}`} onClick={() => void confirmAction({ title: `Remove ${e.name}?`, body: "You can only remove an entity with no employees, including people who have left.", confirmLabel: "Remove", danger: true }).then((ok) => ok && del.mutate(e.id))}>
                              <Trash2 size={14} />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
      {uae.map((e) => {
        const m = e.emiratisation!;
        return (
          <Notice key={e.id} tone={m.applies && (m.current?.shortfall ?? 0) > 0 ? "bad" : "sel"}>
            <strong>Emiratisation at {e.name}:</strong> {m.nationals} UAE national{m.nationals === 1 ? "" : "s"} out of {e.employees} ({pct(m.share)}).{" "}
            {!m.applies
              ? "The target applies once you have 50 employees."
              : m.current && m.current.shortfall > 0
                ? `You're ${m.current.shortfall} short of the ${pct(m.current.share)} target that was due by ${fmtDate(m.current.by)}. `
                : ""}
            {m.applies ? (m.next.shortfall > 0 ? `To reach ${pct(m.next.share)} by ${fmtDate(m.next.by)}, you need ${m.next.shortfall} more.` : `You already meet the ${pct(m.next.share)} target due by ${fmtDate(m.next.by)}.`) : null}{" "}
            Mark nationals with their nationality on the employee record.
          </Notice>
        );
      })}
      <Notice tone="sel">
        {countries.length > 1 ? `This site supports ${countries.map((c) => c.name).join(", ")}.` : `This site supports ${countries[0]?.name ?? "India"}.`} Saudi Arabia, Qatar, Kuwait, Oman, Bahrain, the UK, the USA and Canada will show up as their payroll and compliance rules are ready.
      </Notice>

      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit?.id ? "Edit legal entity" : "Add legal entity"}
        description={edit?.isDefault ? "This is your default entity. Its details are the same as your company profile, so changes here show there too." : undefined}
        width={620}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => edit && save.mutate(edit)}>
              Save entity
            </Button>
          </>
        }
      >
        {err ? <Notice tone="bad">{err}</Notice> : null}
        {pack?.review?.status === "pending" ? <Notice tone="sel">{pack.review.note}</Notice> : null}
        {edit && info ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Legal name">
              <Input value={edit.legalName ?? ""} onChange={(e) => setEdit({ ...edit, legalName: e.target.value })} placeholder="As registered" />
            </Field>
            <Field label="Country" hint={edit.id && edit.employees ? "Can't change while the entity has employees" : undefined}>
              <Select value={edit.country} disabled={!!(edit.id && edit.employees)} onChange={(e) => { const c = e.target.value as CountryCode; setEdit({ ...edit, country: c, timeZone: COUNTRIES[c].timeZone, currency: COUNTRIES[c].currency, registrations: {} }); }}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Time zone">
              <Select value={edit.timeZone ?? info.timeZone} onChange={(e) => setEdit({ ...edit, timeZone: e.target.value })} disabled={info.timeZones.length === 1}>
                {info.timeZones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </Select>
            </Field>
            {edit.country === "IN" ? (
              <Field label="State">
                <Select value={edit.state ?? ""} onChange={(e) => setEdit({ ...edit, state: e.target.value })}>
                  <option value="">Select</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            ) : pack?.regions ? (
              <Field label={pack.regions.label}>
                <Select value={edit.state ?? ""} onChange={(e) => setEdit({ ...edit, state: e.target.value })}>
                  <option value="">Select</option>
                  {pack.regions.list.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Currency" hint="Set by the country">
              <Input value={edit.currency ?? info.currency} readOnly />
            </Field>
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input value={edit.registrations?.[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, registrations: { ...edit.registrations, [f.key]: e.target.value.toUpperCase() || null } })} />
              </Field>
            ))}
            <Field label="Registered address" span>
              <Textarea rows={2} value={edit.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            {edit.id && !q.data?.entities.find((x) => x.id === edit.id)?.isDefault ? (
              <Checkbox checked={!!edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label="Make this the default entity for new employees" />
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
