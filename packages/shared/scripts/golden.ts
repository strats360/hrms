/**
 * Fill in or refresh the expected figures in golden/<COUNTRY>.json from the engine.
 *
 *   pnpm --filter @hrms/shared golden            refresh every pack's file
 *   pnpm --filter @hrms/shared golden -- IN      just India
 *
 * Prints every figure that changed. A changed file loses its sign off: review the differences,
 * then have the country's payroll expert check and sign it again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_CODES } from "../src/packs";
import type { CountryCode } from "../src/countries";
import { figures, run, type GoldenFile } from "../golden/golden";

const only = process.argv.slice(2).filter((a): a is CountryCode => (PACK_CODES as string[]).includes(a));
for (const code of only.length ? only : PACK_CODES) {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "golden", `${code}.json`);
  const file = JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
  let changed = 0;
  for (const c of file.cases) {
    const next = figures(run(code, c));
    const before = c.expect ? JSON.stringify(c.expect) : null;
    if (before !== JSON.stringify(next)) {
      changed++;
      console.log(`${code} · ${c.name}: ${before ? "changed" : "filled in"}`);
      if (c.expect) {
        const keys = new Set([...Object.keys(c.expect.lines), ...Object.keys(next.lines)]);
        for (const k of ["gross", "totalDeductions", "net", "tds", "employerCost"] as const) if (c.expect[k] !== next[k]) console.log(`    ${k}: ${c.expect[k]} → ${next[k]}`);
        for (const k of keys) if (c.expect.lines[k] !== next.lines[k]) console.log(`    ${k}: ${c.expect.lines[k] ?? "none"} → ${next.lines[k] ?? "none"}`);
      }
      c.expect = next;
    }
  }
  if (changed && file.signedOff.by) {
    console.log(`${code}: figures changed, so the sign off by ${file.signedOff.by} is cleared. Get them checked again.`);
    file.signedOff = { by: null, on: null, note: file.signedOff.note };
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log(`${code}: ${file.cases.length} cases, ${changed} updated`);
}
