import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 520, className }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: number; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="dialog-backdrop" style={{ zIndex: 40 }} />
        <D.Content
          className={cn("dialog fixed left-1/2 top-1/2 max-h-[92vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto", className)}
          style={{ width: `min(${width}px, calc(100vw - 32px))`, zIndex: 41, padding: 22 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <D.Title className="dialog-title">{title}</D.Title>
              {description ? <D.Description className="text-muted mt-1 text-[13px]">{description}</D.Description> : <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>}
            </div>
            <D.Close className="btn btn-ghost btn-icon !h-8 !w-8 !text-[var(--color-text)]" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          {children ? <div className="flex flex-col gap-3">{children}</div> : null}
          {footer ? <div className="dialog-actions">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
