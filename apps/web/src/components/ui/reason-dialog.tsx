import { useState } from "react";
import { Dialog } from "./dialog";
import { Button } from "./button";
import { Field, Textarea } from "./field";

/** Reject-with-reason modal used by every approval queue. */
export function ReasonDialog({ open, onOpenChange, title, onConfirm, confirmLabel = "Reject", required = true }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; onConfirm: (reason: string) => Promise<void> | void; confirmLabel?: string; required?: boolean }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setReason("");
        onOpenChange(v);
      }}
      title={title}
      description="The employee will see this reason."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={required && !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Reason">
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: release planned that week, please pick another day" maxLength={500} />
      </Field>
    </Dialog>
  );
}
