import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ACTION_LABELS, ACTIONS, inviteAdminSchema, MODULE_LABELS, MODULES, type Action, type Module, type PermissionMatrix } from "@hrms/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard, Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Loading, Notice } from "@/components/ui/page";
import { StatusTag, Tag } from "@/components/ui/tag";
import { Menu } from "@/components/ui/menu";

interface Role {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionMatrix;
  members: number;
}
interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  scope: string | null;
  status: string;
  lastActiveAt: string | null;
  employeeCode: string | null;
}
interface Invite {
  id: string;
  name: string;
  email: string;
  roleName: string | null;
  scope: string | null;
  expiresAt: string;
}

function ago(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `Today ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (mins < 60 * 48) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function Access() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["access", "roles"], queryFn: () => api.get<Role[]>("/admin/access/roles") });
  const members = useQuery({ queryKey: ["access", "members"], queryFn: () => api.get<{ members: Member[]; invites: Invite[] }>("/admin/access/members") });
  const [inviteOpen, setInviteOpen] = useState(false);
  const canEdit = can("users", "edit");
  const done = () => qc.invalidateQueries({ queryKey: ["access"] });

  const update = useMutation({
    mutationFn: (v: { id: string; roleId?: string | null; status?: string }) => api.patch(`/admin/access/members/${v.id}`, v),
    onSuccess: () => {
      toast.success("Access updated");
      done();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/admin/access/invites/${id}`),
    onSuccess: () => {
      toast.success("Invite revoked");
      done();
    },
  });

  if (roles.isLoading || members.isLoading) return <Loading />;
  const roleList = roles.data ?? [];

  return (
    <>
      <TableCard>
        <CardHeader
          className="py-2"
          title="Admin panel users"
          sub="Who can sign in to the admin console, and as what role. Employees use the self-service portal."
          actions={canEdit ? <Button variant="primary" onClick={() => setInviteOpen(true)}><Plus size={16} /> Invite user</Button> : null}
        />
        <div className="scroll-thin min-w-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Last active</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data?.members.map((m) => {
                const self = m.userId === me?.user.id;
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-muted text-[12px]">{m.email}</div>
                    </td>
                    <td>
                      <Select
                        className="!min-h-[30px] !w-[170px] !py-0.5 text-[13px]"
                        value={m.roleId ?? ""}
                        disabled={!canEdit || self}
                        onChange={(e) => update.mutate({ id: m.id, roleId: e.target.value })}
                        aria-label={`Role for ${m.name}`}
                      >
                        {roleList.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="text-muted">{m.scope || "All branches"}</td>
                    <td className="whitespace-nowrap">{ago(m.lastActiveAt)}</td>
                    <td>
                      <StatusTag status={m.status} />
                    </td>
                    <td>
                      {canEdit && !self ? (
                        <Menu
                          trigger={<Button size="sm">Manage</Button>}
                          items={[
                            m.status === "active" ? { label: "Disable sign-in", onSelect: () => update.mutate({ id: m.id, status: "disabled" }), danger: true } : { label: "Enable sign-in", onSelect: () => update.mutate({ id: m.id, status: "active" }) },
                            { label: m.employeeCode ? "Remove admin access (keeps self-service)" : "Remove admin access", onSelect: () => update.mutate({ id: m.id, roleId: null }), danger: true },
                          ]}
                        />
                      ) : self ? (
                        <span className="text-muted text-[12px]">You</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {members.data?.invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-muted text-[12px]">{i.email}</div>
                  </td>
                  <td>{i.roleName}</td>
                  <td className="text-muted">{i.scope || "All branches"}</td>
                  <td className="whitespace-nowrap">Invite sent</td>
                  <td>
                    <Tag tone={new Date(i.expiresAt) < new Date() ? "bad" : "neutral"}>{new Date(i.expiresAt) < new Date() ? "Expired" : "Invited"}</Tag>
                  </td>
                  <td>{canEdit ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>

      <PermissionMatrixCard roles={roleList} editable={can("users", "configure")} onSaved={done} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roleList} onDone={done} />
    </>
  );
}

function PermissionMatrixCard({ roles, editable, onSaved }: { roles: Role[]; editable: boolean; onSaved: () => void }) {
  const [roleId, setRoleId] = useState<string>(() => roles.find((r) => r.key === "hr_admin")?.id ?? roles[0]?.id ?? "");
  const role = roles.find((r) => r.id === roleId);
  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [newRole, setNewRole] = useState(false);
  useEffect(() => setMatrix(role?.permissions ?? {}), [role]);
  const locked = !editable || role?.key === "super_admin";
  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(role?.permissions ?? {}), [matrix, role]);

  const toggle = (m: Module, a: Action, on: boolean) =>
    setMatrix((x) => {
      let acts = new Set(x[m] ?? []);
      if (on) {
        acts.add(a);
        acts.add("view"); // any action implies view
      } else {
        acts.delete(a);
        if (a === "view") acts = new Set();
      }
      return { ...x, [m]: ACTIONS.filter((k) => acts.has(k)) };
    });

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/access/roles/${roleId}`, { permissions: matrix }),
    onSuccess: () => {
      toast.success(`Permissions saved for ${role?.name}`);
      onSaved();
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/admin/access/roles/${roleId}`),
    onSuccess: () => {
      toast.success("Role deleted");
      setRoleId(roles[0]?.id ?? "");
      onSaved();
    },
  });

  return (
    <Card className="!gap-3 !p-4">
      <CardHeader
        title="Permission matrix"
        sub="What each role may do in the admin panel. Changes apply to everyone holding the role."
        actions={
          <>
            <Select className="!w-[200px]" value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Role">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.members})
                </option>
              ))}
            </Select>
            {editable ? (
              <Button onClick={() => setNewRole(true)}>
                <Plus size={16} /> New role
              </Button>
            ) : null}
          </>
        }
      />
      {role?.description ? <div className="text-muted text-[13px]">{role.description}</div> : null}
      <div className="scroll-thin min-w-0 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Module</th>
              {ACTIONS.map((a) => (
                <th key={a} style={{ textAlign: "center" }}>
                  {ACTION_LABELS[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m}>
                <td className="whitespace-nowrap font-medium">{MODULE_LABELS[m]}</td>
                {ACTIONS.map((a) => (
                  <td key={a} style={{ textAlign: "center" }}>
                    <div className="flex justify-center">
                      <Checkbox checked={matrix[m]?.includes(a) ?? false} disabled={locked} onChange={(v) => toggle(m, a, v)} label={<span className="sr-only">{`${MODULE_LABELS[m]}: ${ACTION_LABELS[a]}`}</span>} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted text-[12.5px]">
          Super admin always has every permission. "Configure" also means organisation-wide scope; roles without it (like Manager) only see their own team for approvals. Sensitive actions are written to the audit log.
        </span>
        <div className="flex gap-2">
          {editable && role && !role.isSystem ? (
            <Button variant="danger" loading={del.isPending} onClick={() => confirm(`Delete the ${role.name} role?`) && del.mutate()}>
              <Trash2 size={15} /> Delete role
            </Button>
          ) : null}
          {!locked ? (
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save permissions
            </Button>
          ) : null}
        </div>
      </div>
      <NewRoleDialog open={newRole} onOpenChange={setNewRole} onCreated={(id) => { onSaved(); setRoleId(id); }} />
    </Card>
  );
}

function NewRoleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>("/admin/access/roles", { name: name.trim(), description: description.trim() || null, permissions: {} }),
    onSuccess: (r) => {
      toast.success("Role created. Now tick what it can do.");
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated(r.id);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New role"
      description="Create a custom role, then set its permissions in the matrix."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create role
          </Button>
        </>
      }
    >
      <Field label="Role name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Branch HR" autoFocus />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="!min-h-[60px]" />
      </Field>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange, roles, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; roles: Role[]; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", roleId: "", scope: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", roleId: roles.find((r) => r.key === "viewer")?.id ?? roles[0]?.id ?? "", scope: "" });
      setError(null);
    }
  }, [open, roles]);
  const send = useMutation({
    mutationFn: async () => {
      const parsed = inviteAdminSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return api.post<{ invited?: boolean; granted?: boolean }>("/admin/access/members/invite", parsed.data);
    },
    meta: { silent: true },
    onSuccess: (r) => {
      toast.success(r.granted ? "Access granted. They can sign in with their existing login." : `Invite emailed to ${form.email}`);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite admin user"
      description="They'll get an email to set a password. Employees who already use self-service just get the role added."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
            Send invite
          </Button>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Field label="Full name">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>
      <Field label="Email">
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Role">
        <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Scope note (optional)" hint="For your reference, e.g. Sales · Ahmedabad">
        <Input value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
      </Field>
    </Dialog>
  );
}
