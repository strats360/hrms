import { initials } from "@hrms/shared";
import { cn } from "@/lib/utils";

export function Avatar({ name, size = 30, tone = "ok", className }: { name: string; size?: number; tone?: "ok" | "sel"; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("grid flex-none place-items-center rounded-full font-bold", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background: tone === "ok" ? "var(--ok-bg)" : "var(--sel-bg)",
        color: tone === "ok" ? "var(--ok-fg)" : "var(--sel-fg)",
      }}
    >
      {initials(name)}
    </div>
  );
}

export function PersonCell({ name, sub }: { name: string; sub?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {sub ? <div className="text-muted truncate text-[12px]">{sub}</div> : null}
      </div>
    </div>
  );
}
