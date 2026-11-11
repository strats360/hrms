import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { usePhotos } from "@/lib/photos";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const SIZE = 320;

/** Crop to the centre square and shrink, in the browser, so uploads stay small. */
async function squarePhoto(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error("Choose a JPG, PNG or WebP image");
  if (file.size > 20 * 1024 * 1024) throw new Error("That image is too large. Choose one under 20 MB.");
  const img = await createImageBitmap(file).catch(() => {
    throw new Error("We couldn't read that image. Try a JPG or PNG.");
  });
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(SIZE, side);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  img.close();
  const as = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
  // WebP where the browser can write it (Safari can't), JPEG otherwise
  const webp = await as("image/webp");
  const blob = webp && webp.type === "image/webp" ? webp : await as("image/jpeg");
  if (!blob) throw new Error("We couldn't process that image");
  return blob;
}

/** Photo with change and remove buttons. `endpoint` is the employee's photo URL (self-service or admin). */
export function PhotoEditor({ employeeId, name, endpoint, size = 88, canEdit = true }: { employeeId: string; name: string; endpoint: string; size?: number; canEdit?: boolean }) {
  const qc = useQueryClient();
  const photos = usePhotos();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const has = !!photos.data?.[employeeId];
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["photos"] });
  };
  const remove = useMutation({ mutationFn: () => api.del(endpoint), onSuccess: () => done("Photo removed"), onError: (e) => toast.error(errorMessage(e)) });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await squarePhoto(file);
      const fd = new FormData();
      fd.append("file", new File([blob], `photo.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type }));
      await api.upload(endpoint, fd);
      done("Photo updated");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <Avatar employeeId={employeeId} name={name} size={size} tone="sel" />
        {canEdit ? (
          <button
            type="button"
            aria-label={has ? "Change photo" : "Add photo"}
            title={has ? "Change photo" : "Add photo"}
            disabled={busy}
            onClick={() => input.current?.click()}
            className="absolute -bottom-0.5 -right-0.5 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-accent)] text-[#161826] disabled:opacity-60"
          >
            <Camera size={15} />
          </button>
        ) : null}
      </div>
      {canEdit && has ? (
        <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
          <Trash2 size={13} /> Remove photo
        </Button>
      ) : null}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-hidden tabIndex={-1} />
    </div>
  );
}
