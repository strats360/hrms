import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, jobSchema, JOB_STATUS_LABEL, JOB_STATUSES, SOURCE_LABEL, SOURCES, STAGE_LABEL, type JobStatus, type Stage } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Tag, type Tone } from "@/components/ui/tag";
import { SearchSelect } from "@/components/ui/search-select";

export interface Lookups {
  departments: { id: string; name: string }[];
  designations: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  employees: { id: string; name: string; code: string }[];
}
export const useLookups = () => useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });

export interface Job {
  id: string;
  code: string;
  title: string;
  departmentId: string | null;
  designationId: string | null;
  branchId: string | null;
  location: string | null;
  employmentType: string;
  openings: number;
  minExperience: number | null;
  maxExperience: number | null;
  minCtc: number | null;
  maxCtc: number | null;
  description: string;
  hiringManagerId: string | null;
  status: JobStatus;
  published: boolean;
  counts: Record<string, number>;
  active: number;
  hired: number;
  department?: string | null;
  designation?: string | null;
  branch?: string | null;
  hiringManager?: string | null;
  createdAt: string;
}

export const JOB_TONE: Record<JobStatus, Tone> = { draft: "neutral", open: "ok", on_hold: "warn", closed: "outline" };
export const STAGE_TONE: Record<Stage, Tone> = { applied: "neutral", screening: "accent", interview: "accent", offer: "warn", hired: "ok", rejected: "bad", withdrawn: "outline" };
export const JobStatusTag = ({ s }: { s: JobStatus }) => <Tag tone={JOB_TONE[s]}>{JOB_STATUS_LABEL[s]}</Tag>;
export const StageTag = ({ s }: { s: Stage }) => <Tag tone={STAGE_TONE[s]}>{STAGE_LABEL[s]}</Tag>;
export const lakh = (n: number | null | undefined) => (n == null ? "" : n >= 100000 ? `${(n / 100000).toFixed(n % 100000 ? 1 : 0)} L` : `₹${n.toLocaleString("en-IN")}`);
export const ctcRange = (j: Pick<Job, "minCtc" | "maxCtc">) => (j.minCtc == null && j.maxCtc == null ? "" : `₹${lakh(j.minCtc ?? 0)}${j.maxCtc != null ? ` to ${lakh(j.maxCtc)}` : "+"}`);
export const REJECT_REASONS = ["Not enough relevant experience", "Skills don't match", "Salary expectations too high", "Notice period too long", "Didn't clear the interview", "Not reachable", "Hired someone else", "Other"];

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

export function JobDialog({ job, onClose, onSaved }: { job?: Job; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const [f, setF] = useState({
    title: job?.title ?? "",
    departmentId: job?.departmentId ?? "",
    designationId: job?.designationId ?? "",
    branchId: job?.branchId ?? "",
    location: job?.location ?? "",
    employmentType: job?.employmentType ?? "full_time",
    openings: String(job?.openings ?? 1),
    minExperience: str(job?.minExperience),
    maxExperience: str(job?.maxExperience),
    minCtc: str(job?.minCtc),
    maxCtc: str(job?.maxCtc),
    description: job?.description ?? "",
    hiringManagerId: job?.hiringManagerId ?? "",
    status: (job?.status ?? "open") as JobStatus,
    published: job?.published ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: (body: unknown) => (job ? api.put<Job>(`/admin/recruitment/jobs/${job.id}`, body) : api.post<Job>("/admin/recruitment/jobs", body)),
    onSuccess: (j) => (toast.success(job ? "Job updated" : `${j.code} created`), qc.invalidateQueries({ queryKey: ["recruitment"] }), onClose(), onSaved?.(j.id)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    const body = { ...f, departmentId: f.departmentId || null, designationId: f.designationId || null, branchId: f.branchId || null, location: f.location || null, hiringManagerId: f.hiringManagerId || null, openings: Number(f.openings) || 1, minExperience: num(f.minExperience), maxExperience: num(f.maxExperience), minCtc: num(f.minCtc), maxCtc: num(f.maxCtc) };
    const parsed = jobSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      return setErrors(fe);
    }
    setErrors({});
    save.mutate(body);
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={job ? `Edit ${job.code}` : "New job opening"}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>{job ? "Save" : "Create job"}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" span error={errors.title}><Input value={f.title} onChange={set("title")} placeholder="e.g. Payroll Executive" /></Field>
        <Field label="Department"><Select value={f.departmentId} onChange={set("departmentId")}><option value="">—</option>{L.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Designation"><Select value={f.designationId} onChange={set("designationId")}><option value="">—</option>{L.data?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Branch"><Select value={f.branchId} onChange={set("branchId")}><option value="">—</option>{L.data?.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Location" hint="Shown on the careers page"><Input value={f.location} onChange={set("location")} placeholder="e.g. Ahmedabad, hybrid" /></Field>
        <Field label="Employment type"><Select value={f.employmentType} onChange={set("employmentType")}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Openings"><Input type="number" min={1} value={f.openings} onChange={set("openings")} /></Field>
        <Field label="Experience (years)" error={errors.maxExperience}>
          <div className="flex items-center gap-2"><Input type="number" min={0} aria-label="Minimum experience" value={f.minExperience} onChange={set("minExperience")} placeholder="From" /><span className="text-muted">to</span><Input type="number" min={0} aria-label="Maximum experience" value={f.maxExperience} onChange={set("maxExperience")} placeholder="To" /></div>
        </Field>
        <Field label="Budget, annual CTC (₹)" hint="Internal only" error={errors.maxCtc}>
          <div className="flex items-center gap-2"><Input type="number" min={0} aria-label="Minimum CTC" value={f.minCtc} onChange={set("minCtc")} placeholder="From" /><span className="text-muted">to</span><Input type="number" min={0} aria-label="Maximum CTC" value={f.maxCtc} onChange={set("maxCtc")} placeholder="To" /></div>
        </Field>
        <Field label="Hiring manager" hint="They see this job's candidates and can move them along">
          <SearchSelect value={f.hiringManagerId} onChange={(v) => set("hiringManagerId")({ target: { value: v } })} emptyLabel="Nobody" searchPlaceholder="Search by name or employee ID" options={(L.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }))} />
        </Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as JobStatus })}>{JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}</Select></Field>
        <Field label="Description" span hint="What the role does and who you're looking for. Shown on the careers page.">
          <Textarea rows={6} value={f.description} onChange={set("description")} />
        </Field>
        <div className="sm:col-span-2"><Checkbox checked={f.published} onChange={(v) => setF({ ...f, published: v })} label="List it on the careers page while it's open" /></div>
      </div>
    </Dialog>
  );
}

