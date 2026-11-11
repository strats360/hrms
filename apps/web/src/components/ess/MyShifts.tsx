import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Day {
  date: string;
  status: "work" | "off" | "holiday" | "leave";
  shift: { name: string; startTime: string; endTime: string } | null;
  changed: boolean;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The next two weeks: shift times, days off, holidays and leave. */
export function MyShifts() {
  const q = useQuery({ queryKey: ["ess", "roster"], queryFn: () => api.get<{ days: Day[] }>("/ess/roster"), retry: false });
  const days = q.data?.days ?? [];
  if (!days.length) return null;
  return (
    <Card className="!gap-2">
      <CardHeader title="My shifts" sub="The next two weeks. Bold days were planned specially for you." />
      <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d, i) => {
          const dt = new Date(`${d.date}T00:00:00Z`);
          return (
            <div
              key={d.date}
              className={cn("flex min-w-[64px] flex-col items-center rounded-[var(--radius-md)] border px-1.5 py-2 text-center text-[12px]", d.changed ? "border-[var(--sel-fg)] font-semibold" : "border-[var(--color-divider)]")}
              style={{ background: i === 0 ? "var(--sel-bg)" : d.status === "work" ? "var(--color-surface)" : "var(--tint-1)" }}
            >
              <div className="text-muted text-[10.5px] uppercase tracking-[0.05em]">{i === 0 ? "Today" : DOW[dt.getUTCDay()]}</div>
              <div className="text-[13px]">{dt.getUTCDate()}</div>
              <div className="mt-1 leading-tight">
                {d.status === "work" && d.shift ? (
                  <>
                    {d.shift.startTime}
                    <div className="text-muted font-normal">{d.shift.endTime}</div>
                  </>
                ) : d.status === "holiday" ? (
                  "Holiday"
                ) : d.status === "leave" ? (
                  "Leave"
                ) : (
                  "Off"
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
