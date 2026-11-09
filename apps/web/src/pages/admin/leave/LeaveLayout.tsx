import { useState } from "react";
import { Outlet } from "react-router";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ApplyOnBehalfDialog } from "@/components/leave/ApplyOnBehalfDialog";

export default function LeaveLayout() {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Leave management"
        sub="Approvals, balances, accrual and holidays"
        actions={
          <>
            {can("leave", "export") ? (
              <Button onClick={() => download("/admin/leave/register.csv", "leave-register.csv").catch((e) => toast.error(errorMessage(e)))}>
                <Download size={16} />
                Leave register
              </Button>
            ) : null}
            {can("leave", "edit") ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus size={16} />
                Apply on behalf
              </Button>
            ) : null}
          </>
        }
      />
      <RouteTabs
        tabs={[
          { to: "/leave", label: "Requests", end: true },
          { to: "/leave/balances", label: "Balances" },
          { to: "/leave/comp-off", label: "Comp off" },
          { to: "/leave/policies", label: "Leave policies" },
          { to: "/leave/holidays", label: "Holiday calendar" },
        ]}
      />
      <Outlet />
      {can("leave", "edit") ? <ApplyOnBehalfDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
