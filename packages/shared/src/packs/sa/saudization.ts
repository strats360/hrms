import { NITAQAT } from "./rules";

/**
 * A company's Saudization share for Nitaqat: Saudis paid at least SAR 4,000 count as one, those
 * paid 3,000 to 4,000 as half, and those paid less don't count. The band itself depends on the
 * activity and size, so it's left to Qiwa.
 */
export function saudizationStatus(o: { employees: number; saudiWages: number[] }) {
  const counted = o.saudiWages.reduce((s, w) => s + (w >= NITAQAT.fullCountWage ? 1 : w >= NITAQAT.halfCountWage ? 0.5 : 0), 0);
  return {
    nationals: o.saudiWages.length,
    counted,
    share: o.employees ? counted / o.employees : 0,
    belowFullWage: o.saudiWages.filter((w) => w < NITAQAT.fullCountWage).length,
  };
}
