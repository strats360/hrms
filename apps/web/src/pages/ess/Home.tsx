import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, ClipboardEdit, FileText, MapPin } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api } from "@/lib/api";
import type { Holiday, LeaveBalance, LeaveRequest } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";

export interface EssHome {
  profile: { id: string; name: string; firstName: string; code: string; designation: string | null; department: string | null; company: string; status: string };
  onboarding: { status: string; progress: number } | null;
  today: { date: string; shift: { name: string; start: string; end: string }; checkIn: string | null; checkOut: string | null; status: string | null; source: string | null };
  balances: LeaveBalance[];
  holidays: Holiday[];
  requests: (LeaveRequest & { typeName: string })[];
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayName = (iso: string) => WEEKDAY[new Date(iso + "T00:00:00Z").getUTCDay()];

/** Best-effort location; resolves undefined if denied or slow. */
function getLocation(): Promise<{ lat: number; lng: number; accuracy: number } | undefined> {
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(t);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 60_000 },
    );
  });
}

export default function EssHomePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ess", "home"], queryFn: () => api.get<EssHome>("/ess/home") });
  const [wfh, setWfh] = useState(false);
  const punch = useMutation({
    mutationFn: async () => {
      const loc = await getLocation();
      return api.post<{ action: "in" | "out"; checkIn: string; checkOut: string; status: string; lateMinutes: number; flags?: string[] }>("/ess/attendance/punch", { source: wfh ? "wfh" : loc ? "gps" : "web", ...(loc ?? {}) });
    },
    onSuccess: (r) => {
      toast.success(r.action === "in" ? `Checked in at ${r.checkIn}${r.lateMinutes ? ` · ${r.lateMinutes} min late` : ""}` : `Checked out at ${r.checkOut}`);
      if (r.flags?.length) toast.warning(`${r.flags.join(". ")}. HR will see this on your attendance.`);
      qc.invalidateQueries({ queryKey: ["ess"] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const ob = d.onboarding;
  if (d.profile.status === "onboarding" && ob && ob.status !== "submitted") return <Navigate to="/me/onboarding" replace />;
  const t = d.today;
  const checkedOut = !!t.checkOut;
  const headline = !t.checkIn ? "Not checked in" : checkedOut ? `Done for today` : `Checked in at ${t.checkIn}`;
  const paid = d.balances.filter((b) => b.isPaid && (b.annualQuota > 0 || b.available > 0));

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={d.profile.name} size={44} tone="sel" />
        <div className="min-w-0">
          <div className="text-[20px] font-medium">Namaste, {d.profile.firstName}</div>
          <div className="text-muted text-[12.5px]">
            {dayName(t.date)}, {fmtDate(t.date)} · {[d.profile.designation, d.profile.department].filter(Boolean).join(", ")}
          </div>
        </div>
      </div>

      {ob && ob.status === "submitted" ? <Notice tone="sel">Your joining details are with HR for verification. Attendance and leave open up once they're verified.</Notice> : null}
      {ob && ob.status !== "submitted" ? (
        <Notice tone="warn">
          Your joining details are {ob.progress}% complete. <Link to="/me/onboarding" style={{ color: "inherit", textDecoration: "underline" }}>Finish onboarding</Link>
        </Notice>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card elev="md" className="!gap-2.5" style={{ background: "var(--color-surface)" }}>
          <div className="text-[12px] uppercase tracking-[0.08em] opacity-80">Today</div>
          <div className="text-[26px] font-medium">{headline}</div>
          <div className="text-[13px] opacity-85">
            Shift {t.shift.start} to {t.shift.end}
            {t.checkIn ? ` · in ${t.checkIn}` : ""}
            {t.checkOut ? ` · out ${t.checkOut}` : ""}
          </div>
          {t.status ? <div><StatusTag status={t.status} /></div> : null}
          {!checkedOut ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Button variant="primary" loading={punch.isPending} onClick={() => punch.mutate()} disabled={d.profile.status === "onboarding"}>
                <MapPin size={15} />
                {t.checkIn ? "Check out" : "Check in"}
              </Button>
              {!t.checkIn ? <Checkbox checked={wfh} onChange={setWfh} label={<span className="text-[13px]">Working from home</span>} /> : null}
            </div>
          ) : (
            <div className="text-muted text-[12.5px]">Missed something? <Link to="/me/attendance">Request a correction</Link></div>
          )}
          <div className="text-muted text-[12px]">Your location is used only to record where you checked in, if you allow it.</div>
        </Card>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
          <QuickLink to="/me/leave?apply=1" icon={<CalendarPlus size={18} />} label="Apply leave" />
          <QuickLink to="/me/attendance?correct=1" icon={<ClipboardEdit size={18} />} label="Attendance correction" />
          <QuickLink to="/me/profile#documents" icon={<FileText size={18} />} label="My documents" />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="card-title text-[15px]">Leave balance</div>
          <Link to="/me/leave" className="text-[13px]">Details</Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {paid.map((b) => (
            <Card key={b.leaveTypeId} padded={false} className="!p-3.5">
              <div className="card-kicker">{b.name}</div>
              <div className="text-[22px] font-medium num">{b.available}</div>
              <div className="card-meta">{b.pending ? `${b.pending} pending approval` : `of ${b.annualQuota} a year`}</div>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="!gap-2">
          <CardHeader title="My leave requests" actions={<Link to="/me/leave" className="text-[13px]">All</Link>} />
          {d.requests.length === 0 ? <div className="text-muted text-[13px]">No leave requests yet.</div> : null}
          {d.requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-2 text-[13.5px] last:border-0">
              <div className="min-w-0">
                <div className="font-semibold">{r.typeName} · {Number(r.days)} day{Number(r.days) === 1 ? "" : "s"}</div>
                <div className="text-muted text-[12px]">{r.startDate === r.endDate ? fmtDate(r.startDate) : `${fmtDate(r.startDate, false)} to ${fmtDate(r.endDate)}`} · {r.code}</div>
              </div>
              <StatusTag status={r.status} />
            </div>
          ))}
        </Card>
        <Card className="!gap-2">
          <CardHeader title="Upcoming holidays" />
          {d.holidays.length === 0 ? <div className="text-muted text-[13px]">No more holidays this year.</div> : null}
          {d.holidays.map((h) => (
            <div key={h.id} className="flex justify-between gap-2 text-[13px]">
              <span>{dayName(h.date)?.slice(0, 3)} {fmtDate(h.date, false)} · {h.name}</span>
              <span className="text-muted capitalize">{h.type}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="card flex-row !items-center !gap-2.5 !p-3.5 text-[13.5px] no-underline hover:shadow-[var(--shadow-sm)] max-md:flex-col max-md:!items-start max-md:text-[12.5px]" style={{ color: "var(--color-text)" }}>
      <span style={{ color: "var(--color-accent)" }}>{icon}</span>
      {label}
    </Link>
  );
}
