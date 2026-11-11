import { useEffect, useMemo, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ADMIN_NAV } from "./nav";

interface Hit {
  label: string;
  sub?: string;
  to: string;
}

/** ⌘K: jump to a page or an employee. */
export function CommandPalette({ open, onOpenChange, onGo }: { open: boolean; onOpenChange: (v: boolean) => void; onGo: (to: string) => void }) {
  const { can, has } = useSession();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const people = useQuery({
    queryKey: ["palette", debounced],
    queryFn: () => api.get<{ rows: { id: string; fullName: string; employeeCode: string; designation: string | null }[] }>(`/admin/employees${qs({ q: debounced, pageSize: 6 })}`),
    enabled: open && debounced.length >= 2 && can("employees"),
  });

  const hits = useMemo<Hit[]>(() => {
    const pages: Hit[] = ADMIN_NAV.flatMap((g) => g.items)
      .filter((i) => !i.soon && (!i.perm || can(i.perm[0], i.perm[1])) && (!i.feature || has(i.feature)))
      .map((i) => ({ label: i.label, sub: "Page", to: i.to }));
    const extra: Hit[] = [
      { label: "Add employee", sub: "Employees", to: "/employees/new" },
      { label: "Monthly attendance register", sub: "Attendance", to: "/attendance/monthly" },
      { label: "Leave balances", sub: "Leave", to: "/leave/balances" },
      { label: "Holiday calendar", sub: "Leave", to: "/leave/holidays" },
      { label: "Admin users & access", sub: "Settings", to: "/settings/access" },
      { label: "Salary structure", sub: "Payroll", to: "/payroll/structure" },
      { label: "Review & approve payroll", sub: "Payroll", to: "/payroll/review" },
      { label: "Audit log", sub: "Settings", to: "/settings/audit" },
    ];
    const s = q.trim().toLowerCase();
    const pg = [...pages, ...extra].filter((p) => !s || p.label.toLowerCase().includes(s));
    const ppl = (people.data?.rows ?? []).map((e) => ({ label: e.fullName, sub: `${e.employeeCode}${e.designation ? " · " + e.designation : ""}`, to: `/employees/${e.id}` }));
    return [...ppl, ...pg].slice(0, 12);
  }, [q, people.data, can, has]);

  useEffect(() => setActive(0), [hits.length]);

  const go = (h: Hit) => {
    onOpenChange(false);
    onGo(h.to);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="dialog-backdrop" style={{ zIndex: 40 }} />
        <D.Content className="dialog fixed left-1/2 top-[12vh] -translate-x-1/2 !gap-2 !p-2" style={{ width: "min(560px, calc(100vw - 32px))", zIndex: 41 }}>
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search pages and employees</D.Description>
          <div className="flex items-center gap-2 px-2">
            <Search size={16} style={{ color: "var(--muted)" }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(hits.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && hits[active]) go(hits[active]!);
              }}
              placeholder="Search pages and employees"
              className="h-11 flex-1 border-0 bg-transparent text-[15px] text-[var(--color-text)] outline-none"
              aria-label="Search"
            />
          </div>
          <div role="listbox" className="flex max-h-[50vh] flex-col overflow-y-auto">
            {hits.map((h, i) => (
              <button
                key={h.to + h.label}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] border-0 px-3 py-2 text-left text-[14px]"
                style={{ background: i === active ? "var(--tint-1)" : "transparent", color: "var(--color-text)" }}
              >
                <span>{h.label}</span>
                <span className="text-[12px]" style={{ color: "var(--muted)" }}>{h.sub}</span>
              </button>
            ))}
            {hits.length === 0 ? <div className="text-muted px-3 py-4 text-[13px]">No matches</div> : null}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
