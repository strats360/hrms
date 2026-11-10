import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { ALWAYS_SENT, NOTIFICATIONS, type NotificationDef, type NotificationPrefs } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Loading } from "@/components/ui/page";

const GROUP_LABEL: Record<NotificationDef["group"], string> = { self: "About your requests and pay", approver: "For approvers and HR" };

/** A switch row. Native checkbox with role="switch" so it's keyboard and screen-reader friendly. */
function Toggle({ def, on, disabled, note, onChange }: { def: NotificationDef; on: boolean; disabled?: boolean; note?: string; onChange: (v: boolean) => void }) {
  const id = `n-${def.key}`;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className="text-[13.5px] font-medium">{def.label}</div>
        <div className="text-muted text-[12.5px]">{note ?? def.description}</div>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-9 flex-none cursor-pointer appearance-none rounded-full bg-[var(--tint-2,var(--color-divider))] transition-colors before:block before:h-4 before:w-4 before:translate-x-0.5 before:rounded-full before:bg-white before:transition-transform checked:bg-[var(--color-accent)] checked:before:translate-x-[18px] disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function AlwaysSent() {
  return (
    <details className="text-[12.5px]">
      <summary className="text-muted cursor-pointer">Emails that always go out</summary>
      <ul className="text-muted !mb-0 !mt-1.5 flex flex-col gap-1 pl-5">
        {ALWAYS_SENT.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </details>
  );
}

/** The signed-in person's own switches, on the account page. */
export function MyNotificationsCard() {
  const { tenant } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", "mine", tenant?.tenantId],
    queryFn: () => api.get<{ company: NotificationPrefs; personal: NotificationPrefs; groups: NotificationDef["group"][] }>("/notifications/mine"),
    enabled: !!tenant && !tenant.support,
  });
  const save = useMutation({
    mutationFn: (personal: NotificationPrefs) => api.put("/notifications/mine", personal),
    onMutate: (personal) => qc.setQueryData(["notifications", "mine", tenant?.tenantId], (d: typeof q.data) => (d ? { ...d, personal } : d)),
    onSuccess: () => toast.success("Email settings saved"),
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: ["notifications", "mine"] });
    },
  });
  if (!tenant || tenant.support) return null;
  const d = q.data;
  return (
    <Card className="!gap-2">
      <CardHeader icon={<Bell size={18} />} title="Email notifications" sub={`Which emails you get from ${tenant.tenantName}.`} />
      {!d ? (
        <Loading />
      ) : (
        d.groups.map((g) => (
          <div key={g}>
            <div className="text-muted text-[11.5px] font-semibold uppercase tracking-[0.06em]">{GROUP_LABEL[g]}</div>
            <div className="divide-y divide-[var(--color-divider)]">
              {NOTIFICATIONS.filter((n) => n.group === g).map((n) => {
                const companyOff = d.company[n.key] === false;
                return (
                  <Toggle
                    key={n.key}
                    def={n}
                    on={!companyOff && d.personal[n.key] !== false}
                    disabled={companyOff || save.isPending}
                    note={companyOff ? `Turned off for everyone at ${tenant.tenantName}.` : undefined}
                    onChange={(v) => {
                      const next = { ...d.personal };
                      if (v) delete next[n.key];
                      else next[n.key] = false;
                      save.mutate(next);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}
      <AlwaysSent />
    </Card>
  );
}

/** Company-wide switches, for Settings › Notifications. */
export function CompanyNotificationsCard() {
  const { can } = useSession();
  const qc = useQueryClient();
  const editable = can("settings", "edit");
  const q = useQuery({ queryKey: ["notifications", "company"], queryFn: () => api.get<{ company: NotificationPrefs }>("/admin/org/notifications") });
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  useEffect(() => {
    if (q.data) setPrefs(q.data.company);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/org/notifications", prefs),
    onSuccess: () => {
      toast.success("Notification settings saved");
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return <Loading />;
  const dirty = NOTIFICATIONS.some((n) => (q.data.company[n.key] !== false) !== (prefs[n.key] !== false));
  return (
    <Card className="!gap-2">
      <CardHeader
        title="Email notifications"
        sub="Turn an email off here and nobody in the company gets it. Anything left on, each person can still turn off for themselves from their account page."
        actions={
          editable ? (
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          ) : null
        }
      />
      {(["self", "approver"] as const).map((g) => (
        <div key={g}>
          <div className="text-muted text-[11.5px] font-semibold uppercase tracking-[0.06em]">{g === "self" ? "To employees" : "To managers and HR"}</div>
          <div className="divide-y divide-[var(--color-divider)]">
            {NOTIFICATIONS.filter((n) => n.group === g).map((n) => (
              <Toggle
                key={n.key}
                def={n}
                on={prefs[n.key] !== false}
                disabled={!editable}
                onChange={(v) => {
                  const next = { ...prefs };
                  if (v) delete next[n.key];
                  else next[n.key] = false;
                  setPrefs(next);
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <AlwaysSent />
    </Card>
  );
}
