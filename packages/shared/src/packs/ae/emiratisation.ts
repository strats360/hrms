import { EMIRATISATION_MIN_EMPLOYEES, EMIRATISATION_TARGETS } from "./rules";

/**
 * Where a UAE company stands against its Emiratisation target on a date: the share of its people
 * who are UAE nationals, the target in force, and how many more nationals it needs.
 */
export function emiratisationStatus(o: { employees: number; nationals: number; on: string }) {
  const applies = o.employees >= EMIRATISATION_MIN_EMPLOYEES;
  const next = EMIRATISATION_TARGETS.find((t) => t.by >= o.on) ?? EMIRATISATION_TARGETS[EMIRATISATION_TARGETS.length - 1]!;
  const current = [...EMIRATISATION_TARGETS].reverse().find((t) => t.by < o.on) ?? null;
  const share = o.employees ? o.nationals / o.employees : 0;
  const needed = (target: number) => Math.max(0, Math.ceil(target * o.employees - o.nationals - 1e-9));
  return {
    applies,
    share,
    /** The target whose deadline has passed: falling short of it can bring fines. */
    current: current ? { ...current, shortfall: applies ? needed(current.share) : 0 } : null,
    /** The next deadline and what it takes to meet it. */
    next: { ...next, shortfall: applies ? needed(next.share) : 0 },
  };
}
