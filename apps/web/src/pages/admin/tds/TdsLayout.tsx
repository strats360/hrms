import { Outlet, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { currentFy, fyOptions, useFy } from "./shared";
import { confirmAction } from "@/components/ui/confirm";

export default function TdsLayout() {
  const { can } = useSession();
  const fy = useFy();
  const [params, setParams] = useSearchParams();
  const q = fy === currentFy() ? "" : `?fy=${fy}`;
  const remind = useMutation({
    mutationFn: () => api.post<{ sent: number }>("/admin/tds/declarations/remind", { fy }),
    onSuccess: (r) => toast.success(r.sent ? `Reminder emailed to ${r.sent} employee${r.sent === 1 ? "" : "s"}` : "Everyone has already submitted"),
  });
  return (
    <>
      <PageHeader
        title="TDS & income tax"
        sub={`FY ${fy} · declarations, projections and monthly deduction`}
        actions={
          <>
            <Select
              className="!w-[150px]"
              value={fy}
              aria-label="Financial year"
              onChange={(e) => {
                const p = new URLSearchParams(params);
                if (e.target.value === currentFy()) p.delete("fy");
                else p.set("fy", e.target.value);
                setParams(p);
              }}
            >
              {fyOptions().map((f) => (
                <option key={f} value={f}>
                  FY {f}
                </option>
              ))}
            </Select>
            {can("tds", "edit") ? (
              <Button loading={remind.isPending} onClick={() => void confirmAction({ title: "Send declaration reminders?", body: `Everyone who hasn't submitted a declaration for FY ${fy} gets an email.`, confirmLabel: "Send reminders" }).then((ok) => ok && remind.mutate())}>
                <Send size={15} /> Send declaration reminders
              </Button>
            ) : null}
          </>
        }
      />
      <RouteTabs
        tabs={[
          { to: `/tds${q}`, label: "Employee TDS", end: true },
          { to: `/tds/compute${q}`, label: "Tax computation" },
          { to: `/tds/declarations${q}`, label: "Declarations" },
          { to: `/tds/form16${q}`, label: "Form 16 & 24Q" },
        ]}
      />
      <Outlet />
    </>
  );
}
