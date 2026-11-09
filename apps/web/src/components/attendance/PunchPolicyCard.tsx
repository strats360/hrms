import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { Link } from "react-router";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type Mode = "off" | "flag" | "block";
interface Policy {
  location: Mode;
  ip: Mode;
  wfhExempt: boolean;
}
interface PolicyRes {
  policy: Policy;
  offices: { name: string; location: boolean; ips: number }[];
}

const MODES: { value: Mode; label: string }[] = [
  { value: "off", label: "Don't check (just record it)" },
  { value: "flag", label: "Allow, but flag it for HR" },
  { value: "block", label: "Don't allow the punch" },
];

/** Where punches may come from: the office's location and network. */
export function PunchPolicyCard() {
  const qc = useQueryClient();
  const { can } = useSession();
  const edit = can("attendance", "configure");
  const q = useQuery({ queryKey: ["attendance", "punch-policy"], queryFn: () => api.get<PolicyRes>("/admin/attendance/punch-policy") });
  const [p, setP] = useState<Policy | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data.policy);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/attendance/punch-policy", p),
    onSuccess: () => {
      toast.success("Punch checks saved. They apply from the next punch.");
      qc.invalidateQueries({ queryKey: ["attendance", "punch-policy"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!p || !q.data) return null;
  const fenced = q.data.offices.filter((o) => o.location);
  const networks = q.data.offices.filter((o) => o.ips);
  const dirty = JSON.stringify(p) !== JSON.stringify(q.data.policy);
  return (
    <Card className="!gap-3">
      <CardHeader title="Where punches can come from" icon={<MapPin size={18} />} sub="Checks self-service punches against the employee's office. Being at any of your offices counts. Devices and HR entries aren't checked." />
      <Field label="Office location" hint={fenced.length ? `Set for ${fenced.map((o) => o.name).join(", ")}` : <>No branch has a location yet. <Link to="/settings/structure">Add one in Settings › Branches</Link></>}>
        <Select value={p.location} onChange={(e) => setP({ ...p, location: e.target.value as Mode })} disabled={!edit}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Office network (IP address)" hint={networks.length ? `Set for ${networks.map((o) => o.name).join(", ")}` : "No branch has office IP addresses yet"}>
        <Select value={p.ip} onChange={(e) => setP({ ...p, ip: e.target.value as Mode })} disabled={!edit}>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="Work from home punches are exempt" checked={p.wfhExempt} onChange={(v) => setP({ ...p, wfhExempt: v })} disabled={!edit} />
      {edit ? (
        <div className="flex justify-end">
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
