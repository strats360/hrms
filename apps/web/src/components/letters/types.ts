export interface Template {
  id: string;
  name: string;
  body: string;
  builtIn?: boolean;
  edited?: boolean;
}
export interface LetterSettings {
  signatoryName: string | null;
  signatoryTitle: string | null;
}
export interface Preview {
  title: string;
  text: string;
  missing: string[];
  unknown: string[];
  salaryTable: { label: string; monthly: number; strong?: boolean }[] | null;
  salaryHidden: boolean;
  salaryMissing: boolean;
}
