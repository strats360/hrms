import { useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ImportDialog } from "@/components/employees/ImportDialog";

interface Stats {
  total: number;
  byStatus: { status: string; n: number }[];
  byBranch: { branch: string | null; n: number }[];
}

export default function EmployeesLayout() {
  const { can } = useSession();
  const nav = useNavigate();
  const [importOpen, setImportOpen] = useState(false);
  const stats = useQuery({ queryKey: ["employee-stats"], queryFn: () => api.get<Stats>("/admin/employees/stats") });

  const s = stats.data;
  const current = s ? s.byStatus.filter((x) => !["exited", "inactive"].includes(x.status)).reduce((a, b) => a + b.n, 0) : null;
  const branches = s?.byBranch.filter((b) => b.branch).map((b) => b.branch!) ?? [];
  const sub =
    current === null
      ? "People, onboarding and records"
      : `${current} ${current === 1 ? "person" : "people"}${branches.length ? ` across ${branches.length > 2 ? `${branches.length} branches` : branches.join(" and ")}` : ""}`;

  return (
    <>
      <PageHeader
        title="Employees"
        sub={sub}
        actions={
          <>
            {can("employees", "edit") ? (
              <Button onClick={() => setImportOpen(true)}>
                <Upload size={16} /> Bulk import
              </Button>
            ) : null}
            {can("employees", "export") ? (
              <Button onClick={() => download("/admin/employees/export.csv", "employee-master.csv").catch((e) => toast.error(errorMessage(e)))}>
                <Download size={16} /> Export CSV
              </Button>
            ) : null}
            {can("employees", "edit") ? (
              <Button variant="primary" onClick={() => nav("/employees/new")}>
                <Plus size={16} /> Add employee
              </Button>
            ) : null}
          </>
        }
      />
      <RouteTabs
        tabs={[
          { to: "/employees", label: "Directory", end: true },
          { to: "/employees/org-chart", label: "Org chart" },
          { to: "/employees/onboarding", label: "Onboarding" },
          ...(can("employees", "edit") || can("payroll", "view") ? [{ to: "/employees/exits", label: "Exits" }] : []),
          ...(can("employees", "edit") ? [{ to: "/employees/new", label: "Add employee" }] : []),
        ]}
      />
      <Outlet />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
