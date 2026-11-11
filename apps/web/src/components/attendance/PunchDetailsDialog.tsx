import { useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { getActiveTenant } from "@/lib/api";
import { Dialog } from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";

export interface PunchInfo {
  recordId: string;
  inLat: number | null;
  inLng: number | null;
  outLat: number | null;
  outLng: number | null;
  distanceM: number | null;
  inSelfie: boolean;
  outSelfie: boolean;
}

/** Load a protected image with the session and company header, as an object URL. */
function useImage(path: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let url: string | null = null;
    let live = true;
    const headers: Record<string, string> = {};
    const t = getActiveTenant();
    if (t) headers["X-Tenant-Id"] = t;
    fetch(`/api${path}`, { headers, credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return { src, failed };
}

const mapUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

function Side({ label, time, selfie, lat, lng, recordId, which }: { label: string; time: string | null; selfie: boolean; lat: number | null; lng: number | null; recordId: string; which: "in" | "out" }) {
  const img = useImage(selfie ? `/admin/attendance/records/${recordId}/selfie/${which}` : null);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13.5px] font-semibold">{label}</div>
        <div className="num text-[13px]">{time ?? "—"}</div>
      </div>
      <div className="grid aspect-square place-items-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--tint-1)] text-center">
        {img.src ? <img src={img.src} alt={`${label} selfie`} className="h-full w-full object-cover" /> : <span className="text-muted px-3 text-[12.5px]">{!selfie ? (time ? "No selfie" : "Not yet") : img.failed ? "Selfie no longer kept" : "Loading…"}</span>}
      </div>
      {lat != null && lng != null ? (
        <a href={mapUrl(lat, lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px]">
          <MapPin size={13} /> {lat.toFixed(5)}, {lng.toFixed(5)} <ExternalLink size={12} />
        </a>
      ) : (
        <span className="text-muted text-[12.5px]">{time ? "No location shared" : ""}</span>
      )}
    </div>
  );
}

/** Where and how someone punched today: selfies, times and locations. */
export function PunchDetailsDialog({ name, checkIn, checkOut, flags, punch, onClose }: { name: string; checkIn: string | null; checkOut: string | null; flags: string[]; punch: PunchInfo; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`${name}'s punches`} description="Locations open in OpenStreetMap. Selfies are deleted after the period set in Attendance › Policies." width={560}>
      <div className="grid grid-cols-2 gap-4">
        <Side label="Check-in" time={checkIn} selfie={punch.inSelfie} lat={punch.inLat} lng={punch.inLng} recordId={punch.recordId} which="in" />
        <Side label="Check-out" time={checkOut} selfie={punch.outSelfie} lat={punch.outLat} lng={punch.outLng} recordId={punch.recordId} which="out" />
      </div>
      {punch.distanceM != null || flags.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {punch.distanceM != null ? <Tag tone="neutral">{punch.distanceM < 1000 ? `${punch.distanceM} m` : `${(punch.distanceM / 1000).toFixed(1)} km`} from the office</Tag> : null}
          {flags.map((f) => (
            <Tag key={f} tone="warn">
              {f}
            </Tag>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
