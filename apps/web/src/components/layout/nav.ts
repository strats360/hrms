import type { LucideIcon } from "lucide-react";
import {
  BadgePercent,
  Banknote,
  BarChart3,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  Home,
  LifeBuoy,
  Receipt,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { Action, Module } from "@hrms/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: [Module, Action?];
  soon?: boolean;
  badgeKey?: "leave" | "corrections";
}
export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  { key: "overview", label: "Overview", items: [{ to: "/", label: "Dashboard", icon: Home }] },
  {
    key: "people",
    label: "People",
    items: [
      { to: "/employees", label: "Employees", icon: Users, perm: ["employees"] },
      { to: "/attendance", label: "Attendance", icon: Clock, perm: ["attendance"], badgeKey: "corrections" },
      { to: "/leave", label: "Leave", icon: CalendarDays, perm: ["leave"], badgeKey: "leave" },
    ],
  },
  {
    key: "pay",
    label: "Pay",
    items: [
      { to: "/payroll", label: "Payroll", icon: Banknote, perm: ["payroll"] },
      { to: "/compliance", label: "Statutory compliance", icon: ShieldCheck, perm: ["compliance"] },
      { to: "/tds", label: "TDS & tax", icon: BadgePercent, perm: ["tds"], soon: true },
      { to: "/reimbursements", label: "Reimbursements", icon: Receipt, perm: ["reimbursements"], soon: true },
      { to: "/payments", label: "Payments", icon: CreditCard, perm: ["payments"], soon: true },
    ],
  },
  {
    key: "company",
    label: "Company",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, perm: ["reports"], soon: true },
      { to: "/settings", label: "Settings", icon: Settings, perm: ["settings"] },
    ],
  },
];

export const PLATFORM_NAV: NavGroup[] = [
  {
    key: "p_home",
    label: "Platform",
    items: [
      { to: "/platform", label: "Overview", icon: Home },
      { to: "/platform/tenants", label: "Tenants", icon: Users },
      { to: "/platform/tickets", label: "Support tickets", icon: LifeBuoy, soon: true },
    ],
  },
  {
    key: "p_rev",
    label: "Revenue",
    items: [
      { to: "/platform/plans", label: "Plans & pricing", icon: CreditCard, soon: true },
      { to: "/platform/billing", label: "Billing & invoices", icon: Receipt, soon: true },
    ],
  },
  {
    key: "p_ops",
    label: "Operations",
    items: [
      { to: "/platform/statutory", label: "Statutory master", icon: ShieldCheck, soon: true },
      { to: "/platform/flags", label: "Feature flags", icon: SlidersHorizontal, soon: true },
    ],
  },
  {
    key: "p_gov",
    label: "Governance",
    items: [
      { to: "/platform/staff", label: "Platform staff", icon: Users },
      { to: "/platform/audit", label: "Audit log", icon: FileText },
    ],
  },
];
