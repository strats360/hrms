import * as P from "@radix-ui/react-popover";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickOption {
  value: string;
  label: string;
  /** Shown muted after the label and matched by search, e.g. an employee code. */
  hint?: string;
  /** Options with the same group are listed under that heading. */
  group?: string;
}

const LIMIT = 100;

export function matches(o: PickOption, q: string) {
  const hay = `${o.label} ${o.hint ?? ""}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * A select with a search box, for long lists such as employees or managers.
 * `emptyLabel` adds a first option with value "" (for "None", "Nobody yet" and so on)
 * and lets the person clear the choice.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
  emptyLabel,
  searchPlaceholder = "Type to search",
  disabled,
  invalid,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const all = useMemo(() => options.filter((o) => !q.trim() || matches(o, q)), [options, q]);
  const shown = useMemo(() => {
    const list = all.slice(0, LIMIT);
    return emptyLabel && !q.trim() ? [{ value: "", label: emptyLabel }, ...list] : list;
  }, [all, emptyLabel, q]);

  const openWith = (text = "") => {
    setQ(text);
    const at = shown.findIndex((o) => o.value === value);
    setActive(text ? 0 : Math.max(0, at));
    setOpen(true);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const move = (to: number) => {
    const n = Math.max(0, Math.min(shown.length - 1, to));
    setActive(n);
    listRef.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), move(active + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), move(active - 1));
    else if (e.key === "Home") (e.preventDefault(), move(0));
    else if (e.key === "End") (e.preventDefault(), move(shown.length - 1));
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o.value);
    }
  };

  let lastGroup: string | undefined;
  return (
    <P.Root open={open} onOpenChange={(v) => (v ? openWith() : setOpen(false))}>
      <div className={cn("relative min-w-0", className)}>
        <P.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            className={cn("input flex w-full items-center gap-2 text-left", emptyLabel && selected && !disabled && "pr-14", disabled && "cursor-not-allowed opacity-60")}
            onKeyDown={(e) => {
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
                e.preventDefault();
                openWith(e.key);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                openWith();
              }
            }}
          >
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted")}>
              {selected ? (
                <>
                  {selected.label}
                  {selected.hint ? <span className="text-muted"> · {selected.hint}</span> : null}
                </>
              ) : (
                (emptyLabel ?? placeholder)
              )}
            </span>
            <ChevronDown size={15} className="text-muted shrink-0" />
          </button>
        </P.Trigger>
        {emptyLabel && selected && !disabled ? (
          <button type="button" aria-label="Clear" className="text-muted absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 hover:text-[var(--color-text)]" onClick={() => onChange("")}>
            <X size={14} />
          </button>
        ) : null}
      </div>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className="card elev-md z-50 flex flex-col overflow-hidden !gap-0 !p-0"
          style={{ width: "max(var(--radix-popover-trigger-width), 260px)", maxWidth: "calc(100vw - 24px)", maxHeight: "min(360px, var(--radix-popover-content-available-height))" }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <Search size={14} className="text-muted shrink-0" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={id ? `${id}-list` : undefined}
              aria-activedescendant={shown[active] ? `${id ?? "pick"}-o-${active}` : undefined}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
            />
          </div>
          <div ref={listRef} id={id ? `${id}-list` : undefined} role="listbox" className="overflow-y-auto py-1">
            {shown.length === 0 ? <div className="text-muted px-3 py-3 text-[13px]">No matches for "{q.trim()}"</div> : null}
            {shown.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value || "__empty"}>
                  {heading ? <div className="text-muted px-3 pb-1 pt-2 text-[11.5px] font-medium uppercase tracking-wide">{heading}</div> : null}
                  <div
                    id={`${id ?? "pick"}-o-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={o.value === value}
                    className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13.5px]", i === active && "bg-[var(--tint-1)]", o.value === "" && "text-muted")}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => pick(o.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {o.label}
                      {o.hint ? <span className="text-muted"> · {o.hint}</span> : null}
                    </span>
                    {o.value === value ? <Check size={14} className="shrink-0" /> : null}
                  </div>
                </div>
              );
            })}
            {all.length > LIMIT ? <div className="text-muted px-3 py-2 text-[12px]">Showing {LIMIT} of {all.length}. Keep typing to narrow it down.</div> : null}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
