import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildOrgTree } from "@hrms/shared";
import { env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

describe("Org chart", () => {
  it("gives HR everyone currently employed, in one tree", async () => {
    const kunal = await login("kunal.shah@strats360.com");
    const r = await kunal.get("/admin/employees/org-chart");
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe("company");
    const [{ n }] = (await sql`select count(*)::int as n from employees e join tenants t on t.id = e.tenant_id where t.code = 'TN-0142' and e.status not in ('exited','inactive')`) as any;
    expect(r.body.people).toHaveLength(n);
    const roots = buildOrgTree(r.body.people);
    const total = roots.reduce((s, x) => s + 1 + x.teamSize, 0);
    expect(total).toBe(n);
    expect(r.body.people.find((p: any) => p.name === "Priya Vaghela")).toMatchObject({ designation: "Senior Software Engineer", department: "Engineering" });
  });

  it("gives a manager their own branch", async () => {
    const hardik = await login("hardik.mehta@strats360.com");
    const r = (await hardik.get("/admin/employees/org-chart")).body;
    expect(r.scope).toBe("team");
    const roots = buildOrgTree(r.people);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.name).toBe("Hardik Mehta");
    const priya = roots[0]!.children.find((c) => c.name === "Priya Vaghela")!;
    expect(priya).toBeTruthy();
    expect(priya.teamSize).toBeGreaterThan(0); // Priya's own report is included
    expect(r.people.some((p: any) => p.name === "Kunal Shah")).toBe(false);
  });

  it("isn't open to self-service only users", async () => {
    const priya = await login("priya.vaghela@strats360.com");
    expect((await priya.get("/admin/employees/org-chart")).status).toBe(403);
  });
});
