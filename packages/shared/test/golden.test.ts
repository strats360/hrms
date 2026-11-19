import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACK_CODES } from "../src/packs";
import { figures, run, type GoldenFile } from "../golden/golden";

/**
 * Golden payroll: every country pack must have real payslip cases, and every figure must come
 * out the same. A difference means pay changed for that country: if that's intended (a new law),
 * regenerate with `pnpm --filter @hrms/shared golden`, review, and get it signed off again.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");
const MIN_CASES = 5;

describe("golden payroll", () => {
  for (const code of PACK_CODES) {
    describe(code, () => {
      const path = join(dir, `${code}.json`);
      it(`has at least ${MIN_CASES} cases`, () => {
        expect(existsSync(path), `golden/${code}.json is missing. Every country pack needs golden payslip cases.`).toBe(true);
        const file = JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
        expect(file.country).toBe(code);
        expect(file.cases.length).toBeGreaterThanOrEqual(MIN_CASES);
        if (!file.signedOff.by) console.warn(`golden/${code}.json isn't signed off by a payroll expert yet.`);
      });
      if (!existsSync(path)) return;
      const file = JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
      for (const c of file.cases) {
        it(c.name, () => {
          expect(c.expect, `${c.name} has no expected figures. Run pnpm --filter @hrms/shared golden.`).toBeTruthy();
          expect(figures(run(code, c))).toEqual(c.expect);
        });
      }
    });
  }
});
