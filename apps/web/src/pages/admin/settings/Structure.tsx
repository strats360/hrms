import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { branchSchema, INDIAN_STATES } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Branch {
  id: string;
  name: string;
  code: string | null;
  state: string;
  city: string | null;
  address: string | null;
  isHeadOffice: boolean;
  esiSubCode: string | null;
  ptRegistration: string | null;
}
interface Named {
  id: string;
  name: string;
  code?: string | null;
  grade?: string | null;
}

const EMPTY: Omit<Branch, "id"> = { name: "", code: "", state: "Gujarat", city: "", address: "", isHeadOffice: false, esiSubCode: "", ptRegistration: "" };

export default function Structure() {
  const { can } = useSession();
  const editable = can("settings", "edit");
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/admin/org/branches") });
  const [edit, setEdit] = useState<Partial<Branch> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org"] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  const saveBranch = useMutation({
    mutationFn: async (b: Partial<Branch>) => {
      const parsed = branchSchema.safeParse(b);
      if (!parsed.success) {
        setErr(parsed.error.issues[0]?.message ?? "Check the form");
        throw new Error(parsed.error.issues[0]?.message);
      }
      return b.id ? api.patch(`/admin/org/branches/${b.id}`, parsed.data) : api.post("/admin/org/branches", parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Branch saved");
      setEdit(null);
      invalidate();
    },
    onError: (e) => setErr(e.message),
  });
  const delBranch = useMutation({
    mutationFn: (id: string) => api.del(`/admin/org/branches/${id}`),
    onSuccess: () => {
      toast.success("Branch deleted");
      invalidate();
    },
  });

  return (
    <>
      <TableCard>
        <CardHeader className="py-2" title="Branches" sub="Work locations. The state drives Professional Tax and LWF rules." actions={editable ? <Button variant="primary" onClick={() => { setErr(null); setEdit({ ...EMPTY }); }}><Plus size={16} /> Add branch</Button> : null} />
        {branches.isLoading ? (
          <Loading />
        ) : (
          <div className="scroll-thin min-w-0 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Address</th>
                  <th>State</th>
                  <th>ESI sub-code</th>
                  <th>PT registration</th>
                  {editable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {branches.data?.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap font-semibold">
                      {b.name} {b.isHeadOffice ? <Tag tone="accent" className="ml-1">Head office</Tag> : null}
                    </td>
                    <td className="min-w-[220px]">{[b.address, b.city].filter(Boolean).join(", ") || "—"}</td>
                    <td>{b.state}</td>
                    <td className="text-muted text-[12.5px]">{b.esiSubCode || "—"}</td>
                    <td className="text-muted text-[12.5px]">{b.ptRegistration || "—"}</td>
                    {editable ? (
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button icon size="sm" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => { setErr(null); setEdit(b); }}>
                            <Pencil size={14} />
                          </Button>
                          <Button icon size="sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => confirm(`Delete ${b.name}?`) && delBranch.mutate(b.id)}>
                            <Trash2 size={14} />
                          </Button>
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

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
        <MasterList path="departments" title="Departments" extra="code" extraLabel="Code" editable={editable} />
        <MasterList path="designations" title="Designations" extra="grade" extraLabel="Grade" editable={editable} />
      </div>

      <Dialog
        open={!!edit}
        onOpenChange={(v) => !v && setEdit(null)}
        title={edit?.id ? "Edit branch" : "Add branch"}
        width={600}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={saveBranch.isPending} onClick={() => edit && saveBranch.mutate(edit)}>
              Save branch
            </Button>
          </>
        }
      >
        {err ? <div className="text-[13px]" style={{ color: "var(--bad)" }}>{err}</div> : null}
        {edit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch name">
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Code">
              <Input value={edit.code ?? ""} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
            </Field>
            <Field label="State">
              <Select value={edit.state ?? ""} onChange={(e) => setEdit({ ...edit, state: e.target.value })}>
                {INDIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="City">
              <Input value={edit.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
            </Field>
            <Field label="Address" span>
              <Input value={edit.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="ESI sub-code">
              <Input value={edit.esiSubCode ?? ""} onChange={(e) => setEdit({ ...edit, esiSubCode: e.target.value })} />
            </Field>
            <Field label="PT registration">
              <Input value={edit.ptRegistration ?? ""} onChange={(e) => setEdit({ ...edit, ptRegistration: e.target.value })} />
            </Field>
            <Checkbox label="This is the head office" checked={!!edit.isHeadOffice} onChange={(v) => setEdit({ ...edit, isHeadOffice: v })} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function MasterList({ path, title, extra, extraLabel, editable }: { path: "departments" | "designations"; title: string; extra: "code" | "grade"; extraLabel: string; editable: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["org", path], queryFn: () => api.get<Named[]>(`/admin/org/${path}`) });
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<Named | null>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["org", path] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  const add = useMutation({
    mutationFn: () => api.post(`/admin/org/${path}`, { name: name.trim() }),
    onSuccess: () => {
      setName("");
      done();
    },
  });
  const save = useMutation({
    mutationFn: (n: Named) => api.patch(`/admin/org/${path}/${n.id}`, { name: n.name, [extra]: n[extra] || null }),
    onSuccess: () => {
      setRenaming(null);
      done();
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/admin/org/${path}/${id}`), onSuccess: done });
  const rows = [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <TableCard className="!gap-2">
      <CardHeader className="py-2" title={title} sub={`${rows.length} total`} />
      {editable ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${title.toLowerCase().slice(0, -1)}`} aria-label={`New ${title}`} />
          <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
            Add
          </Button>
        </form>
      ) : null}
      <div className="scroll-thin max-h-[420px] overflow-y-auto">
        <table className="table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {renaming?.id === r.id ? (
                  <td colSpan={3}>
                    <div className="flex gap-2">
                      <Input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="Name" />
                      <Input className="!w-24" value={renaming[extra] ?? ""} placeholder={extraLabel} onChange={(e) => setRenaming({ ...renaming, [extra]: e.target.value })} aria-label={extraLabel} />
                      <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(renaming)}>
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-muted text-[12.5px]">{r[extra] ?? ""}</td>
                    <td>
                      {editable ? (
                        <div className="flex justify-end gap-1">
                          <Button icon size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setRenaming(r)}>
                            <Pencil size={14} />
                          </Button>
                          <Button icon size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete ${r.name}?`) && del.mutate(r.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  );
}