/** Add a candidate to a job by hand, with an optional resume. */
export function AddCandidateDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const [f, setF] = useState({ name: "", email: "", phone: "", currentCompany: "", currentTitle: "", experienceYears: "", currentCtc: "", expectedCtc: "", noticeDays: "", location: "", source: "job_portal", referredById: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const data = { ...f, jobId, phone: f.phone || null, currentCompany: f.currentCompany || null, currentTitle: f.currentTitle || null, location: f.location || null, referredById: f.source === "referral" ? f.referredById || null : null, experienceYears: num(f.experienceYears), currentCtc: num(f.currentCtc), expectedCtc: num(f.expectedCtc), noticeDays: num(f.noticeDays) };
      const form = new FormData();
      form.append("data", JSON.stringify(data));
      if (file) form.append("resume", file);
      return api.post<{ existing: boolean }>("/admin/recruitment/candidates", form);
    },
    onSuccess: (r) => (toast.success(r.existing ? `${f.name} was already in your candidates; added to this job` : `${f.name} added`), qc.invalidateQueries({ queryKey: ["recruitment"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Add a candidate"
      width={680}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={f.name.trim().length < 2 || !f.email.includes("@")} loading={save.isPending} onClick={() => save.mutate()}>Add candidate</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Current company"><Input value={f.currentCompany} onChange={set("currentCompany")} /></Field>
        <Field label="Current role"><Input value={f.currentTitle} onChange={set("currentTitle")} /></Field>
        <Field label="Experience (years)"><Input type="number" min={0} step={0.5} value={f.experienceYears} onChange={set("experienceYears")} /></Field>
        <Field label="Current CTC (₹ a year)"><Input type="number" min={0} value={f.currentCtc} onChange={set("currentCtc")} /></Field>
        <Field label="Expected CTC (₹ a year)"><Input type="number" min={0} value={f.expectedCtc} onChange={set("expectedCtc")} /></Field>
        <Field label="Notice period (days)"><Input type="number" min={0} value={f.noticeDays} onChange={set("noticeDays")} /></Field>
        <Field label="Location"><Input value={f.location} onChange={set("location")} /></Field>
        <Field label="Source"><Select value={f.source} onChange={set("source")}>{SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select></Field>
        {f.source === "referral" ? (
          <Field label="Referred by"><SearchSelect value={f.referredById} onChange={(v) => set("referredById")({ target: { value: v } })} emptyLabel="Nobody" searchPlaceholder="Search by name or employee ID" options={(L.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }))} /></Field>
        ) : null}
        <Field label="Resume" hint="PDF or Word, up to 5 MB" span>
          <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
        </Field>
        <Field label="Notes" span><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Dialog>
  );
}
