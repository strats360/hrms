import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rupee amount input that keeps a number in state and shows an empty box for 0. */
export function MoneyInput({ value, onChange, disabled, id, placeholder = "0" }: { value: number | undefined; onChange: (v: number) => void; disabled?: boolean; id?: string; placeholder?: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => {
    const n = Number(text.replace(/[,₹\s]/g, "")) || 0;
    if (n !== (value ?? 0)) setText(value ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: "var(--muted)" }}>
        ₹
      </span>
      <input
        id={id}
        className="input !pl-6 num"
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d]/g, "");
          setText(t);
          onChange(Number(t) || 0);
        }}
      />
    </div>
  );
}

/** A collapsible-looking group for one tax section. */
export function SectionCard({ title, hint, children, dimmed, badge }: { title: ReactNode; hint?: ReactNode; children: ReactNode; dimmed?: boolean; badge?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-[var(--radius-md)] p-4 transition-opacity", dimmed && "opacity-55")} style={{ background: "var(--tint-1)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {hint ? <div className="text-muted text-[12.5px]">{hint}</div> : null}
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

export const grid2 = "grid gap-3 grid-cols-1 sm:grid-cols-2";
