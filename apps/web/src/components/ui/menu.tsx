import * as M from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Row actions / overflow menu (Radix: keyboard, focus, collision-aware positioning). */
export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "end" }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={4} collisionPadding={8} className="card elev-md z-50 min-w-[180px] !gap-px !p-1.5">
          {items.map((it, i) => (
            <M.Item
              key={i}
              disabled={it.disabled}
              onSelect={it.onSelect}
              className="cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[13px] outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--tint-1)]"
              style={{ color: it.danger ? "var(--bad)" : "var(--color-text)" }}
            >
              {it.label}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
