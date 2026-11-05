import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, error, hint, children, className, htmlFor, span }: { label?: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; span?: boolean }) {
  const auto = useId();
  // Link the label to a single control child (Input/Select/Textarea or a native control) when no id was given.
  const el = isValidElement<{ id?: string }>(children) ? children : null;
  const isControl = !!el && (typeof el.type !== "string" || ["input", "select", "textarea"].includes(el.type));
  const id = htmlFor ?? (isControl ? (el!.props.id ?? auto) : undefined);
  const content = isControl && !htmlFor && !el!.props.id ? cloneElement(el!, { id }) : children;
  return (
    <div className={cn("field min-w-0", span && "col-span-full", className)}>
      {label ? <label htmlFor={id}>{label}</label> : null}
      {content}
      {error ? (
        <div role="alert" className="mt-1 text-[12px]" style={{ color: "var(--bad)" }}>
          {error}
        </div>
      ) : hint ? (
        <div className="text-muted mt-1 text-[12px]">{hint}</div>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...p }, ref) {
  return <input ref={ref} className={cn("input", className)} aria-invalid={invalid || undefined} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn("input", className)} aria-invalid={invalid || undefined} {...p}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn("input", className)} {...p} />;
});

export function Checkbox({ checked, onChange, label, indeterminate, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <label className={cn("check", disabled && "pointer-events-none opacity-45", className)} htmlFor={id} onClick={(e) => e.stopPropagation()}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="box" />
      {label}
    </label>
  );
}

/** Segmented control (status filters, view switches). */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cn("inline-flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-divider)]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="cursor-pointer whitespace-nowrap border-0 px-3.5 py-2 text-[13px] hover:bg-[var(--tint-1)]"
          style={{ background: value === o.value ? "var(--sel-bg)" : "transparent", color: value === o.value ? "var(--sel-fg)" : "var(--color-text)" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
