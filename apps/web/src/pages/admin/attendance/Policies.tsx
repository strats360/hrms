import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { shiftSchema } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ErrorState, Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { DAY_SHORT, minsLabel } from "@/components/attendance/shared";

interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  isDefault: boolean;
}
type Form = Omit<Shift, "id">;
const BLANK: Form = { name: "", startTime: "09:00", endTime: "18:00", graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffs: [0, 6], isDefault: false };

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3">
    <span className="text-muted">{k}</span>
    <span className="text-right">{v}</span>
  </div>
);

export default function Policies() {
  const { can } = useSession();
  const qc = useQueryClient();
  const editable = can("settings", "edit");
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const shifts = useQuery({ queryKey: ["attendance", "shifts"], queryFn: () => api.get<Shift[]>("/admin/org/shifts") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["attendance"] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/org/shifts/${id}`),
    onSuccess: () => {
      toast.success("Shift deleted");
      refresh();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="card-title text-[17px]">Shifts</div>
          <div className="text-muted text-[13px]">Each employee follows their own shift, or the default shift if none is set on their profile.</div>
        </div>
        {editable ? (
          <Button variant="primary" onClick={() => setEdit({ form: { ...BLANK } })}>
            <Plus size={16} />
            Add shift
          </Button>
        ) : null}
      </div>
      {shifts.error ? <ErrorState error={shifts.error} retry={() => shifts.refetch()} /> : null}
      {shifts.isLoading ? <Loading /> : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {shifts.data?.map((s) => (
          <Card key={s.id} className="!gap-2.5">
            <CardHeader
              title={s.name}
              actions={s.isDefault ? <Tag tone="accent">Default</Tag> : undefined}
            />
            <div className="flex flex-col gap-1.5 text-[13.5px]">
              <Row k="Hours" v={`${s.startTime} – ${s.endTime}`} />
              <Row k="Grace time" v={`${s.graceMinutes} min`} />
              <Row k="Half day if worked under" v={minsLabel(s.fullDayMinutes)} />
              <Row k="Absent if worked under" v={minsLabel(s.halfDayMinutes)} />
              <Row k="Weekly offs" v={s.weeklyOffs.length ? [...s.weeklyOffs].sort().map((d) => DAY_SHORT[d]).join(", ") : "None"} />
            </div>
            {editable ? (
              <div className="mt-1 flex gap-2">
                <Button size="sm" onClick={() => setEdit({ id: s.id, form: { name: s.name, startTime: s.startTime, endTime: s.endTime, graceMinutes: s.graceMinutes, halfDayMinutes: s.halfDayMinutes, fullDayMinutes: s.fullDayMinutes, weeklyOffs: s.weeklyOffs, isDefault: s.isDefault } })}>
                  Edit
                </Button>
                {!s.isDefault ? (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={del.isPending && del.variables === s.id}
                    onClick={() => {
                      if (confirm(`Delete the ${s.name} shift?`)) del.mutate(s.id);
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        <Card className="!gap-2.5">
          <CardHeader title="Capture sources" />
          <div className="flex flex-col gap-2 text-[13.5px]">
            <Row k="Web and mobile punch" v={<Tag tone="ok">On</Tag>} />
            <Row k="GPS location with mobile punch" v={<Tag tone="ok">Recorded</Tag>} />
            <Row k="Office IP address" v={<Tag tone="ok">Recorded</Tag>} />
            <Row k="Work from home (self-marked)" v={<Tag tone="ok">On</Tag>} />
            <Row k="Biometric device import" v={<Tag tone="neutral">Via bulk upload</Tag>} />
            <Row k="Manual entry by HR" v={<Tag tone="ok">Audited</Tag>} />
          </div>
        </Card>
        <Card className="!gap-2.5">
          <CardHeader title="How status is worked out" />
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px]">
            <li>Check-in after the shift start plus grace time is marked late.</li>
            <li>Worked time below the half-day threshold is absent; below the full-day threshold is a half day.</li>
            <li>Time worked beyond the shift length counts as overtime in blocks of 30 minutes.</li>
            <li>Weekly offs, holidays and approved leave fill in days without a punch.</li>
          </ul>
        </Card>
        <Card className="!gap-2.5">
          <CardHeader title="Approvals" />
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px]">
            <li>Employees raise correction requests from self-service.</li>
            <li>The reporting manager or HR approves. Nobody can approve their own request.</li>
            <li>Approved corrections update the day's record and are kept in the audit log.</li>
          </ul>
        </Card>
      </div>

      {edit ? <ShiftDialog key={edit.id ?? "new"} id={edit.id} initial={edit.form} onClose={() => setEdit(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function ShiftDialog({ id, initial, onClose, onSaved }: { id?: string; initial: Form; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Form) => (id ? api.patch(`/admin/org/shifts/${id}`, body) : api.post("/admin/org/shifts", body)),
    meta: { silent: true },
    onSuccess: () => {
      toast.success(id ? "Shift updated" : "Shift added");
      onSaved();
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const submit = () => {
    const p = shiftSchema.safeParse(f);
    if (!p.success) return setErr(p.error.issues[0]?.message ?? "Check the form");
    if (f.halfDayMinutes > f.fullDayMinutes) return setErr("The half-day threshold must be lower than the full-day threshold");
    setErr(null);
    save.mutate(p.data as Form);
  };
  const num = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: Number(e.target.value) }));
  const toggleDay = (d: number) => setF((s) => ({ ...s, weeklyOffs: s.weeklyOffs.includes(d) ? s.weeklyOffs.filter((x) => x !== d) : [...s.weeklyOffs, d] }));

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={id ? "Edit shift" : "Add shift"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save shift
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Shift name" span>
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="For example: General, Night support" />
        </Field>
        <Field label="Start time">
          <Input type="time" value={f.startTime} onChange={(e) => setF((s) => ({ ...s, startTime: e.target.value }))} />
        </Field>
        <Field label="End time">
          <Input type="time" value={f.endTime} onChange={(e) => setF((s) => ({ ...s, endTime: e.target.value }))} />
        </Field>
        <Field label="Grace time (minutes)">
          <Input type="number" min={0} max={240} value={f.graceMinutes} onChange={num("graceMinutes")} />
        </Field>
        <Field label="Absent below (minutes worked)" hint="Below this is marked absent">
          <Input type="number" min={0} max={1440} value={f.halfDayMinutes} onChange={num("halfDayMinutes")} />
        </Field>
        <Field label="Full day from (minutes worked)" hint="Below this is a half day">
          <Input type="number" min={0} max={1440} value={f.fullDayMinutes} onChange={num("fullDayMinutes")} />
        </Field>
        <Field label="Weekly offs" span>
          <div className="flex flex-wrap gap-1.5">
            {DAY_SHORT.map((d, i) => {
              const on = f.weeklyOffs.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(i)}
                  className="cursor-pointer rounded-[var(--radius-md)] border px-3 py-1.5 text-[13px]"
                  style={{ borderColor: on ? "var(--color-accent)" : "var(--color-divider)", background: on ? "var(--sel-bg)" : "transparent", color: on ? "var(--sel-fg)" : "var(--color-text)" }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="col-span-full">
          <Checkbox checked={f.isDefault} onChange={(v) => setF((s) => ({ ...s, isDefault: v }))} label="Use as the default shift" />
        </div>
      </div>
      {err ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      ) : null}
    </Dialog>
  );
}
