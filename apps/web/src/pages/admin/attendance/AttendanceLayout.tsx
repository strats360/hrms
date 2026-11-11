import { useState } from "react";
import { Outlet } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Upload } from "lucide-react";
import { UploadDialog } from "@/components/attendance/UploadDialog";
import { toast } from "sonner";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, todayIST, type AttendanceStatus } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { useLookups } from "@/components/attendance/shared";

export default function AttendanceLayout() {
  const { can, has } = useSession();
  const lookups = useLookups();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const shift = lookups.data?.shifts.find((s) => s.isDefault) ?? lookups.data?.shifts[0];
  const sub = `Web, GPS, office IP, WFH and biometric sources${shift ? ` · default shift ${shift.startTime}–${shift.endTime}` : ""}`;

  return (
    <>
      <PageHeader
        title="Attendance"
        sub={sub}
        actions={
          <>
            {can("attendance", "export") ? (
              <Button
                onClick={() =>
                  download(`/admin/attendance/monthly.csv?month=${todayIST().slice(0, 7)}`, "attendance.csv").catch((e) => toast.error(errorMessage(e)))
                }
              >
                <Download size={16} />
                Export register
              </Button>
            ) : null}
            {can("attendance", "edit") ? (
              <Button onClick={() => setUploading(true)}>
                <Upload size={16} />
                Upload
              </Button>
            ) : null}
            {can("attendance", "edit") ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus size={16} />
                Manual entry
              </Button>
            ) : null}
          </>
        }
      />
      <UploadDialog open={uploading} onOpenChange={setUploading} />
      <RouteTabs
        tabs={[
          { to: "/attendance", label: "Today", end: true },
          { to: "/attendance/monthly", label: "Monthly register" },
          { to: "/attendance/roster", label: "Roster" },
          ...(has("module.timesheets") ? [{ to: "/attendance/timesheets", label: "Timesheets" }] : []),
          { to: "/attendance/corrections", label: "Corrections" },
          { to: "/attendance/policies", label: "Policies & shifts" },
        ]}
      />
      <Outlet />
      <ManualEntryDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ManualEntryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const empty = { employeeId: "", date: todayIST(), status: "present" as AttendanceStatus, checkIn: "09:00", checkOut: "18:00", note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const needsTimes = ["present", "late", "half_day", "wfh"].includes(f.status);
  const m = useMutation({
    mutationFn: () =>
      api.post("/admin/attendance/manual", {
        employeeId: f.employeeId,
        date: f.date,
        status: f.status,
        checkIn: needsTimes ? f.checkIn || null : null,
        checkOut: needsTimes ? f.checkOut || null : null,
        note: f.note || null,
      }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Attendance saved");
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setF(empty);
      onOpenChange(false);
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setErr(null);
        onOpenChange(v);
      }}
      title="Manual attendance entry"
      description="Mark or override attendance for one employee and day. This is recorded in the audit log."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.employeeId || !f.date} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" span>
          <Select value={f.employeeId} onChange={set("employeeId")}>
            <option value="">Select an employee</option>
            {lookups.data?.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" max={todayIST()} value={f.date} onChange={set("date")} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ATTENDANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {needsTimes ? (
          <>
            <Field label="Check-in">
              <Input type="time" value={f.checkIn} onChange={set("checkIn")} />
            </Field>
            <Field label="Check-out">
              <Input type="time" value={f.checkOut} onChange={set("checkOut")} />
            </Field>
          </>
        ) : null}
        <Field label="Note" span>
          <Input value={f.note} onChange={set("note")} placeholder="For example: biometric device was offline" maxLength={200} />
        </Field>
      </div>
      {err ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--bad)" }}>
          {err}
        </div>
      ) : null}
    </Dialog>
  );
}
