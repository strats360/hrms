import { Outlet } from "react-router";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";

export default function ComplianceLayout() {
  return (
    <>
      <PageHeader title="Statutory compliance" sub="EPF · ESI · Professional Tax · LWF · TDS · gratuity" />
      <RouteTabs
        tabs={[
          { to: "/compliance", label: "Overview", end: true },
          { to: "/compliance/employee", label: "Employee-wise" },
          { to: "/compliance/challans", label: "Challans & filings" },
          { to: "/compliance/rules", label: "Rules" },
        ]}
      />
      <Outlet />
    </>
  );
}
