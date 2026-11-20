import { useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { computeTaxStatement, fmtMoney, fyOfMonth, taxForms, todayLocal, type TaxDeclarationData } from "@hrms/shared";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";

/**
 * Free calculators anyone can use without signing in: income tax under both regimes, and
 * gratuity under the Code on Social Security. They run in the browser on the same rules Saralix
 * payroll uses.
 */
export default function Tools() {
  const { tool = "income-tax" } = useParams();
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[22px] font-semibold">Free payroll calculators</div>
            <div className="text-muted text-[13.5px]">Indian income tax and gratuity, on the rules Saralix payroll uses. Nothing you type leaves your browser.</div>
          </div>
          <Link to="/login" className="btn">Sign in to Saralix</Link>
        </div>
        <div className="flex gap-2">
          <NavLink to="/tools/income-tax" className={({ isActive }) => `btn ${isActive ? "btn-primary" : ""}`}>Income tax</NavLink>
          <NavLink to="/tools/gratuity" className={({ isActive }) => `btn ${isActive ? "btn-primary" : ""}`}>Gratuity</NavLink>
        </div>
        {tool === "gratuity" ? <GratuityCalculator /> : <TaxCalculator />}
        <div className="text-muted text-[12px]">These are estimates for planning, not tax or legal advice. Check your figures with your employer or a tax advisor.</div>
      </div>
    </div>
  );
}

const num = (s: string) => Math.max(0, Number(s.replace(/[,₹\s]/g, "")) || 0);

function Money({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
    </Field>
  );
}

function TaxCalculator() {
  const currentFy = fyOfMonth(todayLocal().slice(0, 7));
  const [fy, setFy] = useState(currentFy);
  const [f, setF] = useState({ gross: "1200000", basic: "600000", hra: "240000", pf: "72000", pt: "2400", rent: "0", metro: false, c80: "150000", d80: "25000", nps: "0", homeLoan: "0", other: "0" });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const result = useMemo(() => {
    const declaration: TaxDeclarationData = {
      rent: num(f.rent) ? { monthlyRent: num(f.rent) / 12, months: 12, metro: f.metro } : undefined,
      sec80C: { other: num(f.c80) },
      sec80D: { self: num(f.d80) },
      sec80CCD1B: num(f.nps),
      homeLoanInterest: num(f.homeLoan),
      otherIncome: num(f.other),
    };
    const run = (regime: "new" | "old") =>
      computeTaxStatement({ regime, financialYear: fy, salary: { gross: num(f.gross), basic: num(f.basic), hra: num(f.hra) }, employeePf: num(f.pf), professionalTax: num(f.pt), declaration });
    return { new: run("new"), old: run("old") };
  }, [f, fy]);
  const better = result.new.tax.total <= result.old.tax.total ? "new" : "old";
  const saving = Math.abs(result.new.tax.total - result.old.tax.total);
  const prev = `${Number(currentFy.slice(0, 4)) - 1}-${currentFy.slice(2, 4)}`;
  return (
    <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
      <Card className="!gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax year">
            <Select value={fy} onChange={(e) => setFy(e.target.value)}>
              <option value={currentFy}>{currentFy}</option>
              <option value={prev}>{prev}</option>
            </Select>
          </Field>
          <Money label="Annual gross salary" value={f.gross} onChange={set("gross")} />
          <Money label="Annual basic" value={f.basic} onChange={set("basic")} hint="For the HRA exemption" />
          <Money label="Annual HRA received" value={f.hra} onChange={set("hra")} />
          <Money label="Your PF for the year" value={f.pf} onChange={set("pf")} />
          <Money label="Professional tax for the year" value={f.pt} onChange={set("pt")} />
          <Money label="Rent paid in the year" value={f.rent} onChange={set("rent")} />
          <Money label="80C investments" value={f.c80} onChange={set("c80")} hint="Up to ₹1,50,000" />
          <Money label="80D health insurance" value={f.d80} onChange={set("d80")} />
          <Money label="NPS, 80CCD(1B)" value={f.nps} onChange={set("nps")} hint="Up to ₹50,000" />
          <Money label="Home loan interest" value={f.homeLoan} onChange={set("homeLoan")} hint="Up to ₹2,00,000" />
          <Money label="Other income" value={f.other} onChange={set("other")} />
        </div>
        <Checkbox checked={f.metro} onChange={set("metro")} label="I rent in a city where HRA is 50% of basic" />
      </Card>
      <div className="flex flex-col gap-3">
        <Notice tone="ok">
          The <strong>{better} regime</strong> is better for you{saving ? `, by ${fmtMoney(saving)} a year` : ""}.
        </Notice>
        {(["new", "old"] as const).map((r) => {
          const s = result[r];
          return (
            <Card key={r} className="!gap-1.5">
              <div className="card-title">{r === "new" ? "New regime" : "Old regime"}</div>
              <Line label="Gross salary" v={s.grossSalary} />
              {s.exemptions.map((x) => <Line key={x.key} label={x.label} v={-x.amount} />)}
              <Line label="Standard deduction" v={-s.standardDeduction} />
              {s.deductions.map((x) => <Line key={x.key} label={x.label} v={-x.amount} />)}
              <Line label="Taxable income" v={s.taxableIncome} strong />
              <Line label="Tax including cess" v={s.tax.total} strong />
              <Line label="About a month" v={Math.round(s.tax.total / 12)} />
            </Card>
          );
        })}
        <div className="text-muted text-[12px]">
          From tax year 2026-27 the Income Tax Act 2025 applies: your employer reports salary TDS on {taxForms(fy).quarterly} and gives you {taxForms(fy).certificate}.
        </div>
      </div>
    </div>
  );
}

function Line({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-[13.5px] ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="num">{v < 0 ? `−${fmtMoney(-v)}` : fmtMoney(v)}</span>
    </div>
  );
}

/** Gratuity under the Code on Social Security: 15/26 of monthly wages per completed year, at most ₹20 lakh. */
function GratuityCalculator() {
  const [wages, setWages] = useState("50000");
  const [from, setFrom] = useState("2019-04-01");
  const [to, setTo] = useState(todayLocal());
  const [fixedTerm, setFixedTerm] = useState(false);
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const years = days / 365.25;
  const whole = Math.floor(years);
  const counted = fixedTerm ? Math.round(years * 100) / 100 : whole + (years - whole > 0.5 ? 1 : 0);
  const eligible = fixedTerm ? days >= 365 : days >= 5 * 365;
  const raw = (15 / 26) * num(wages) * counted;
  const amount = eligible ? Math.min(2000000, Math.round(raw)) : 0;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="!gap-3">
        <Money label="Last monthly wages" value={wages} onChange={setWages} hint="Basic plus DA, and at least half your gross pay under the Labour Codes" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Joined on"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Last working day"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Checkbox checked={fixedTerm} onChange={setFixedTerm} label="Fixed term employee (gratuity after one year, pro rata)" />
      </Card>
      <Card className="!gap-2">
        <div className="card-kicker">Gratuity</div>
        <div className="stat-value">{fmtMoney(amount)}</div>
        <div className="text-muted text-[13px]">
          {eligible
            ? `15/26 × ${fmtMoney(num(wages))} × ${counted} year${counted === 1 ? "" : "s"}${raw > 2000000 ? ", capped at ₹20 lakh" : ""}. Your employer must pay it within 30 days.`
            : fixedTerm
              ? "Fixed term employees qualify after a year of service."
              : `You need five years of continuous service (you have ${years.toFixed(1)}), unless you leave because of death or disablement. Some courts count 4 years and 240 days as five.`}
        </div>
      </Card>
    </div>
  );
}
