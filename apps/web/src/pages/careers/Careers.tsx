import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronLeft, MapPin } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { BrandMark, CenteredPage } from "@/components/onboarding/PublicShell";

interface PublicJob {
  id: string;
  code: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string;
  openings: number;
  experience: string | null;
  description?: string;
  postedAt: string;
}

const meta = (j: PublicJob) => [j.department, j.employmentType, j.experience].filter(Boolean).join(" · ");

/** Public list of a company's open jobs. */
export default function Careers() {
  const { slug = "" } = useParams();
  const q = useQuery({ queryKey: ["careers", slug], queryFn: () => api.get<{ company: { name: string }; intro: string; jobs: PublicJob[] }>(`/public/careers/${slug}`), retry: false });
  if (q.isLoading) return <CenteredPage><Loading /></CenteredPage>;
  if (q.error || !q.data) return <CenteredPage><ErrorState error={q.error ?? new Error("Careers page not found")} /></CenteredPage>;
  const d = q.data;
  return (
    <CenteredPage width={820}>
      <BrandMark name={d.company.name} />
      <div>
        <h1 className="!mb-1 text-[30px]">Careers at {d.company.name}</h1>
        {d.intro ? <p className="text-muted whitespace-pre-line text-[15px]">{d.intro}</p> : null}
      </div>
      {!d.jobs.length ? (
        <Card><Empty title="No open roles right now" sub="Check back soon." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {d.jobs.map((j) => (
            <Link key={j.id} to={`/careers/${slug}/jobs/${j.id}`} className="no-underline" style={{ color: "inherit" }}>
              <Card className="!gap-1.5 hover:border-[var(--color-accent)]">
                <div className="text-[17px] font-medium">{j.title}</div>
                <div className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {j.location ? <span className="inline-flex items-center gap-1"><MapPin size={13} /> {j.location}</span> : null}
                  <span className="inline-flex items-center gap-1"><Briefcase size={13} /> {meta(j)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </CenteredPage>
  );
}

/** One job, with the application form. */
export function CareersJob() {
  const { slug = "", id = "" } = useParams();
  const q = useQuery({ queryKey: ["careers", slug, id], queryFn: () => api.get<{ company: { name: string }; job: PublicJob }>(`/public/careers/${slug}/jobs/${id}`), retry: false });
  const [f, setF] = useState({ name: "", email: "", phone: "", currentCompany: "", experienceYears: "", noticeDays: "", note: "", website: "" });
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (q.isLoading) return <CenteredPage><Loading /></CenteredPage>;
  if (q.error || !q.data) return <CenteredPage><ErrorState error={q.error ?? new Error("This job isn't open any more")} /></CenteredPage>;
  const { company, job: j } = q.data;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!file) return setErr("Attach your resume");
    if (file.size > 5 * 1024 * 1024) return setErr("Your resume must be 5 MB or smaller");
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) if (v !== "" || k === "website") form.append(k, v);
    form.append("consent", consent ? "yes" : "");
    form.append("resume", file);
    setBusy(true);
    try {
      await api.post(`/public/careers/${slug}/jobs/${id}/apply`, form);
      setSent(true);
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <CenteredPage width={820}>
      <BrandMark name={company.name} />
      <Link to={`/careers/${slug}`} className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All jobs</Link>
      <div>
        <h1 className="!mb-1 text-[28px]">{j.title}</h1>
        <div className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
          {j.location ? <span className="inline-flex items-center gap-1"><MapPin size={13} /> {j.location}</span> : null}
          <span>{meta(j)}</span>
          <span>Posted {fmtDate(j.postedAt.slice(0, 10))}</span>
        </div>
      </div>
      {j.description ? <Card><div className="whitespace-pre-line text-[14.5px] leading-relaxed">{j.description}</div></Card> : null}
      <Card className="!gap-3">
        <h2 className="!m-0 text-[19px]">Apply</h2>
        {sent ? (
          <Notice tone="ok">Thanks, {f.name.split(" ")[0]}. We've received your application and emailed you a confirmation. We'll be in touch if your profile is a good fit.</Notice>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
            <Field label="Full name"><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>
            <Field label="Email"><Input required type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
            <Field label="Phone"><Input required type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></Field>
            <Field label="Current company (optional)"><Input value={f.currentCompany} onChange={set("currentCompany")} autoComplete="organization" /></Field>
            <Field label="Years of experience (optional)"><Input type="number" min={0} step={0.5} value={f.experienceYears} onChange={set("experienceYears")} /></Field>
            <Field label="Notice period in days (optional)"><Input type="number" min={0} value={f.noticeDays} onChange={set("noticeDays")} /></Field>
            <Field label="Resume" hint="PDF or Word, up to 5 MB" span>
              <input type="file" required accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" aria-label="Resume" />
            </Field>
            <Field label="Anything you'd like to add (optional)" span><Textarea rows={3} value={f.note} onChange={set("note")} /></Field>
            {/* spam trap, hidden from people */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} className="hidden" aria-hidden="true" />
            <div className="sm:col-span-2">
              <Checkbox checked={consent} onChange={setConsent} label={`I agree to ${company.name} keeping my details to consider me for this and similar roles. I can ask for them to be removed at any time.`} />
            </div>
            {err ? <div className="sm:col-span-2"><Notice tone="bad">{err}</Notice></div> : null}
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" variant="primary" loading={busy} disabled={!consent}>Send application</Button>
            </div>
          </form>
        )}
      </Card>
    </CenteredPage>
  );
}
