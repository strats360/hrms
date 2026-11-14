import { useEffect, useState } from "react";
import { Dialog } from "./dialog";
import { Button } from "./button";

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Label on the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deleting or anything that can't be undone. */
  danger?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

/**
 * Themed replacement for window.confirm. Resolves true when the person confirms.
 * Needs <ConfirmHost /> mounted once at the app root.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    show = (p) => {
      setCurrent((prev) => {
        prev?.resolve(false);
        return p;
      });
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && close(false)}
      title={current?.title ?? ""}
      description={current?.body}
      width={440}
      footer={
        <>
          <Button onClick={() => close(false)}>{current?.cancelLabel ?? "Cancel"}</Button>
          <Button variant={current?.danger ? "danger" : "primary"} autoFocus onClick={() => close(true)}>
            {current?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    />
  );
}
