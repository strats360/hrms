import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/Header";

/** Split-screen frame for sign-in pages (left brand panel from the design). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <div className="hidden flex-col justify-between p-12 lg:flex" style={{ background: "var(--color-section)", color: "var(--color-neutral-100)" }}>
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] text-[20px] font-semibold" style={{ background: "var(--color-accent)", color: "#161826" }}>
            S
          </div>
          <div className="text-[22px] font-medium">Strats360 People</div>
        </div>
        <div className="max-w-[520px]">
          <h1 className="!mb-4 text-[44px]" style={{ color: "var(--color-neutral-100)" }}>
            Payroll, compliance and people in one calm workspace.
          </h1>
          <p className="!m-0 text-[17px] leading-relaxed opacity-85">EPF, ESI, PT, TDS and bank files handled end to end for Indian establishments. Built for HR teams that would rather not live in spreadsheets.</p>
        </div>
        <div className="flex gap-7 text-[13px] opacity-80">
          <div>Data stored in India</div>
          <div>DPDP Act ready</div>
          <div>Role-based access</div>
        </div>
      </div>
      <div className="relative grid place-items-center p-6 sm:p-12">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>
        {children}
      </div>
    </div>
  );
}
