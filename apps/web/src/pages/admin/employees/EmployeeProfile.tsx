import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Download, LogOut, Eye, FileText, Pencil, Trash2, Upload } from "lucide-react";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  fmtDate,
  inr,
  type DocumentType,
  type EmployeeStatus,
} from "@hrms/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { StatusTag, Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { EmployeeDetail } from "@/lib/types";
import { AttendanceMonth } from "@/components/employees/AttendanceMonth";
import { ResetTwoFactorDialog } from "@/components/account/ResetTwoFactorDialog";
import { PhotoEditor } from "@/components/account/PhotoEditor";
import { GenerateLetterDialog } from "@/components/letters/GenerateLetterDialog";

type Tab = "personal" | "employment" | "bank" | "statutory" | "documents" | "attendance";

const yesNo = (v: boolean) => (v ? "Applicable" : "Not applicable");
const gender = (g: string | null) => (g ? { male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" }[g] ?? g : null);
const size = (b: number | null) => (b ? (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`) : "");

export default function EmployeeProfile() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const edit = can("employees", "edit");
  const [tab, setTab] = useState<Tab>("personal");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocumentType>("resume");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [letter, setLetter] = useState(false);

  const q = useQuery({ queryKey: ["employee", id], queryFn: () => api.get<EmployeeDetail>(`/admin/employees/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["employee", id] });

  const reveal = useMutation({
    mutationFn: () => api.get<EmployeeDetail>(`/admin/employees/${id}?reveal=account`),
    onSuccess: (d) => setRevealed(d.accountNumber),
  });
  const invite = useMutation({
    mutationFn: () => api.post(`/admin/employees/${id}/invite`),
    onSuccess: () => {
      toast.success(`Invite sent to ${q.data?.workEmail}`);
      refresh();
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set("type", docType);
      fd.set("file", file!);
      return api.upload(`/admin/employees/${id}/documents`, fd);
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setFile(null);
      setFileKey((k) => k + 1);
      refresh();
    },
  });
  const setDocStatus = useMutation({
    mutationFn: ({ docId, status }: { docId: string; status: string }) => api.patch(`/admin/employees/documents/${docId}`, { status }),
    onSuccess: (_d, v) => {
      toast.success(v.status === "verified" ? "Document verified" : "Document rejected");
      refresh();
    },
  });
  const delDoc = useMutation({
    mutationFn: (docId: string) => api.del(`/admin/employees/documents/${docId}`),
    onSuccess: () => {
      toast.success("Document deleted");
      refresh();
    },
  });

  const exitsQ = useQuery({ queryKey: ["exits", "open"], queryFn: () => api.get<{ rows: { id: string; employeeId: string; statusLabel: string }[] }>("/admin/exits?status=open"), enabled: q.data?.status === "notice" && (edit || can("payroll", "view")) });
  const openExit = exitsQ.data?.rows.find((r) => r.employeeId === id) ?? null;

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Employee not found")} retry={() => q.refetch()} />;
  const e = q.data;

  const tabs: { value: Tab; label: string }[] = [
    { value: "personal", label: "Personal" },
    { value: "employment", label: "Employment" },
    { value: "bank", label: "Bank" },
    { value: "statutory", label: "Statutory" },
    { value: "documents", label: `Documents${e.documents.length ? ` (${e.documents.length})` : ""}` },
    ...(can("attendance") ? [{ value: "attendance" as Tab, label: "Attendance" }] : []),
  ];
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-x-6 gap-y-4 text-[14px] min-w-0";
  const inviteOpen = e.invite && e.invite.status !== "verified";

  return (
    <>
      <Link to="/employees" className="inline-flex items-center gap-1 self-start text-[13px] no-underline">
        <ChevronLeft size={15} /> All employees
      </Link>
      <PageHeader
        title={e.fullName}
        sub={[e.designation, e.department].filter(Boolean).join(" · ") || e.employeeCode}
        actions={
          <>
            {openExit ? (
              <Button onClick={() => nav(`/employees/exits/${openExit.id}`)}>
                <LogOut size={15} /> {openExit.statusLabel}
              </Button>
            ) : edit && !["exited", "inactive", "notice"].includes(e.status) ? (
              <Button onClick={() => nav(`/employees/exits?employee=${id}`)}>
                <LogOut size={15} /> Start exit
              </Button>
            ) : null}
            {edit ? (
              <Button onClick={() => setLetter(true)}>
                <FileText size={15} /> Generate letter
              </Button>
            ) : null}
            {edit ? (
              <Button variant="primary" onClick={() => nav(`/employees/${id}/edit`)}>
                <Pencil size={15} /> Edit
              </Button>
            ) : null}
          </>
        }
      />
      {letter ? <GenerateLetterDialog employee={e} onClose={() => setLetter(false)} /> : null}
      {inviteOpen ? (
        <Notice tone={e.invite!.status === "submitted" ? "warn" : "sel"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {e.invite!.status === "submitted"
                ? "Self-onboarding submitted. Review the details and documents, then verify from the Onboarding tab."
                : `Self-onboarding invite ${e.invite!.status === "invited" ? "sent" : e.invite!.status.replace("_", " ")} on ${fmtDate(e.invite!.sentAt.slice(0, 10))} · ${e.invite!.progress}% complete`}
            </span>
            {edit && e.invite!.status !== "submitted" ? (
              <Button size="sm" loading={invite.isPending} onClick={() => invite.mutate()}>
                Resend invite
              </Button>
            ) : e.invite!.status === "submitted" ? (
              <Button size="sm" onClick={() => nav("/employees/onboarding")}>Open onboarding</Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="!gap-3.5 items-center text-center">
          <PhotoEditor employeeId={e.id} name={e.fullName} size={88} endpoint={`/admin/employees/${e.id}/photo`} canEdit={edit} />
          <div>
            <div className="text-[22px] font-medium">{e.fullName}</div>
            <div className="text-muted text-[13px]">{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</div>
            <div className="mt-2">
              <StatusTag status={e.status} label={EMPLOYEE_STATUS_LABELS[e.status as EmployeeStatus]} />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 border-t border-[var(--color-divider)] pt-2 text-left text-[13px]">
            {[
              ["Employee ID", <b key="id" className="font-semibold">{e.employeeCode}</b>],
              ["Branch", e.branch ?? "—"],
              ["Reports to", e.manager ?? "—"],
              ["Joined", fmtDate(e.dateOfJoining)],
              ...(e.annualCtc !== null ? [["Annual CTC", <b key="ctc" className="num font-semibold">{inr(e.annualCtc)}</b>]] : []),
              [
                "Login",
                e.login ? (
                  <span key="login">
                    Active{e.login.twoFactorEnabled ? " · two-factor on" : ""}
                    {e.login.twoFactorEnabled && can("users", "configure") ? (
                      <button type="button" className="ml-1.5 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-[var(--bad)]" onClick={() => setResetting(true)}>
                        Reset
                      </button>
                    ) : null}
                    {resetting ? <ResetTwoFactorDialog member={{ id: e.login.membershipId, name: e.fullName }} onClose={() => setResetting(false)} /> : null}
                  </span>
                ) : e.hasLogin ? "Active" : "Not set up",
              ],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <span className="text-muted">{k}</span>
                <span className="min-w-0 truncate text-right">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="!gap-[18px] min-w-0 bg-[var(--color-surface)]">
          <PillTabs value={tab} onChange={setTab} tabs={tabs} />

          {tab === "personal" ? (
            <div className={grid}>
              <KV label="Full name"><b className="font-semibold">{e.fullName}</b></KV>
              <KV label="Date of birth">{fmtDate(e.dateOfBirth)}</KV>
              <KV label="Gender">{gender(e.gender)}</KV>
              <KV label="Work email">{e.workEmail}</KV>
              <KV label="Personal email">{e.personalEmail}</KV>
              <KV label="Phone">{e.phone}</KV>
              <KV label="Marital status">{e.maritalStatus}</KV>
              <KV label="Blood group">{e.bloodGroup}</KV>
              <KV label="Current address" span>{e.currentAddress}</KV>
              <KV label="Permanent address" span>{e.permanentAddress}</KV>
              <KV label="Emergency contact">
                {e.emergencyContactName ? [e.emergencyContactName, e.emergencyContactRelation && `(${e.emergencyContactRelation})`, e.emergencyContactPhone && `· ${e.emergencyContactPhone}`].filter(Boolean).join(" ") : null}
              </KV>
            </div>
          ) : null}

          {tab === "employment" ? (
            <div className={grid}>
              <KV label="Date of joining">{fmtDate(e.dateOfJoining)}</KV>
              <KV label="Department">{e.department}</KV>
              <KV label="Designation">{e.designation}</KV>
              <KV label="Reporting manager">{e.manager}</KV>
              <KV label="Employment type">{EMPLOYMENT_TYPE_LABELS[e.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS] ?? e.employmentType}</KV>
              <KV label="Branch">{e.branch ? `${e.branch}${e.branchState ? `, ${e.branchState}` : ""}` : null}</KV>
              <KV label="Work location">{e.workLocation}</KV>
              <KV label="Employee status"><StatusTag status={e.status} label={EMPLOYEE_STATUS_LABELS[e.status as EmployeeStatus]} /></KV>
              <KV label="Probation period">{e.probationMonths} months</KV>
              <KV label="Confirmation date">{e.confirmationDate ? fmtDate(e.confirmationDate) : `${e.probationMonths} months from joining`}</KV>
              <KV label="Shift">{e.shift ?? "Company default"}</KV>
              <KV label="Resignation / last working day">{e.resignationDate || e.lastWorkingDay ? `${fmtDate(e.resignationDate)} / ${fmtDate(e.lastWorkingDay)}` : "—"}</KV>
            </div>
          ) : null}

          {tab === "bank" ? (
            <div className={grid}>
              <KV label="Account holder">{e.accountHolderName}</KV>
              <KV label="Bank">{e.bankName}</KV>
              <KV label="Account number">
                {e.accountLast4 ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="num">{revealed ?? `···· ${e.accountLast4}`}</span>
                    {edit && !revealed ? (
                      <Button size="sm" variant="ghost" loading={reveal.isPending} onClick={() => reveal.mutate()} title="Viewing the full number is recorded in the audit log">
                        <Eye size={14} /> Show
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </KV>
              <KV label="IFSC">{e.ifsc}</KV>
              <KV label="Payment method">{{ bank_transfer: "Bank transfer (NEFT / IMPS)", cheque: "Cheque", cash: "Cash" }[e.paymentMethod] ?? e.paymentMethod}</KV>
              <KV label="Verification">{e.accountLast4 ? <Tag tone={e.bankVerified ? "ok" : "warn"}>{e.bankVerified ? "Verified" : "Not verified"}</Tag> : "—"}</KV>
            </div>
          ) : null}

          {tab === "statutory" ? (
            <div className={grid}>
              <KV label="PAN">{e.pan}</KV>
              <KV label="Aadhaar (reference)">{e.aadhaarLast4 ? `XXXX XXXX ${e.aadhaarLast4}` : null}</KV>
              <KV label="UAN">{e.uan}</KV>
              <KV label="ESIC IP number">{e.esicIpNumber}</KV>
              <KV label="PF">{yesNo(e.pfApplicable)}</KV>
              <KV label="ESI">{yesNo(e.esiApplicable)}</KV>
              <KV label="Professional Tax">{yesNo(e.ptApplicable)}</KV>
              <KV label="Tax regime">{e.taxRegime === "old" ? "Old regime" : "New regime"}</KV>
            </div>
          ) : null}

          {tab === "documents" ? (
            <div className="flex flex-col gap-2">
              {e.documents.length === 0 ? <div className="text-muted py-2 text-[13px]">No documents yet.</div> : null}
              {e.documents.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5" style={{ background: "var(--tint-1)" }}>
                  <FileText size={18} style={{ color: "var(--color-accent)" }} className="flex-none" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type}</div>
                    <div className="text-muted truncate text-[12px]">
                      {d.name}
                      {d.sizeBytes ? ` · ${size(d.sizeBytes)}` : ""} · {fmtDate(d.createdAt.slice(0, 10))}
                    </div>
                  </div>
                  <StatusTag status={d.status} label={d.status === "pending" ? "Pending verification" : undefined} />
                  <div className="flex gap-1.5">
                    {edit && d.status !== "verified" ? (
                      <Button size="sm" onClick={() => setDocStatus.mutate({ docId: d.id, status: "verified" })}>Verify</Button>
                    ) : null}
                    {edit && d.status === "pending" ? (
                      <Button size="sm" variant="danger" onClick={() => setDocStatus.mutate({ docId: d.id, status: "rejected" })}>Reject</Button>
                    ) : null}
                    <a className="btn btn-secondary btn-icon !h-8 !w-8" href={`/api/files/documents/${d.id}`} target="_blank" rel="noopener" aria-label={`Download ${d.name}`} title="Download">
                      <Download size={15} />
                    </a>
                    {edit ? (
                      <Button
                        icon
                        size="sm"
                        aria-label={`Delete ${d.name}`}
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete ${d.name}? This can't be undone.`)) delDoc.mutate(d.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {edit ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--color-divider)] pt-3">
                  <Select className="!w-auto min-w-[200px]" value={docType} onChange={(ev) => setDocType(ev.target.value as DocumentType)} aria-label="Document type">
                    {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
                  </Select>
                  <label className="btn btn-secondary min-w-0 max-w-full cursor-pointer">
                    <Upload size={15} />
                    <span className="truncate">{file ? file.name : "Choose file"}</span>
                    <input key={fileKey} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
                  </label>
                  <Button variant="primary" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
                    Upload
                  </Button>
                  <span className="text-muted text-[12px]">PDF, PNG, JPG or WebP up to 10 MB</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "attendance" ? <AttendanceMonth employeeId={id} /> : null}
        </Card>
      </div>
    </>
  );
}
