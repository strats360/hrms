import { useState } from "react";
import { Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ExpenseCategory } from "@/lib/types";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ClaimDialog } from "@/components/reimbursements/shared";

export const useCategories = () => useQuery({ queryKey: ["claims", "categories"], queryFn: () => api.get<ExpenseCategory[]>("/admin/reimbursements/categories") });

export default function ReimbursementsLayout() {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const cats = useCategories();
  return (
    <>
      <PageHeader
        title="Reimbursements"
        sub="Claims, approvals and payouts with salary"
        actions={
          <>
            {can("reimbursements", "export") ? (
              <Button onClick={() => download("/admin/reimbursements/export.csv", "reimbursements.csv").catch((e) => toast.error(errorMessage(e)))}>
                <Download size={16} />
                Export CSV
              </Button>
            ) : null}
            {can("reimbursements", "edit") ? (
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus size={16} />
                New claim
              </Button>
            ) : null}
          </>
        }
      />
      <RouteTabs
        tabs={[
          { to: "/reimbursements", label: "Approval queue", end: true },
          { to: "/reimbursements/history", label: "History" },
          { to: "/reimbursements/categories", label: "Categories" },
        ]}
      />
      <Outlet />
      {can("reimbursements", "edit") ? <ClaimDialog open={open} onClose={() => setOpen(false)} categories={cats.data ?? []} pickEmployee endpoint="/admin/reimbursements/claims" /> : null}
    </>
  );
}
