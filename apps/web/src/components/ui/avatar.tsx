import { useState } from "react";
import { initials } from "@hrms/shared";
import { cn } from "@/lib/utils";
import { photoSrc, usePhotos } from "@/lib/photos";

/** Initials, or the employee's photo when they have one. */
export function Avatar({ name, size = 30, tone = "ok", className, employeeId }: { name: string; size?: number; tone?: "ok" | "sel"; className?: string; employeeId?: string | null }) {
  const photos = usePhotos();
  const version = employeeId ? photos.data?.[employeeId] : undefined;
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (employeeId && version && broken !== version) {
    return <img src={photoSrc(employeeId, version)} alt="" aria-hidden width={size} height={size} loading="lazy" decoding="async" onError={() => setBroken(version)} className={cn("flex-none rounded-full object-cover", className)} style={style} />;
  }
  return (
    <div
      aria-hidden
      className={cn("grid flex-none place-items-center rounded-full font-bold", className)}
      style={{
        ...style,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background: tone === "ok" ? "var(--ok-bg)" : "var(--sel-bg)",
        color: tone === "ok" ? "var(--ok-fg)" : "var(--sel-fg)",
      }}
    >
      {initials(name)}
    </div>
  );
}

export function PersonCell({ name, sub, employeeId }: { name: string; sub?: string | null; employeeId?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} employeeId={employeeId} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {sub ? <div className="text-muted truncate text-[12px]">{sub}</div> : null}
      </div>
    </div>
  );
}
