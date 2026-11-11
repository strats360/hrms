import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { buildOrgTree, chainOf, type OrgNode, type OrgPerson } from "@hrms/shared";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Above this many direct reports, show them as a grid instead of one very wide row. */
const WIDE = 6;

export default function OrgChart() {
  const q = useQuery({ queryKey: ["employees", "org-chart"], queryFn: () => api.get<{ people: OrgPerson[]; scope: "company" | "team" }>("/admin/employees/org-chart") });
  const people = useMemo(() => q.data?.people ?? [], [q.data]);
  const roots = useMemo(() => buildOrgTree(people), [people]);
  const [view, setView] = useState<"chart" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 700 ? "list" : "chart"));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  // the chart can be re-centred on one manager (drill down), with a trail back to the top
  const [rootId, setRootId] = useState<string | null>(null);
  const index = useMemo(() => {
    const m = new Map<string, OrgNode>();
    const walk = (n: OrgNode) => (m.set(n.id, n), n.children.forEach(walk));
    roots.forEach(walk);
    return m;
  }, [roots]);
  const shown = rootId && index.has(rootId) ? [index.get(rootId)!] : roots;
  const trail = rootId ? [...chainOf(people, rootId)].reverse() : [];
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const departments = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean) as string[])].sort(), [people]);

  // start with the top of the chart open
  useEffect(() => {
    setOpen(new Set(roots.map((r) => r.id)));
  }, [roots]);

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (s.length < 2) return [];
    return people.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || (p.designation ?? "").toLowerCase().includes(s)).slice(0, 8);
  }, [people, query]);

  const drill = (id: string) => {
    setRootId(id);
    setOpen((o) => new Set([...o, id]));
  };
  const show = (id: string) => {
    // centre on their manager so they show with their teammates
    const manager = people.find((p) => p.id === id)?.managerId ?? null;
    setRootId(view === "chart" ? manager : null);
    setOpen((o) => new Set([...o, ...chainOf(people, id)]));
    setFocus(id);
    setQuery("");
    setTimeout(() => document.getElementById(`org-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }), 60);
  };
  const toggle = (id: string) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])));
  const all = () => setOpen(new Set(people.map((p) => p.id)));
  const none = () => (setOpen(new Set(roots.map((r) => r.id))), setRootId(null));

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!people.length) return <Card><Empty title="Nobody to show yet" sub="Add employees and set who they report to, and the chart builds itself." /></Card>;

  const managers = people.filter((p) => people.some((x) => x.managerId === p.id)).length;
  const ctx: Ctx = { open, toggle, focus, dept, drill };
  return (
    <Card className="!gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search size={15} className="text-muted pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input className="!pl-8" placeholder="Find a person" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a person" />
          {matches.length ? (
            <div className="card elev-md absolute inset-x-0 top-[calc(100%+4px)] z-20 !gap-0 !p-1">
              {matches.map((m) => (
                <button key={m.id} type="button" onClick={() => show(m.id)} className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--tint-1)]">
                  <Avatar employeeId={m.id} name={m.name} size={24} />
                  <span className="min-w-0 truncate">
                    {m.name} <span className="text-muted">· {m.designation ?? m.code}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Select className="!w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Highlight a department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
        <PillTabs<"chart" | "list"> value={view} onChange={setView} tabs={[{ value: "chart", label: "Chart" }, { value: "list", label: "List" }]} />
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" onClick={all}>
            <ChevronsUpDown size={14} /> Expand all
          </Button>
          <Button size="sm" onClick={none}>
            <ChevronsDownUp size={14} /> Collapse
          </Button>
        </div>
      </div>
      <div className="text-muted text-[12.5px]">
        {people.length} {people.length === 1 ? "person" : "people"} · {managers} with reports
        {q.data?.scope === "team" ? " · you see your own team" : ""}
        {roots.length > 1 ? ` · ${roots.length} people have no manager set` : ""}
      </div>
      {view === "chart" && rootId ? (
        <nav aria-label="Where you are in the chart" className="flex flex-wrap items-center gap-1 text-[13px]">
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-[var(--sel-fg)]" onClick={() => setRootId(null)}>
            Top
          </button>
          {trail.map((id) => (
            <span key={id} className="inline-flex items-center gap-1">
              <ChevronRight size={13} className="text-muted" />
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-[var(--sel-fg)]" onClick={() => drill(id)}>
                {index.get(id)?.name}
              </button>
            </span>
          ))}
          <ChevronRight size={13} className="text-muted" />
          <span className="font-medium">{index.get(rootId)?.name}</span>
        </nav>
      ) : null}
      {view === "chart" ? (
        <div className="scroll-thin -mx-1 min-w-0 overflow-auto px-1 pb-2" style={{ maxHeight: "calc(100vh - 260px)" }}>
          <ul className="org-tree mx-auto w-max min-w-full py-2">
            {shown.map((r) => (
              <ChartNode key={r.id} node={r} ctx={ctx} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col">
          {roots.map((r) => (
            <ListNode key={r.id} node={r} depth={0} ctx={ctx} />
          ))}
        </div>
      )}
    </Card>
  );
}

interface Ctx {
  open: Set<string>;
  toggle: (id: string) => void;
  focus: string | null;
  dept: string;
  drill: (id: string) => void;
}

function PersonCard({ node, ctx, compact }: { node: OrgNode; ctx: Ctx; compact?: boolean }) {
  const dim = ctx.dept && node.department !== ctx.dept;
  return (
    <div
      id={`org-${node.id}`}
      className={cn("card relative flex !gap-0 text-left transition-opacity", compact ? "w-[210px] !p-2" : "w-[190px] flex-col items-center !p-3 text-center", dim && "opacity-35")}
      style={ctx.focus === node.id ? { outline: "2px solid var(--color-accent)", outlineOffset: 2 } : undefined}
    >
      <div className={cn("flex min-w-0 gap-2", compact ? "flex-row items-center" : "flex-col items-center")}>
        <Avatar employeeId={node.id} name={node.name} size={compact ? 32 : 44} />
        <div className="min-w-0">
          <Link to={`/employees/${node.id}`} className="block truncate text-[13px] font-semibold no-underline" style={{ color: "var(--color-text)" }}>
            {node.name}
          </Link>
          <div className="text-muted truncate text-[11.5px]">{node.designation ?? node.code}</div>
          {!compact && node.department ? <div className="text-muted truncate text-[11px]">{node.department}</div> : null}
        </div>
      </div>
      {node.children.length ? (
        <button
          type="button"
          onClick={() => (compact ? ctx.drill(node.id) : ctx.toggle(node.id))}
          aria-expanded={compact ? undefined : ctx.open.has(node.id)}
          aria-label={compact ? `Show ${node.name}'s team` : undefined}
          className={cn("mt-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-0.5 text-[11.5px] text-[var(--color-text)] hover:bg-[var(--tint-1)]", compact && "ml-auto mt-0 self-center")}
        >
          {node.children.length}
          {node.teamSize > node.children.length ? <span className="text-muted">/ {node.teamSize}</span> : null}
          {!compact && ctx.open.has(node.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : null}
    </div>
  );
}

function ChartNode({ node, ctx }: { node: OrgNode; ctx: Ctx }) {
  const isOpen = ctx.open.has(node.id) && node.children.length > 0;
  return (
    <li>
      <PersonCard node={node} ctx={ctx} />
      {isOpen ? (
        node.children.length > WIDE ? (
          <>
            <div className="org-grid-stem" />
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-divider)] p-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.ceil(node.children.length / 4))}, minmax(0, 1fr))` }}>
              {node.children.map((c) => (
                <div key={c.id} className="flex flex-col items-center">
                  <PersonCard node={c} ctx={ctx} compact />
                </div>
              ))}
            </div>
          </>
        ) : (
          <ul>
            {node.children.map((c) => (
              <ChartNode key={c.id} node={c} ctx={ctx} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function ListNode({ node, depth, ctx }: { node: OrgNode; depth: number; ctx: Ctx }) {
  const isOpen = ctx.open.has(node.id);
  const dim = ctx.dept && node.department !== ctx.dept;
  return (
    <>
      <div
        id={`org-${node.id}`}
        className={cn("flex items-center gap-2 border-b border-[var(--color-divider)] py-2", dim && "opacity-35")}
        style={{ paddingLeft: depth * 18, ...(ctx.focus === node.id ? { background: "var(--sel-bg)" } : {}) }}
      >
        {node.children.length ? (
          <Button size="sm" variant="ghost" icon aria-label={isOpen ? `Hide ${node.name}'s team` : `Show ${node.name}'s team`} onClick={() => ctx.toggle(node.id)}>
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </Button>
        ) : (
          <span className="inline-block w-[30px]" />
        )}
        <Avatar employeeId={node.id} name={node.name} size={30} />
        <div className="min-w-0 flex-1">
          <Link to={`/employees/${node.id}`} className="block truncate text-[13.5px] font-medium no-underline" style={{ color: "var(--color-text)" }}>
            {node.name}
          </Link>
          <div className="text-muted truncate text-[12px]">{[node.designation, node.department].filter(Boolean).join(" · ") || node.code}</div>
        </div>
        {node.children.length ? <span className="text-muted flex-none text-[12px]">{node.teamSize} below</span> : null}
      </div>
      {isOpen ? node.children.map((c) => <ListNode key={c.id} node={c} depth={depth + 1} ctx={ctx} />) : null}
    </>
  );
}
