import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Fingerprint, Plus } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Device {
  id: string;
  name: string;
  serialNumber: string | null;
  branch: string | null;
  keyHint: string;
  active: boolean;
  lastSeenAt: string | null;
  lastPunchAt: string | null;
  punchCount: number;
}
interface Devices {
  endpoint: string;
  rows: Device[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "Never");
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Couldn't copy. Select and copy it by hand."));

/** Biometric and face-recognition terminals that push punches to the HRMS. */
export function DevicesCard() {
  const qc = useQueryClient();
  const { can } = useSession();
  const configure = can("attendance", "configure");
  const q = useQuery({ queryKey: ["attendance", "devices"], queryFn: () => api.get<Devices>("/admin/attendance/devices") });
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<{ branches: { id: string; name: string }[] }>("/admin/org/lookups"), staleTime: 60_000, enabled: configure });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", serialNumber: "", branchId: "" });
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["attendance", "devices"] });

  const add = useMutation({
    mutationFn: () => api.post<Device & { key: string }>("/admin/attendance/devices", { name: form.name.trim(), serialNumber: form.serialNumber.trim() || null, branchId: form.branchId || null }),
    onSuccess: (d) => {
      setAdding(false);
      setForm({ name: "", serialNumber: "", branchId: "" });
      setShown({ name: d.name, key: d.key });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotate = useMutation({
    mutationFn: (d: Device) => api.post<Device & { key: string }>(`/admin/attendance/devices/${d.id}/rotate`),
    onSuccess: (d) => {
      setShown({ name: d.name, key: d.key });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (d: Device) => api.patch(`/admin/attendance/devices/${d.id}`, { active: !d.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const endpoint = q.data?.endpoint ?? "";
  return (
    <Card className="!gap-3">
      <CardHeader
        title="Biometric devices"
        sub="Devices, or the attendance software they sync to, push punches here. The first and last punch of the day become check-in and check-out. Days HR entered or uploaded aren't changed."
        icon={<Fingerprint size={18} />}
        actions={
          configure ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add device
            </Button>
          ) : null
        }
      />
      {q.data?.rows.length ? (
        <div className="flex flex-col divide-y divide-[var(--color-divider)] text-[13.5px]">
          {q.data.rows.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {d.name} {d.active ? null : <Tag tone="neutral">Off</Tag>}
                </div>
                <div className="text-muted text-[12px]">
                  {[d.branch, d.serialNumber && `S/N ${d.serialNumber}`, `key ····${d.keyHint}`].filter(Boolean).join(" · ")}
                  {" · "}last sync {when(d.lastSeenAt)} · {d.punchCount.toLocaleString("en-IN")} punches
                </div>
              </div>
              {configure ? (
                <Menu
                  trigger={<Button size="sm" variant="ghost">Manage</Button>}
                  items={[
                    { label: "Issue a new key", onSelect: () => confirm(`Issue a new key for ${d.name}? The current key stops working straight away.`) && rotate.mutate(d) },
                    { label: d.active ? "Turn off" : "Turn on", danger: d.active, onSelect: () => toggle.mutate(d) },
                  ]}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted text-[13px]">No devices yet. You can also upload a CSV export from your attendance software.</div>
      )}
      <details className="text-[12.5px]">
        <summary className="cursor-pointer">How to connect a device</summary>
        <div className="mt-2 flex flex-col gap-2">
          <div>Point the device's push or cloud sync (or a small script on the attendance PC) at this address, with the device key as a bearer token:</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 break-all rounded-[var(--radius-sm)] px-2 py-1" style={{ background: "var(--tint-1)" }}>
              POST {endpoint}
            </code>
            <Button size="sm" variant="ghost" aria-label="Copy address" onClick={() => copy(endpoint)}>
              <Copy size={14} />
            </Button>
          </div>
          <pre className="scroll-thin m-0 overflow-auto rounded-[var(--radius-sm)] p-2 text-[11.5px]" style={{ background: "var(--tint-1)" }}>
            {`Authorization: Bearer dev_…
Content-Type: application/json

{ "punches": [
  { "userId": "STL-0042", "time": "2026-11-05 09:02:10" },
  { "userId": "1042", "time": "2026-11-05T18:31:00+05:30", "direction": "out" }
] }`}
          </pre>
          <div>
            <b>userId</b> is the employee ID, or the biometric ID set on the employee's profile. Times without a time zone are taken as IST. Up to 2,000 punches per request; sending the same punch twice is safe.
          </div>
        </div>
      </details>

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a device"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim()} loading={add.isPending} onClick={() => add.mutate()}>
              Add and show key
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bhavnagar HQ reception" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Serial number">
            <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
          </Field>
          <Field label="Branch">
            <Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              <option value="">Any</option>
              {lookups.data?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={!!shown}
        onOpenChange={(v) => !v && setShown(null)}
        title={`Key for ${shown?.name ?? ""}`}
        footer={
          <Button variant="primary" onClick={() => setShown(null)}>
            I've saved it
          </Button>
        }
      >
        <Notice tone="warn">Copy this key now. It isn't shown again; if it's lost, issue a new one.</Notice>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px]" style={{ background: "var(--tint-1)" }}>
            {shown?.key}
          </code>
          <Button size="sm" onClick={() => shown && copy(shown.key)}>
            <Copy size={14} /> Copy
          </Button>
        </div>
        <div className="text-muted text-[12px]">Added {fmtDate(new Date().toISOString().slice(0, 10))}. Anyone with this key can send punches for your company, so keep it on the device or sync PC only.</div>
      </Dialog>
    </Card>
  );
}
