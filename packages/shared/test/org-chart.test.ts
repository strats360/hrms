import { describe, expect, it } from "vitest";
import { buildOrgTree, chainOf, type OrgPerson } from "../src/org-chart";

const p = (id: string, managerId: string | null): OrgPerson => ({ id, name: id, code: id, designation: null, department: null, branch: null, managerId });

describe("org chart", () => {
  it("nests people under their managers and counts teams", () => {
    const roots = buildOrgTree([p("ceo", null), p("cto", "ceo"), p("dev1", "cto"), p("dev2", "cto"), p("cfo", "ceo")]);
    expect(roots.map((r) => r.id)).toEqual(["ceo"]);
    expect(roots[0]!.teamSize).toBe(4);
    // bigger teams first
    expect(roots[0]!.children.map((c) => c.id)).toEqual(["cto", "cfo"]);
    expect(roots[0]!.children[0]!.teamSize).toBe(2);
  });
  it("makes a root of anyone whose manager isn't listed", () => {
    expect(buildOrgTree([p("a", "gone"), p("b", "a")]).map((r) => r.id)).toEqual(["a"]);
  });
  it("doesn't lose anyone to a reporting loop", () => {
    const roots = buildOrgTree([p("a", "b"), p("b", "a"), p("c", "a"), p("self", "self")]);
    const all: string[] = [];
    const walk = (n: { id: string; children: any[] }) => (all.push(n.id), n.children.forEach(walk));
    roots.forEach(walk);
    expect(all.sort()).toEqual(["a", "b", "c", "self"]);
  });
  it("lists the managers above someone", () => {
    expect(chainOf([p("ceo", null), p("cto", "ceo"), p("dev", "cto")], "dev")).toEqual(["cto", "ceo"]);
    expect(chainOf([p("a", "b"), p("b", "a")], "a")).toEqual(["b"]);
  });
});
