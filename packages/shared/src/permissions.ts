/**
 * Role-based access control model.
 *
 * Every tenant role holds a matrix of module -> allowed actions. The five
 * actions mirror the permission grid in the design ("Admin users & access"):
 * view, create/edit, approve, export, configure.
 */
export const MODULES = [
  "employees",
  "attendance",
  "leave",
  "payroll",
  "compliance",
  "tds",
  "reimbursements",
  "payments",
  "reports",
  "settings",
  "users",
  "billing",
  "recruitment",
  "assets",
  "helpdesk",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "edit", "approve", "export", "configure"] as const;
export type Action = (typeof ACTIONS)[number];

export type PermissionMatrix = Partial<Record<Module, Action[]>>;

export const MODULE_LABELS: Record<Module, string> = {
  employees: "Employees",
  attendance: "Attendance",
  leave: "Leave",
  payroll: "Payroll",
  compliance: "Compliance",
  tds: "TDS & tax",
  reimbursements: "Reimbursements",
  payments: "Payments",
  reports: "Reports",
  settings: "Settings",
  users: "Admin users & access",
  billing: "Billing & invoices",
  recruitment: "Recruitment",
  assets: "Assets",
  helpdesk: "Helpdesk",
};

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  edit: "Create / edit",
  approve: "Approve",
  export: "Export",
  configure: "Configure",
};

const all = (): PermissionMatrix =>
  Object.fromEntries(MODULES.map((m) => [m, [...ACTIONS]])) as PermissionMatrix;

/** Default roles created for every new tenant. Super admin always has everything. */
export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: PermissionMatrix }[] = [
  { key: "super_admin", name: "Super admin", description: "Full access to every module and setting", permissions: all() },
  {
    key: "hr_admin",
    name: "HR admin",
    description: "People, attendance and leave. Read-only payroll.",
    permissions: {
      employees: ["view", "edit", "export", "configure"],
      attendance: ["view", "edit", "approve", "export", "configure"],
      leave: ["view", "edit", "approve", "export", "configure"],
      payroll: ["view"],
      compliance: ["view"],
      tds: ["view"],
      reimbursements: ["view", "export"],
      reports: ["view", "export"],
      settings: ["view", "edit"],
      recruitment: [...ACTIONS],
      assets: [...ACTIONS],
      helpdesk: [...ACTIONS],
    },
  },
  {
    key: "payroll_admin",
    name: "Payroll admin",
    description: "Runs payroll, compliance and TDS",
    permissions: {
      employees: ["view", "export"],
      attendance: ["view", "export"],
      leave: ["view", "export"],
      payroll: [...ACTIONS],
      compliance: [...ACTIONS],
      tds: [...ACTIONS],
      reimbursements: ["view", "export"],
      payments: ["view", "edit", "export"],
      reports: ["view", "export"],
      settings: ["view"],
    },
  },
  {
    key: "finance_approver",
    name: "Finance approver",
    description: "Approves payroll, claims and payments",
    permissions: {
      employees: ["view"],
      payroll: ["view", "approve", "export"],
      compliance: ["view", "approve", "export"],
      tds: ["view", "export"],
      reimbursements: ["view", "approve", "export"],
      payments: ["view", "edit", "approve", "export"],
      reports: ["view", "export"],
      billing: ["view"],
      assets: ["view"],
    },
  },
  {
    key: "manager",
    name: "Manager",
    description: "Approves requests for their team",
    permissions: {
      employees: ["view"],
      attendance: ["view", "approve"],
      leave: ["view", "approve"],
      reimbursements: ["view", "approve"],
      reports: ["view"],
      recruitment: ["view"],
    },
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access, for auditors and consultants",
    permissions: {
      employees: ["view"],
      attendance: ["view"],
      leave: ["view"],
      payroll: ["view"],
      compliance: ["view"],
      reimbursements: ["view"],
      reports: ["view", "export"],
      assets: ["view"],
    },
  },
];

export function can(perms: PermissionMatrix | null | undefined, module: Module, action: Action = "view"): boolean {
  if (!perms) return false;
  return perms[module]?.includes(action) ?? false;
}

/** Drop unknown modules/actions so a client can't store garbage in a role. */
export function sanitizeMatrix(input: Record<string, unknown>): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const m of MODULES) {
    const v = input[m];
    if (Array.isArray(v)) {
      const acts = ACTIONS.filter((a) => v.includes(a));
      if (acts.length) out[m] = acts;
    }
  }
  return out;
}

/** Platform (SaaS operator) roles. Separate from tenant roles. */
export const PLATFORM_ROLES = ["super_admin", "support", "finance"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
