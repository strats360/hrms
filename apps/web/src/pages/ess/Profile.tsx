import { useEffect, useRef, useState } from "react";
import { PhotoEditor } from "@/components/account/PhotoEditor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileText, Pencil, Upload } from "lucide-react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, EMPLOYMENT_TYPE_LABELS, essProfileUpdateSchema, fmtDate, maskAccount, type DocumentType } from "@hrms/shared";
import { api } from "@/lib/api";
import type { EmployeeDocument } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, KV, Loading } from "@/components/ui/page";
import { StatusTag } from "@/components/ui/tag";
import { zodErrors } from "@/components/onboarding/form";
import { ResignationCard } from "@/components/exits/ResignationCard";
import { MyAssets } from "@/components/ess/MyAssets";

interface EssProfile {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  bloodGroup: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  dateOfJoining: string;
  employmentType: string;
  status: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  manager: string | null;
  company: string;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  bankVerified: boolean;
  pan: string | null;
  aadhaarLast4: string | null;
  uan: string | null;
  taxRegime: string;
  documents: EmployeeDocument[];
}

const EDITABLE = ["personalEmail", "phone", "maritalStatus", "bloodGroup", "currentAddress", "permanentAddress", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone"] as const;
type Editable = (typeof EDITABLE)[number];

export default function EssProfilePage() {
  const q = useQuery({ queryKey: ["ess", "profile"], queryFn: () => api.get<EssProfile>("/ess/profile") });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (q.data && window.location.hash === "#documents") document.getElementById("documents")?.scrollIntoView();
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const p = q.data;
  return (
    <>
      <div className="flex items-start gap-4">
        <PhotoEditor employeeId={p.id} name={p.fullName} size={64} endpoint="/ess/photo" canEdit={(p as { canEditPhoto?: boolean }).canEditPhoto !== false} />
        <div className="min-w-0">
          <div className="text-[22px] font-medium">{p.fullName}</div>
          <div className="text-muted text-[13px]">{[p.designation, p.department].filter(Boolean).join(" · ")} · {p.employeeCode}</div>
          <div className="mt-1"><StatusTag status={p.status} /></div>
        </div>
      </div>

      <Card className="!gap-4">
        <CardHeader title="Personal & contact" sub="You can update these yourself." actions={!editing ? <Button size="sm" onClick={() => setEditing(true)}><Pencil size={14} />Edit</Button> : null} />
        {editing ? <EditForm p={p} onDone={() => setEditing(false)} /> : (
          <div className="grid gap-x-6 gap-y-4 text-[14px] sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            <KV label="Date of birth">{fmtDate(p.dateOfBirth)}</KV>
            <KV label="Gender"><span className="capitalize">{p.gender ?? "—"}</span></KV>
            <KV label="Work email">{p.workEmail}</KV>
            <KV label="Personal email">{p.personalEmail}</KV>
            <KV label="Phone">{p.phone}</KV>
            <KV label="Marital status">{p.maritalStatus}</KV>
            <KV label="Blood group">{p.bloodGroup}</KV>
            <KV span label="Current address">{p.currentAddress}</KV>
            <KV span label="Permanent address">{p.permanentAddress}</KV>
            <KV label="Emergency contact">{p.emergencyContactName ? `${p.emergencyContactName}${p.emergencyContactRelation ? ` (${p.emergencyContactRelation})` : ""} · ${p.emergencyContactPhone ?? ""}` : "—"}</KV>
          </div>
        )}
      </Card>

      <Card className="!gap-4">
        <CardHeader title="Employment" sub="Managed by HR. Ask HR if something is wrong." />
        <div className="grid gap-x-6 gap-y-4 text-[14px] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          <KV label="Company">{p.company}</KV>
          <KV label="Date of joining">{fmtDate(p.dateOfJoining)}</KV>
          <KV label="Department">{p.department}</KV>
          <KV label="Designation">{p.designation}</KV>
          <KV label="Reporting manager">{p.manager}</KV>
          <KV label="Branch">{p.branch}</KV>
          <KV label="Employment type">{EMPLOYMENT_TYPE_LABELS[p.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? p.employmentType}</KV>
        </div>
      </Card>

      <Card className="!gap-4">
        <CardHeader title="Bank & tax" />
        <div className="grid gap-x-6 gap-y-4 text-[14px] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          <KV label="Bank">{p.bankName}</KV>
          <KV label="Account">{maskAccount(p.accountLast4)}</KV>
          <KV label="IFSC">{p.ifsc}</KV>
          <KV label="Verification">{p.bankName ? <StatusTag status={p.bankVerified ? "verified" : "pending"} label={p.bankVerified ? "Verified" : "Pending"} /> : "—"}</KV>
          <KV label="PAN">{p.pan}</KV>
          <KV label="Aadhaar">{p.aadhaarLast4 ? `XXXX XXXX ${p.aadhaarLast4}` : "—"}</KV>
          <KV label="UAN">{p.uan}</KV>
          <KV label="Tax regime">{p.taxRegime === "old" ? "Old regime" : "New regime"}</KV>
        </div>
      </Card>

      <Documents docs={p.documents} />
      <MyAssets />
      <ResignationCard />
    </>
  );
}

function EditForm({ p, onDone }: { p: EssProfile; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<Editable, string>>(() => Object.fromEntries(EDITABLE.map((k) => [k, p[k] ?? ""])) as Record<Editable, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (b: unknown) => api.patch("/ess/profile", b),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["ess"] });
      onDone();
    },
  });
  const set = (k: Editable) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = () => {
    const parsed = essProfileUpdateSchema.safeParse(f);
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    m.mutate(parsed.data);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Personal email" error={errors.personalEmail}><Input type="email" value={f.personalEmail} onChange={set("personalEmail")} /></Field>
        <Field label="Phone" error={errors.phone}><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Marital status">
          <Select value={f.maritalStatus} onChange={set("maritalStatus")}>
            <option value="">Prefer not to say</option>
            {["Single", "Married", "Divorced", "Widowed"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Blood group">
          <Select value={f.bloodGroup} onChange={set("bloodGroup")}>
            <option value="">Not known</option>
            {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field span label="Current address" error={errors.currentAddress}><Textarea value={f.currentAddress} onChange={set("currentAddress")} className="!min-h-[64px]" /></Field>
        <Field span label="Permanent address" error={errors.permanentAddress}><Textarea value={f.permanentAddress} onChange={set("permanentAddress")} className="!min-h-[64px]" /></Field>
        <Field label="Emergency contact name" error={errors.emergencyContactName}><Input value={f.emergencyContactName} onChange={set("emergencyContactName")} /></Field>
        <Field label="Relation"><Input value={f.emergencyContactRelation} onChange={set("emergencyContactRelation")} /></Field>
        <Field label="Emergency contact phone" error={errors.emergencyContactPhone}><Input type="tel" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} onClick={save}>Save changes</Button>
      </div>
    </div>
  );
}

export function fmtSize(b: number | null) {
  if (!b) return "";
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}

function Documents({ docs }: { docs: EmployeeDocument[] }) {
  const qc = useQueryClient();
  const [type, setType] = useState<DocumentType>("education");
  const input = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set("type", type);
      fd.set("file", file);
      return api.upload("/ess/documents", fd);
    },
    onSuccess: () => {
      toast.success("Uploaded. HR will verify it.");
      qc.invalidateQueries({ queryKey: ["ess"] });
    },
  });
  return (
    <Card className="!gap-2" id="documents">
      <CardHeader title="My documents" sub="PDF, PNG, JPG or WebP up to 10 MB." />
      {docs.length === 0 ? <div className="text-muted text-[13px]">No documents yet.</div> : null}
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5" style={{ background: "var(--color-surface)" }}>
          <FileText size={18} style={{ color: "var(--color-accent)", flex: "none" }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{d.name}</div>
            <div className="text-muted text-[12px]">{DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type}{d.sizeBytes ? ` · ${fmtSize(d.sizeBytes)}` : ""}</div>
          </div>
          <StatusTag status={d.status} label={d.status === "pending" ? "Pending verification" : undefined} />
          <a className="btn btn-secondary btn-icon !h-8 !w-8" href={`/api/files/documents/${d.id}`} target="_blank" rel="noreferrer" aria-label={`Download ${d.name}`}>
            <Download size={15} />
          </a>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value as DocumentType)} className="!w-auto" aria-label="Document type">
          {DOCUMENT_TYPES.filter((t) => t !== "photo").map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
        </Select>
        <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) up.mutate(file); e.target.value = ""; }} />
        <Button loading={up.isPending} onClick={() => input.current?.click()}>
          <Upload size={15} />
          Upload document
        </Button>
      </div>
    </Card>
  );
}
