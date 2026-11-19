import { z } from "zod";
import type { CountryCode } from "./countries";

/**
 * Identity and work documents an employee holds, with the ones that expire tracked and reminded.
 * India's PAN, Aadhaar and UAN stay on the employee record (the India pack reads them); this list
 * is for everything else: passports, visas and residence permits, which matter most in the Gulf.
 * See docs/MULTI_COUNTRY.md.
 */
export interface IdTypeDef {
  key: string;
  label: string;
  /** Countries that issue it. Empty means any country (passports, work permits). */
  countries: CountryCode[];
  expires: boolean;
  /** Days before expiry to remind HR and the employee. */
  remindDays: number;
}

export const ID_TYPES: IdTypeDef[] = [
  { key: "passport", label: "Passport", countries: [], expires: true, remindDays: 180 },
  { key: "residence_visa", label: "Residence visa", countries: [], expires: true, remindDays: 60 },
  { key: "work_permit", label: "Work permit", countries: [], expires: true, remindDays: 60 },
  { key: "emirates_id", label: "Emirates ID", countries: ["AE"], expires: true, remindDays: 30 },
  { key: "labour_card", label: "Labour card", countries: ["AE"], expires: true, remindDays: 30 },
  { key: "mohre_person_id", label: "MOHRE person code", countries: ["AE"], expires: false, remindDays: 0 },
  { key: "health_insurance", label: "Health insurance card", countries: ["AE"], expires: true, remindDays: 30 },
  { key: "iloe", label: "ILOE unemployment insurance", countries: ["AE"], expires: true, remindDays: 30 },
  { key: "iqama", label: "Iqama (residence permit)", countries: ["SA"], expires: true, remindDays: 30 },
  { key: "qid", label: "Qatar ID (QID)", countries: ["QA"], expires: true, remindDays: 30 },
  { key: "civil_id", label: "Civil ID", countries: ["KW"], expires: true, remindDays: 30 },
  { key: "resident_card", label: "Resident card", countries: ["OM"], expires: true, remindDays: 30 },
  { key: "cpr", label: "CPR card", countries: ["BH"], expires: true, remindDays: 30 },
  { key: "ni_number", label: "National Insurance number", countries: ["GB"], expires: false, remindDays: 0 },
  { key: "ssn", label: "Social Security number", countries: ["US"], expires: false, remindDays: 0 },
  { key: "sin", label: "Social Insurance Number (SIN)", countries: ["CA"], expires: false, remindDays: 0 },
  { key: "driving_licence", label: "Driving licence", countries: [], expires: true, remindDays: 30 },
  { key: "other", label: "Other", countries: [], expires: true, remindDays: 30 },
];

export const ID_TYPE_KEYS = ID_TYPES.map((t) => t.key) as [string, ...string[]];
export const idType = (key: string) => ID_TYPES.find((t) => t.key === key) ?? ID_TYPES[ID_TYPES.length - 1]!;

/** Types to offer for an employee of an entity in `country`: that country's own IDs first, then the general ones. */
export function idTypesFor(country: string): IdTypeDef[] {
  return [...ID_TYPES.filter((t) => t.countries.includes(country as CountryCode)), ...ID_TYPES.filter((t) => !t.countries.length)];
}

/** Days until a date, negative once it's past. */
export function daysToExpiry(expiresOn: string, today: string) {
  return Math.round((Date.parse(expiresOn) - Date.parse(today)) / 86_400_000);
}

/** expired, due (inside the reminder window), ok, or none (doesn't expire). */
export function expiryState(t: { type: string; expiresOn: string | null }, today: string): "expired" | "due" | "ok" | "none" {
  if (!t.expiresOn) return "none";
  const d = daysToExpiry(t.expiresOn, today);
  if (d < 0) return "expired";
  return d <= idType(t.type).remindDays ? "due" : "ok";
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const blank = (v: unknown) => (v === "" ? null : v);

export const identitySchema = z
  .object({
    type: z.enum(ID_TYPE_KEYS),
    /** Shown as a label when type is "other". */
    name: z.preprocess(blank, z.string().trim().max(80).nullable().optional()),
    number: z.string().trim().min(2, "Enter the number").max(40),
    issuingCountry: z.preprocess(blank, z.string().regex(/^[A-Z]{2}$/, "Use a 2 letter country code").nullable().optional()),
    issuedOn: z.preprocess(blank, isoDate.nullable().optional()),
    expiresOn: z.preprocess(blank, isoDate.nullable().optional()),
    note: z.preprocess(blank, z.string().trim().max(300).nullable().optional()),
  })
  .superRefine((v, ctx) => {
    if (idType(v.type).expires && !v.expiresOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Add the expiry date" });
    if (v.issuedOn && v.expiresOn && v.expiresOn <= v.issuedOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Expiry must be after the issue date" });
  });
export type IdentityInput = z.infer<typeof identitySchema>;
