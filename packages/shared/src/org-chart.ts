/** Reporting tree for the org chart, built from each employee's manager. */
export interface OrgPerson {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  managerId: string | null;
}
export interface OrgNode extends OrgPerson {
  children: OrgNode[];
  /** Everyone below this person, at any level. */
  teamSize: number;
}

/**
 * Roots are people with no manager, or whose manager isn't in the list (left, or out of
 * scope). A reporting loop (A reports to B, B to A) is broken at the first person reached,
 * who becomes a root, so nobody is lost from the chart.
 */
export function buildOrgTree(people: OrgPerson[]): OrgNode[] {
  const byId = new Map(people.map((p) => [p.id, { ...p, children: [] as OrgNode[], teamSize: 0 }]));
  const roots: OrgNode[] = [];
  const parentOf = (id: string) => {
    const m = byId.get(id)?.managerId;
    return m && m !== id && byId.has(m) ? m : null;
  };
  // Is this person part of a loop? Walk up; coming back to them means yes.
  const inLoop = (id: string) => {
    const seen = new Set<string>();
    for (let cur = parentOf(id); cur; cur = parentOf(cur)) {
      if (cur === id) return true;
      if (seen.has(cur)) return false; // a loop above them, not through them
      seen.add(cur);
    }
    return false;
  };
  // break each loop at the first member we reach
  const cut = new Set<string>();
  const handled = new Set<string>();
  for (const p of people) {
    if (handled.has(p.id) || !inLoop(p.id)) continue;
    cut.add(p.id);
    handled.add(p.id);
    for (let cur = parentOf(p.id); cur && cur !== p.id; cur = parentOf(cur)) handled.add(cur);
  }
  for (const n of byId.values()) {
    const parent = cut.has(n.id) ? null : parentOf(n.id);
    if (parent) byId.get(parent)!.children.push(n);
    else roots.push(n);
  }
  const sort = (list: OrgNode[]) => {
    list.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    for (const n of list) sort(n.children);
  };
  const size = (n: OrgNode): number => (n.teamSize = n.children.reduce((s, c) => s + 1 + size(c), 0));
  roots.forEach(size);
  sort(roots);
  return roots;
}

/** The managers above someone, nearest first, for expanding the chart to them. */
export function chainOf(people: OrgPerson[], id: string): string[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: string[] = [];
  for (let m = byId.get(id)?.managerId; m && byId.has(m) && !out.includes(m) && m !== id; m = byId.get(m)!.managerId) out.push(m);
  return out;
}
