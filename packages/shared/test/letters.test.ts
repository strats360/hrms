import { describe, expect, it } from "vitest";
import { BUILT_IN_LETTERS, LETTER_FIELDS, letterBlocks, pronouns, renderLetter } from "../src/letters";

describe("letters", () => {
  it("fills in fields and lists what's missing or unknown", () => {
    const r = renderLetter("Dear {{employee.name}}, you join on {{ employee.joining_date }}. {{employee.pan}} {{nope.x}}", { "employee.name": "Priya Vaghela", "employee.joining_date": "02 Jan 2022" });
    expect(r.text).toBe("Dear Priya Vaghela, you join on 02 Jan 2022. [PAN] {{nope.x}}");
    expect(r.missing).toEqual(["employee.pan"]);
    expect(r.unknown).toEqual(["nope.x"]);
  });
  it("uses pronouns from the gender on record", () => {
    expect(pronouns("Female")).toMatchObject({ "employee.title": "Ms.", "employee.He_She": "She", "employee.him_her": "her" });
    expect(pronouns("male")["employee.his_her"]).toBe("his");
    expect(pronouns(null)).toMatchObject({ "employee.he_she": "they", "employee.His_Her": "Their", "employee.title": "Mx." });
  });
  it("splits a letter into headings, paragraphs and the salary table", () => {
    expect(letterBlocks("# Offer\n\nDear X,\nline two\n\n{{salary_table}}\n\nThanks")).toEqual([
      { kind: "heading", text: "Offer" },
      { kind: "paragraph", text: "Dear X,\nline two" },
      { kind: "salary_table" },
      { kind: "paragraph", text: "Thanks" },
    ]);
  });
  it("only uses known fields in the built-in templates", () => {
    for (const t of BUILT_IN_LETTERS) expect(renderLetter(t.body, {}).unknown, t.name).toEqual([]);
    expect(new Set(LETTER_FIELDS.map((f) => f.key)).size).toBe(LETTER_FIELDS.length);
    for (const t of BUILT_IN_LETTERS) expect(t.body, t.name).not.toMatch(/—/);
  });
});
