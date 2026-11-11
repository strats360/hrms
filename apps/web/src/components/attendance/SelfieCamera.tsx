import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, MapPin, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Loc = { lat: number; lng: number; accuracy: number } | undefined;
const SIZE = 480;

/**
 * Front-camera selfie for a punch. Full screen on phones, a panel on larger screens.
 * The photo is a square JPEG of about 480 px (roughly 30 to 60 KB).
 */
export function SelfieCamera({ action, required, location, onCapture, onSkip, onClose }: { action: string; required: boolean; location: { state: "finding" | "found" | "none"; loc?: Loc }; onCapture: (dataUrl: string) => void; onSkip: () => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const start = async () => {
    setError(null);
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here. Open the app over https in Chrome or Safari.");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play().catch(() => {});
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Camera access is blocked. Allow it for this site in your browser settings, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No camera was found on this device."
            : "The camera couldn't start. Close other apps using it and try again.",
      );
    }
  };
  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => {
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    setShot(canvas.toDataURL("image/jpeg", 0.72));
    stop();
  };
  const retake = () => {
    setShot(null);
    void start();
  };
  const close = () => {
    stop();
    onClose();
  };

  const loc = location.state === "found" && location.loc ? `Location found (within ${Math.max(5, Math.round(location.loc.accuracy))} m)` : location.state === "finding" ? "Finding your location…" : "Location not available";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Selfie to ${action.toLowerCase()}`}>
      <div className="flex w-full flex-col bg-[var(--color-surface)] text-[var(--color-text)] sm:max-w-[420px] sm:rounded-[var(--radius-lg,14px)] sm:shadow-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-[16px] font-medium">Selfie to {action.toLowerCase()}</div>
          <Button icon variant="ghost" aria-label="Close" onClick={close}>
            <X size={18} />
          </Button>
        </div>
        <div className="relative mx-4 aspect-square overflow-hidden rounded-[var(--radius-md)] bg-black">
          {shot ? (
            <img src={shot} alt="Your selfie" className="h-full w-full object-cover" />
          ) : (
            <video ref={video} playsInline muted onLoadedData={() => setReady(true)} className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
          )}
          {!shot && !error ? <div className="pointer-events-none absolute inset-[12%] rounded-full border-2 border-white/60" aria-hidden /> : null}
          {error ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-white">{error}</div> : null}
        </div>
        <div className="text-muted flex items-center gap-1.5 px-4 pt-3 text-[12.5px]">
          <MapPin size={14} /> {loc}
        </div>
        <div className="text-muted px-4 pt-1 text-[12px]">Your selfie and location are shared with HR and your manager, and deleted after a while.</div>
        <div className="mt-auto flex flex-col gap-2 p-4 sm:mt-0">
          {shot ? (
            <>
              <Button variant="primary" block onClick={() => onCapture(shot)}>
                Use photo and {action.toLowerCase()}
              </Button>
              <Button block onClick={retake}>
                <RefreshCw size={15} /> Retake
              </Button>
            </>
          ) : error ? (
            <Button block onClick={() => void start()}>
              Try again
            </Button>
          ) : (
            <Button variant="primary" block disabled={!ready} onClick={take}>
              <Camera size={16} /> Take photo
            </Button>
          )}
          {!required ? (
            <Button variant="ghost" block onClick={() => (stop(), onSkip())}>
              {action} without a photo
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
