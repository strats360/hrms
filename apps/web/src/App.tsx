import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { useSession } from "@/lib/session";
import { Loading } from "@/components/ui/page";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { PlatformLayout } from "@/components/layout/PlatformLayout";
import { EssLayout } from "@/components/layout/EssLayout";

const L = (f: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(f);
  return (
    <Suspense fallback={<Loading />}>
      <C />
    </Suspense>
  );
};

/** Must be signed in. */
function RequireAuth({ children }: { children?: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children ?? <Outlet />}</>;
}

/** "/" decides where a user lands. */
function Home() {
  const { me, tenant } = useSession();
  if (tenant?.roleId) return <AdminLayout />;
  if (tenant?.employeeId) return <Navigate to="/me" replace />;
  if (me?.platformRole) return <Navigate to="/platform" replace />;
  return <Navigate to="/no-access" replace />;
}

const router = createBrowserRouter([
  // public
  { path: "/login", element: L(() => import("@/pages/auth/Login")) },
  { path: "/forgot-password", element: L(() => import("@/pages/auth/ForgotPassword")) },
  { path: "/reset-password", element: L(() => import("@/pages/auth/ResetPassword")) },
  { path: "/signup", element: L(() => import("@/pages/auth/Signup")) },
  { path: "/onboarding/:token", element: L(() => import("@/pages/auth/InviteAccept")) },
  { path: "/invite/admin/:token", element: L(() => import("@/pages/auth/AdminInvite")) },
  {
    element: <RequireAuth />,
    children: [
      { path: "/no-access", element: L(() => import("@/pages/auth/NoAccess")) },
      { path: "/setup", element: L(() => import("@/pages/setup/CompanySetup")) },
      { path: "/me/onboarding", element: L(() => import("@/pages/ess/Onboarding")) },
      {
        path: "/me",
        element: <EssLayout />,
        children: [
          { index: true, element: L(() => import("@/pages/ess/Home")) },
          { path: "attendance", element: L(() => import("@/pages/ess/Attendance")) },
          { path: "leave", element: L(() => import("@/pages/ess/Leave")) },
          { path: "profile", element: L(() => import("@/pages/ess/Profile")) },
          { path: "payslips", element: L(() => import("@/pages/ess/Payslips")) },
          { path: "tax", element: L(() => import("@/pages/ess/Tax")) },
          { path: "claims", element: L(() => import("@/pages/ess/Claims")) },
        ],
      },
      {
        path: "/platform",
        element: <PlatformLayout />,
        children: [
          { index: true, element: L(() => import("@/pages/platform/Overview")) },
          { path: "tenants", element: L(() => import("@/pages/platform/Tenants")) },
          { path: "staff", element: L(() => import("@/pages/platform/Staff")) },
          { path: "audit", element: L(() => import("@/pages/platform/Audit")) },
          { path: "*", element: L(() => import("@/pages/Soon")) },
        ],
      },
      {
        path: "/",
        element: <Home />,
        children: [
          { index: true, element: L(() => import("@/pages/admin/Dashboard")) },
          {
            path: "employees",
            element: L(() => import("@/pages/admin/employees/EmployeesLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/employees/Directory")) },
              { path: "onboarding", element: L(() => import("@/pages/admin/employees/Onboarding")) },
              { path: "new", element: L(() => import("@/pages/admin/employees/EmployeeForm")) },
            ],
          },
          { path: "employees/:id", element: L(() => import("@/pages/admin/employees/EmployeeProfile")) },
          { path: "employees/:id/edit", element: L(() => import("@/pages/admin/employees/EmployeeForm")) },
          {
            path: "attendance",
            element: L(() => import("@/pages/admin/attendance/AttendanceLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/attendance/Today")) },
              { path: "monthly", element: L(() => import("@/pages/admin/attendance/Monthly")) },
              { path: "corrections", element: L(() => import("@/pages/admin/attendance/Corrections")) },
              { path: "policies", element: L(() => import("@/pages/admin/attendance/Policies")) },
            ],
          },
          {
            path: "leave",
            element: L(() => import("@/pages/admin/leave/LeaveLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/leave/Requests")) },
              { path: "balances", element: L(() => import("@/pages/admin/leave/Balances")) },
              { path: "policies", element: L(() => import("@/pages/admin/leave/Policies")) },
              { path: "holidays", element: L(() => import("@/pages/admin/leave/Holidays")) },
            ],
          },
          {
            path: "payroll",
            element: L(() => import("@/pages/admin/payroll/PayrollLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/payroll/Runs")) },
              { path: "structure", element: L(() => import("@/pages/admin/payroll/Structure")) },
              { path: "review", element: L(() => import("@/pages/admin/payroll/Review")) },
              { path: "payslips", element: L(() => import("@/pages/admin/payroll/Payslips")) },
            ],
          },
          {
            path: "compliance",
            element: L(() => import("@/pages/admin/compliance/ComplianceLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/compliance/Overview")) },
              { path: "employee", element: L(() => import("@/pages/admin/compliance/EmployeeWise")) },
              { path: "challans", element: L(() => import("@/pages/admin/compliance/Challans")) },
              { path: "rules", element: L(() => import("@/pages/admin/compliance/Rules")) },
            ],
          },
          {
            path: "tds",
            element: L(() => import("@/pages/admin/tds/TdsLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/tds/Summary")) },
              { path: "compute", element: L(() => import("@/pages/admin/tds/Computation")) },
              { path: "declarations", element: L(() => import("@/pages/admin/tds/Declarations")) },
              { path: "form16", element: L(() => import("@/pages/admin/tds/Form16")) },
            ],
          },
          {
            path: "reimbursements",
            element: L(() => import("@/pages/admin/reimbursements/ReimbursementsLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/reimbursements/Queue")) },
              { path: "history", element: L(() => import("@/pages/admin/reimbursements/History")) },
              { path: "categories", element: L(() => import("@/pages/admin/reimbursements/Categories")) },
            ],
          },
          {
            path: "payments",
            element: L(() => import("@/pages/admin/payments/PaymentsLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="salary" /> }))) },
              { path: "reimbursements", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="reimbursement" /> }))) },
              { path: "bonus", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="bonus" /> }))) },
              { path: "other", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="other" /> }))) },
              { path: "reconciliation", element: L(() => import("@/pages/admin/payments/Reconciliation")) },
              { path: "accounts", element: L(() => import("@/pages/admin/payments/Accounts")) },
            ],
          },
          { path: "reports", element: L(() => import("@/pages/admin/reports/Reports")) },
          { path: "payments/batches/:id", element: L(() => import("@/pages/admin/payments/BatchDetail")) },
          { path: "payroll/run/:runId", element: L(() => import("@/pages/admin/payroll/RunWizard")) },
          {
            path: "settings",
            element: L(() => import("@/pages/admin/settings/SettingsLayout")),
            children: [
              { index: true, element: L(() => import("@/pages/admin/settings/Organization")) },
              { path: "structure", element: L(() => import("@/pages/admin/settings/Structure")) },
              { path: "access", element: L(() => import("@/pages/admin/settings/Access")) },
              { path: "audit", element: L(() => import("@/pages/admin/settings/Audit")) },
            ],
          },
          { path: "*", element: L(() => import("@/pages/Soon")) },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
