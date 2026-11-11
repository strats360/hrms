import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Camera, ClipboardEdit, FileText, MapPin } from "lucide-react";
import { addWeeks, fmtDate, todayIST, weekStart } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { isNetworkError, QUEUE_EVENT, queuedPunches, queuePunch, savedHome, saveHome } from "@/lib/offline";
import { useOnline } from "@/lib/pwa";
import { InstallCard } from "@/components/InstallCard";
import type { Holiday, LeaveBalance, LeaveRequest } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";
import { SelfieCamera, type Loc } from "@/components/attendance/SelfieCamera";

export interface EssHome {
  punch?: { selfie: "off" | "optional" | "required"; location: "off" | "flag" | "block" };
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
function getLocation(precise = false): Promise<Loc> {
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), precise ? 9000 : 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(t);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
      { enableHighAccuracy: precise, timeout: precise ? 8500 : 3500, maximumAge: precise ? 15_000 : 60_000 },
    );
  });
}

export default function EssHomePage() {
  const qc = useQueryClient();
  const { tenant } = useSession();
  const eid = tenant?.employeeId ?? "";
  const q = useQuery({
    queryKey: ["ess", "home"],
    queryFn: async () => {
      try {
        const h = await api.get<EssHome>("/ess/home");
        // just enough to show today's status and punch without a connection
        saveHome(eid, { ...h, balances: [], holidays: [], requests: [] });
        return h;
      } catch (e) {
        const saved = isNetworkError(e) ? savedHome<EssHome>(eid) : null;
        if (saved) return saved;
        throw e;
      }
    },
  });
  const online = useOnline();
  const [queued, setQueued] = useState(() => queuedPunches(eid));
  useEffect(() => {
    const refresh = () => {
      setQueued(queuedPunches(eid));
      qc.invalidateQueries({ queryKey: ["ess", "home"] });
    };
    window.addEventListener(QUEUE_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_EVENT, refresh);
  }, [eid, qc]);
  const [wfh, setWfh] = useState(false);
  // the camera opens while the location is found in the background
  const [camera, setCamera] = useState(false);
  const [where, setWhere] = useState<{ state: "finding" | "found" | "none"; loc?: Loc }>({ state: "finding" });
  const pending = useRef<Promise<Loc> | null>(null);
  const locate = () => {
    const precise = (q.data?.punch?.location ?? "off") !== "off";
    setWhere({ state: "finding" });
    pending.current = getLocation(precise).then((loc) => (setWhere(loc ? { state: "found", loc } : { state: "none" }), loc));
    return pending.current;
  };
  const punch = useMutation({
    meta: { silent: true },
    mutationFn: async (selfie?: string) => {
      const loc = await (pending.current ?? locate());
      pending.current = null;
      const body = { source: wfh ? "wfh" : loc ? "gps" : "web", ...(loc ?? {}), ...(selfie ? { selfie } : {}) };
      const save = () => {
        const action: "in" | "out" = q.data?.today.checkIn || queued.some((x) => x.action === "in") ? "out" : "in";
        queuePunch(eid, { capturedAt: new Date().toISOString(), action, body });
        setQueued(queuedPunches(eid));
        return { offline: true as const, action };
      };
      if (!navigator.onLine) return save();
      try {
        return await api.post<{ action: "in" | "out"; checkIn: string; checkOut: string; status: string; lateMinutes: number; flags?: string[] }>("/ess/attendance/punch", body);
      } catch (e) {
        if (isNetworkError(e)) return save();
        throw e;
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSuccess: (r) => {
      if ("offline" in r) {
        toast.success(`${r.action === "in" ? "Check-in" : "Check-out"} saved on your phone at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}. It's sent as soon as you're back online.`);
        return;
      }
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
  const t = { ...d.today };
  const qIn = queued.find((x) => x.action === "in");
  const qOut = queued.find((x) => x.action === "out");
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  // while punches wait to be sent, show them as if they'd gone through
  if (!t.checkIn && qIn) t.checkIn = `${hhmm(qIn.capturedAt)} (waiting to send)`;
  if (!t.checkOut && qOut) t.checkOut = `${hhmm(qOut.capturedAt)} (waiting to send)`;
  const checkedOut = !!t.checkOut;
  const headline = !t.checkIn ? "Not checked in" : checkedOut ? `Done for today` : `Checked in at ${t.checkIn}`;
  const paid = d.balances.filter((b) => b.isPaid && (b.annualQuota > 0 || b.available > 0));

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar employeeId={d.profile.id} name={d.profile.name} size={44} tone="sel" />
        <div className="min-w-0">
          <div className="text-[20px] font-medium">Namaste, {d.profile.firstName}</div>
          <div className="text-muted text-[12.5px]">
            {dayName(t.date)}, {fmtDate(t.date)} · {[d.profile.designation, d.profile.department].filter(Boolean).join(", ")}
          </div>
        </div>
      </div>

      <InstallCard />
      <ReviewNotice />
      <InterviewNotice />
      <TimesheetNotice />
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
              <Button
                variant="primary"
                loading={punch.isPending}
                onClick={() => {
                  if ((d.punch?.selfie ?? "off") === "off") return punch.mutate(undefined);
                  void locate();
                  setCamera(true);
                }}
                disabled={d.profile.status === "onboarding"}
              >
                {(d.punch?.selfie ?? "off") !== "off" ? <Camera size={15} /> : <MapPin size={15} />}
                {t.checkIn ? "Check out" : "Check in"}
              </Button>
              {!t.checkIn ? <Checkbox checked={wfh} onChange={setWfh} label={<span className="text-[13px]">Working from home</span>} /> : null}
            </div>
          ) : (
            <div className="text-muted text-[12.5px]">Missed something? <Link to="/me/attendance">Request a correction</Link></div>
          )}
          <div className="text-muted text-[12px]">
            {!online ? "You're offline. Your punch is saved on this phone and sent when you're back online. " : ""}
            {(d.punch?.selfie ?? "off") !== "off" ? "You'll take a quick selfie. " : ""}Your location is used only to record where you punched, if you allow it.
          </div>
          {camera ? (
            <SelfieCamera
              action={t.checkIn ? "Check out" : "Check in"}
              required={d.punch?.selfie === "required"}
              location={where}
              onCapture={(img) => (setCamera(false), punch.mutate(img))}
              onSkip={() => (setCamera(false), punch.mutate(undefined))}
              onClose={() => ((pending.current = null), setCamera(false))}
            />
          ) : null}
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

/** A nudge when the employee's review needs them, and the way in to reviews on phones. */
function ReviewNotice() {
  const { has } = useSession();
  const q = useQuery({ queryKey: ["reviews", "mine"], queryFn: () => api.get<{ id: string; cycle: string; cycleStatus: string; selfDue: string; stage: string }[]>("/ess/reviews"), enabled: has("module.performance"), staleTime: 60_000 });
  const list = q.data ?? [];
  const todo = list.find((r) => r.cycleStatus === "active" && r.stage === "self") ?? list.find((r) => r.stage === "shared");
  if (todo)
    return (
      <Notice tone={todo.stage === "self" ? "warn" : "sel"}>
        {todo.stage === "self" ? `Your self review for ${todo.cycle} is due by ${fmtDate(todo.selfDue)}. ` : `Your review for ${todo.cycle} is ready to read. `}
        <Link to={`/me/reviews?id=${todo.id}`} style={{ color: "inherit", textDecoration: "underline" }}>{todo.stage === "self" ? "Start my review" : "Read it"}</Link>
      </Notice>
    );
  return list.length ? (
    <Link to="/me/reviews" className="text-[13px] md:hidden">Your performance reviews</Link>
  ) : null;
}

/** Interviews waiting for this person's feedback, or coming up today. */
function InterviewNotice() {
  const { has } = useSession();
  const q = useQuery({ queryKey: ["interviews", "mine"], queryFn: () => api.get<{ id: string; scheduledAt: string; status: string; feedbackDone: boolean; candidate: string }[]>("/ess/interviews"), enabled: has("module.recruitment"), staleTime: 60_000 });
  const list = (q.data ?? []).filter((i) => i.status !== "cancelled" && !i.feedbackDone);
  const due = list.filter((i) => new Date(i.scheduledAt) <= new Date());
  const today = list.filter((i) => new Date(i.scheduledAt) > new Date() && new Date(i.scheduledAt).toDateString() === new Date().toDateString());
  if (!due.length && !today.length) return null;
  return (
    <Notice tone={due.length ? "warn" : "sel"}>
      {due.length ? `${due.length} interview${due.length === 1 ? "" : "s"} waiting for your feedback. ` : `You're interviewing ${today[0]!.candidate} today. `}
      <Link to={`/me/interviews?id=${(due[0] ?? today[0])!.id}`} style={{ color: "inherit", textDecoration: "underline" }}>{due.length ? "Add feedback" : "See details"}</Link>
    </Notice>
  );
}

/** Last week's timesheet, for people who keep timesheets: not submitted yet, or sent back. */
function TimesheetNotice() {
  const { has } = useSession();
  const last = addWeeks(weekStart(todayIST()), -1);
  const q = useQuery({ queryKey: ["timesheets", "mine", last], queryFn: () => api.get<{ sheet: { status: string; rejectReason: string | null } | null; recent: unknown[]; projects: unknown[] }>(`/ess/timesheets?week=${last}`), enabled: has("module.timesheets"), staleTime: 300_000 });
  const d = q.data;
  if (!d || !d.projects.length || !d.recent.length) return null;
  const s = d.sheet?.status;
  if (s === "submitted" || s === "approved") return null;
  return (
    <Notice tone={s === "rejected" ? "bad" : "warn"}>
      {s === "rejected" ? `Your timesheet for the week of ${fmtDate(last)} was sent back: ${d.sheet!.rejectReason} ` : `Your timesheet for the week of ${fmtDate(last)} isn't submitted yet. `}
      <Link to={`/me/timesheets?week=${last}`} style={{ color: "inherit", textDecoration: "underline" }}>Open timesheet</Link>
    </Notice>
  );
}
