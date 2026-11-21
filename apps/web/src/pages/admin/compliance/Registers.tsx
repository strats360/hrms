import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { fmtMoney, todayLocal } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Loading } from "@/components/ui/page";

const FORMS = {
  A: ["Register of employees", "Everyone employed in the month, with joining, IDs, bank and exit details"],
  B: ["Register of wages", "From the month's approved payroll: days paid, earnings, deductions and net pay"],
  C: ["Register of deductions and recoveries", "Loan and advance recoveries and other deductions in the month's payroll"],
  D: ["Register of attendance", "The muster roll: each day's attendance, leave, holidays and weekly offs"],
  E: ["Register of leave", "Each leave type's opening, credit, leave taken and balance for the year to date"],
} as const;

const lastMonth = () => {
  const [y, m] = todayLocal().split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

interface Figures {
  employees: { atYearEnd: number; women: number; men: number; other: number; averageForYear: number; joined: number; left: number };
  manDaysPaid: number;
  wagesPaid: number;
  employeePf: number;
  tds: number;
  maternityCases: number;
  poshComplaints: number;
  contractWorkers: number;
}

/** The five unified registers and the figures for the unified annual return. */
export default function Registers() {
  const [month, setMonth] = useState(lastMonth());
  const [year, setYear] = useState(Number(todayLocal().slice(0, 4)) - (todayLocal().slice(5, 7) === "01" ? 1 : 0));
  const [busy, setBusy] = useState("");
  const q = useQuery({ queryKey: ["annual-return", year], queryFn: () => api.get<Figures>(`/admin/compliance/registers/annual-return?year=${year}`) });
  const get = async (form: string, format: "xlsx" | "csv") => {
    setBusy(form + format);
    try {
      await download(`/admin/compliance/registers/${form}?month=${month}&format=${format}`, `form-${form.toLowerCase()}-${month}.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy("");
    }
  };
  const f = q.data;
  const lines: [string, string | number][] = f
    ? [
        ["Employees at the year end", `${f.employees.atYearEnd} (${f.employees.women} women, ${f.employees.men} men${f.employees.other ? `, ${f.employees.other} other` : ""})`],
        ["Average employed in the year", f.employees.averageForYear],
        ["Joined and left", `${f.employees.joined} joined, ${f.employees.left} left`],
        ["Man-days paid", f.manDaysPaid.toLocaleString("en-IN")],
        ["Wages paid", fmtMoney(f.wagesPaid)],
        ["Employee PF deducted", fmtMoney(f.employeePf)],
        ["TDS on salary", fmtMoney(f.tds)],
        ["Maternity benefit cases", f.maternityCases],
        ["POSH complaints", f.poshComplaints],
        ["Contract workers engaged", f.contractWorkers],
      ]
    : [];
  return (
    <>
      <Card className="!gap-4">
        <CardHeader title="Statutory registers" sub="The five unified registers, built from your employees, payroll, attendance and leave. Keep them for inspection, in print or electronically." actions={<Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>} />
        {Object.entries(FORMS).map(([k, [title, sub]]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
            <div className="min-w-0">
              <div className="font-semibold">Form {k}: {title}</div>
              <div className="text-muted text-[12.5px]">{sub}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" loading={busy === k + "xlsx"} onClick={() => void get(k, "xlsx")}><Download size={14} /> Excel</Button>
              <Button size="sm" loading={busy === k + "csv"} onClick={() => void get(k, "csv")}>CSV</Button>
            </div>
          </div>
        ))}
      </Card>
      <Card className="!gap-3">
        <CardHeader
          title="Unified annual return"
          sub="The figures the return asks for, from Saralix. File it on the Shram Suvidha portal by 1 February (or your state's portal). Add accidents, safety committee details and anything else Saralix doesn't keep."
          actions={
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {[0, 1, 2].map((n) => { const y = Number(todayLocal().slice(0, 4)) - n; return <option key={y} value={y}>{y}</option>; })}
            </Select>
          }
        />
        {q.isLoading ? <Loading /> : lines.map(([l, v]) => <div key={l} className="flex justify-between gap-3 text-[14px]"><span>{l}</span><b className="num text-right">{v}</b></div>)}
      </Card>
    </>
  );
}
