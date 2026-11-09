import { fmtDate, inr, rupeesInWords } from "@hrms/shared";

export interface Company {
  name: string;
  legalName: string | null;
  registeredAddress: string | null;
}
export interface FnfLine {
  key: string;
  label: string;
  kind: "earning" | "deduction";
  amount: number;
  note?: string;
}
export interface LetterExit {
  code: string;
  type: string;
  typeLabel: string;
  resignationDate: string;
  lastWorkingDay: string;
  settledOn: string | null;
  settlementMethod: string | null;
  settlementReference: string | null;
  settlement: { lines: FnfLine[]; earnings: number; deductions: number; net: number; service: { years: number; completedYears: number }; notice: { required: number; served: number; shortfall: number } } | null;
  employee: { name: string; code: string; designation: string | null; department: string | null; dateOfJoining: string; pan: string | null; uan: string | null };
}

const today = () => new Date().toISOString().slice(0, 10);

function Letterhead({ company, kicker }: { company: Company; kicker: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-divider)] pb-3">
      <div>
        <div className="text-[20px] font-medium">{company.legalName ?? company.name}</div>
        {company.registeredAddress ? <div className="text-muted max-w-[420px] text-[12px]">{company.registeredAddress}</div> : null}
      </div>
      <div className="card-kicker">{kicker}</div>
    </div>
  );
}

function Signature({ company }: { company: Company }) {
  return (
    <div className="mt-10 text-[13px]">
      <div>For {company.legalName ?? company.name}</div>
      <div className="mt-12 border-t border-[var(--color-divider)] pt-1 sm:w-[220px]">Authorised signatory</div>
    </div>
  );
}

/** The full and final settlement statement, for the employee to sign. */
export function SettlementStatement({ company, exit }: { company: Company; exit: LetterExit }) {
  const s = exit.settlement;
  if (!s) return null;
  const e = exit.employee;
  const earn = s.lines.filter((l) => l.kind === "earning");
  const ded = s.lines.filter((l) => l.kind === "deduction");
  const Table = ({ title, lines, total }: { title: string; lines: FnfLine[]; total: number }) => (
    <div>
      <div className="mb-1 font-medium">{title}</div>
      <table className="w-full text-[13px]">
        <tbody>
          {lines.length ? (
            lines.map((l) => (
              <tr key={l.key} className="border-b border-[var(--color-divider)]">
                <td className="py-1.5 pr-2">
                  {l.label}
                  {l.note ? <div className="text-muted text-[11.5px]">{l.note}</div> : null}
                </td>
                <td className="num py-1.5 text-right">{inr(l.amount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="text-muted py-1.5">None</td>
            </tr>
          )}
          <tr className="font-medium">
            <td className="py-1.5">Total</td>
            <td className="num py-1.5 text-right">{inr(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="flex flex-col gap-4 text-[13.5px]">
      <Letterhead company={company} kicker="Full and final settlement" />
      <div className="grid gap-2 rounded-[var(--radius-md)] px-3.5 py-3 text-[12.5px] sm:grid-cols-3" style={{ background: "var(--tint-1)" }}>
        <Info label="Employee" value={`${e.name} (${e.code})`} />
        <Info label="Designation" value={[e.designation, e.department].filter(Boolean).join(", ") || "—"} />
        <Info label="PAN · UAN" value={`${e.pan ?? "—"} · ${e.uan ?? "—"}`} />
        <Info label="Date of joining" value={fmtDate(e.dateOfJoining)} />
        <Info label="Last working day" value={fmtDate(exit.lastWorkingDay)} />
        <Info label="Reason for leaving" value={exit.typeLabel} />
        <Info label="Service" value={`${s.service.years} years`} />
        <Info label="Notice" value={`${s.notice.served} of ${s.notice.required} days served`} />
        <Info label="Reference" value={exit.code} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Table title="Amounts payable" lines={earn} total={s.earnings} />
        <Table title="Recoveries and deductions" lines={ded} total={s.deductions} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-3.5 py-3" style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }}>
        <div className="font-medium">{s.net >= 0 ? "Net amount payable to the employee" : "Net amount recoverable from the employee"}</div>
        <div className="num text-[18px] font-semibold">{inr(Math.abs(s.net))}</div>
        <div className="w-full text-[12px]">{rupeesInWords(Math.abs(s.net))}</div>
      </div>
      <div className="text-muted text-[12px]">The salary for the last month is paid separately through payroll, up to the last working day.{exit.settledOn ? ` Settled on ${fmtDate(exit.settledOn)}${exit.settlementReference ? `, reference ${exit.settlementReference}` : ""}.` : ""}</div>
      <div className="mt-6 grid gap-8 text-[13px] sm:grid-cols-2">
        <div>
          <div>For {company.legalName ?? company.name}</div>
          <div className="mt-12 border-t border-[var(--color-divider)] pt-1 sm:w-[220px]">Authorised signatory</div>
        </div>
        <div>
          <div>I have received the above amount in full and final settlement of my dues, and have no further claims on the company.</div>
          <div className="mt-8 border-t border-[var(--color-divider)] pt-1 sm:w-[220px]">{e.name} · Date</div>
        </div>
      </div>
    </div>
  );
}

export function RelievingLetter({ company, exit }: { company: Company; exit: LetterExit }) {
  const e = exit.employee;
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-relaxed">
      <Letterhead company={company} kicker="Relieving letter" />
      <div className="flex justify-between text-[13px]">
        <span>Ref: {exit.code}</span>
        <span>{fmtDate(today())}</span>
      </div>
      <div>
        <div className="font-medium">{e.name}</div>
        <div className="text-muted text-[13px]">Employee ID {e.code}</div>
      </div>
      <p>Dear {e.name.split(" ")[0]},</p>
      <p>
        {exit.type === "resignation"
          ? `This is to confirm that your resignation dated ${fmtDate(exit.resignationDate)} was accepted, and that you have been relieved of your duties as ${e.designation ?? "an employee"} with effect from the close of business on ${fmtDate(exit.lastWorkingDay)}.`
          : `This is to confirm that you have been relieved of your duties as ${e.designation ?? "an employee"} with effect from the close of business on ${fmtDate(exit.lastWorkingDay)}.`}
      </p>
      <p>Your full and final settlement has been completed{exit.settledOn ? ` on ${fmtDate(exit.settledOn)}` : ""}. We confirm that you have handed over your responsibilities and company property.</p>
      <p>We thank you for your contribution and wish you success in the future.</p>
      <Signature company={company} />
    </div>
  );
}

export function ExperienceLetter({ company, exit }: { company: Company; exit: LetterExit }) {
  const e = exit.employee;
  return (
    <div className="flex flex-col gap-4 text-[14px] leading-relaxed">
      <Letterhead company={company} kicker="Experience certificate" />
      <div className="flex justify-between text-[13px]">
        <span>Ref: {exit.code}</span>
        <span>{fmtDate(today())}</span>
      </div>
      <p className="font-medium">To whom it may concern</p>
      <p>
        This is to certify that {e.name} (employee ID {e.code}) worked with {company.legalName ?? company.name} from {fmtDate(e.dateOfJoining)} to {fmtDate(exit.lastWorkingDay)}
        {e.designation ? `, and held the position of ${e.designation}${e.department ? ` in ${e.department}` : ""} at the time of leaving` : ""}.
      </p>
      <p>We wish {e.name.split(" ")[0]} every success in their future career.</p>
      <Signature company={company} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted text-[11.5px]">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
