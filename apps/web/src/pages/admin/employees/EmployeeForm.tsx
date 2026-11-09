import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Check } from "lucide-react";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, employeeCreateSchema, employeeUpdateSchema, inr, todayIST } from "@hrms/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Segmented, Select } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { EmployeeDetail, Lookups } from "@/lib/types";

type Form = {
  firstName: string;
  lastName: string;
  workEmail: string;
  personalEmail: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  bloodGroup: string;
  currentAddress: string;
  permanentAddress: string;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
  employeeCode: string;
  dateOfJoining: string;
  departmentId: string;
  designationId: string;
  managerId: string;
  branchId: string;
  shiftId: string;
  biometricId: string;
  employmentType: string;
  workLocation: string;
  status: string;
  probationMonths: string;
  confirmationDate: string;
  resignationDate: string;
  lastWorkingDay: string;
  annualCtc: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  paymentMethod: string;
  pan: string;
  aadhaarLast4: string;
  uan: string;
  esicIpNumber: string;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  sendInvite: boolean;
};

const EMPTY: Form = {
  firstName: "", lastName: "", workEmail: "", personalEmail: "", phone: "", dateOfBirth: "", gender: "", maritalStatus: "", bloodGroup: "",
  currentAddress: "", permanentAddress: "", emergencyContactName: "", emergencyContactRelation: "", emergencyContactPhone: "",
  employeeCode: "", dateOfJoining: todayIST(), departmentId: "", designationId: "", managerId: "", branchId: "", shiftId: "", biometricId: "",
  employmentType: "full_time", workLocation: "", status: "probation", probationMonths: "6", confirmationDate: "", resignationDate: "", lastWorkingDay: "",
  annualCtc: "", accountHolderName: "", bankName: "", accountNumber: "", ifsc: "", paymentMethod: "bank_transfer",
  pan: "", aadhaarLast4: "", uan: "", esicIpNumber: "", pfApplicable: true, esiApplicable: false, ptApplicable: true, taxRegime: "new", sendInvite: true,
};

function fromDetail(e: EmployeeDetail): Form {
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    ...EMPTY,
    firstName: e.firstName, lastName: s(e.lastName), workEmail: e.workEmail, personalEmail: s(e.personalEmail), phone: s(e.phone), dateOfBirth: s(e.dateOfBirth),
    gender: s(e.gender), maritalStatus: s(e.maritalStatus), bloodGroup: s(e.bloodGroup), currentAddress: s(e.currentAddress), permanentAddress: s(e.permanentAddress),
    emergencyContactName: s(e.emergencyContactName), emergencyContactRelation: s(e.emergencyContactRelation), emergencyContactPhone: s(e.emergencyContactPhone),
    employeeCode: e.employeeCode, dateOfJoining: e.dateOfJoining, departmentId: s(e.departmentId), designationId: s(e.designationId), managerId: s(e.managerId),
    branchId: s(e.branchId), shiftId: s(e.shiftId), biometricId: s(e.biometricId), employmentType: e.employmentType, workLocation: s(e.workLocation), status: e.status,
    probationMonths: String(e.probationMonths), confirmationDate: s(e.confirmationDate), resignationDate: s(e.resignationDate), lastWorkingDay: s(e.lastWorkingDay),
    annualCtc: s(e.annualCtc), accountHolderName: s(e.accountHolderName), bankName: s(e.bankName), accountNumber: "", ifsc: s(e.ifsc), paymentMethod: e.paymentMethod,
    pan: s(e.pan), aadhaarLast4: s(e.aadhaarLast4), uan: s(e.uan), esicIpNumber: s(e.esicIpNumber), pfApplicable: e.pfApplicable, esiApplicable: e.esiApplicable,
    ptApplicable: e.ptApplicable, taxRegime: e.taxRegime, sendInvite: false,
  };
}

/** Fields the update API resets to defaults when omitted, so we always send them on edit. */
const ALWAYS_SEND: (keyof Form)[] = ["employmentType", "status", "probationMonths", "annualCtc", "paymentMethod", "pfApplicable", "esiApplicable", "ptApplicable", "taxRegime"];

const REQUIRED: (keyof Form)[] = ["firstName", "workEmail", "dateOfJoining"];
const LABELS: Partial<Record<keyof Form, string>> = { firstName: "First name", workEmail: "Work email", dateOfJoining: "Date of joining" };

/** Turn zod's generic messages into something a person can act on. */
function friendly(k: string, msg: string) {
  if (REQUIRED.includes(k as keyof Form) && (msg.includes("received null") || msg.includes("expected string") || msg.includes("Too small") || msg === "Use YYYY-MM-DD")) return `${LABELS[k as keyof Form]} is required`;
  if (msg.startsWith("Invalid input")) return "Check this value";
  return msg;
}

function toPayload(f: Form, keys: (keyof Form)[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = f[k];
    if (k === "annualCtc") out[k] = v === "" ? 0 : Number(String(v).replace(/[,₹\s]/g, ""));
    else if (k === "probationMonths") out[k] = Number(v || 0);
    else if (typeof v === "string") out[k] = v.trim() === "" ? (REQUIRED.includes(k) ? "" : null) : v.trim();
    else out[k] = v;
  }
  return out;
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card className="!gap-3.5">
      <div>
        <div className="card-title">{title}</div>
        {sub ? <div className="text-muted mt-0.5 text-[13px]">{sub}</div> : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">{children}</div>
    </Card>
  );
}

export default function EmployeeForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/admin/org/lookups"), staleTime: 60_000 });
  const detail = useQuery({ queryKey: ["employee", id], queryFn: () => api.get<EmployeeDetail>(`/admin/employees/${id}`), enabled: isEdit });

  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (detail.data) {
      const f = fromDetail(detail.data);
      setForm(f);
      setInitial(f);
    }
  }, [detail.data]);

  // default shift / head office for new employees
  useEffect(() => {
    if (isEdit || !lookups.data) return;
    setForm((f) => ({
      ...f,
      shiftId: f.shiftId || lookups.data.shifts.find((s) => s.isDefault)?.id || "",
      branchId: f.branchId || lookups.data.branches.find((b) => b.isHeadOffice)?.id || "",
    }));
  }, [isEdit, lookups.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };
  const text = (k: keyof Form) => ({
    value: form[k] as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
    invalid: !!errors[k],
    id: `f-${k}`,
  });
  const err = (k: keyof Form) => errors[k] || null;

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? api.patch<{ id: string }>(`/admin/employees/${id}`, payload) : api.post<{ id: string; employeeCode: string; invited: boolean }>("/admin/employees", payload),
    meta: { silent: true },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee", r.id] });
      qc.invalidateQueries({ queryKey: ["employee-stats"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["lookups"] });
      const created = r as { employeeCode?: string; invited?: boolean };
      toast.success(isEdit ? "Changes saved" : `${form.firstName} added as ${created.employeeCode}${created.invited ? ". Onboarding invite sent." : ""}`);
      nav(`/employees/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details)) {
        const fe: Record<string, string> = {};
        for (const i of e.details as { path?: (string | number)[]; message: string }[]) if (i.path?.[0]) fe[String(i.path[0])] = friendly(String(i.path[0]), i.message);
        setErrors(fe);
      }
      setServerError(e instanceof Error ? e.message : "Could not save");
    },
  });

  const submit = () => {
    setServerError(null);
    let payload: Record<string, unknown>;
    if (isEdit) {
      const changed = (Object.keys(form) as (keyof Form)[]).filter((k) => k !== "sendInvite" && k !== "employeeCode" && form[k] !== initial[k]);
      if (form.accountNumber.trim() === "") {
        const i = changed.indexOf("accountNumber");
        if (i >= 0) changed.splice(i, 1);
      }
      if (!changed.length) {
        toast("Nothing to save");
        return;
      }
      payload = toPayload(form, [...new Set([...changed, ...ALWAYS_SEND])]);
    } else {
      payload = toPayload(
        form,
        (Object.keys(form) as (keyof Form)[]).filter((k) => !(k === "accountNumber" && !form.accountNumber.trim())),
      );
    }
    const parsed = (isEdit ? employeeUpdateSchema : employeeCreateSchema).safeParse(payload);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) if (i.path[0] !== undefined && !fe[String(i.path[0])]) fe[String(i.path[0])] = friendly(String(i.path[0]), i.message);
      setErrors(fe);
      setServerError("Some fields need attention. Check the highlighted fields.");
      const first = Object.keys(fe)[0];
      if (first) document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setErrors({});
    save.mutate(payload);
  };

  const monthly = useMemo(() => {
    const n = Number(form.annualCtc.replace(/[,₹\s]/g, ""));
    return n > 0 ? inr(n / 12) : null;
  }, [form.annualCtc]);

  if (!can("employees", "edit")) return <Notice tone="warn">You don't have permission to add or edit employees.</Notice>;
  if (isEdit && detail.isLoading) return <Loading />;
  if (isEdit && detail.error) return <ErrorState error={detail.error} retry={() => detail.refetch()} />;

  const L = lookups.data;
  const managers = (L?.employees ?? []).filter((e) => e.id !== id);
  const fullName = [form.firstName, form.lastName].filter(Boolean).join(" ");

  return (
    <>
      {isEdit ? (
        <>
          <Link to={`/employees/${id}`} className="inline-flex items-center gap-1 text-[13px] no-underline">
            <ChevronLeft size={15} /> Back to profile
          </Link>
          <PageHeader title={`Edit ${detail.data?.fullName ?? "employee"}`} sub={detail.data ? `${detail.data.employeeCode} · ${detail.data.workEmail}` : undefined} />
        </>
      ) : null}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
          <Section title="Personal information">
            <Field label="First name *" error={err("firstName")} htmlFor="f-firstName"><Input {...text("firstName")} autoComplete="off" /></Field>
            <Field label="Last name" error={err("lastName")} htmlFor="f-lastName"><Input {...text("lastName")} autoComplete="off" /></Field>
            <Field label="Work email *" error={err("workEmail")} htmlFor="f-workEmail" hint={isEdit ? undefined : "Used for login and the onboarding invite"}><Input type="email" {...text("workEmail")} placeholder="name@company.com" /></Field>
            <Field label="Personal email" error={err("personalEmail")} htmlFor="f-personalEmail"><Input type="email" {...text("personalEmail")} placeholder="name@gmail.com" /></Field>
            <Field label="Phone" error={err("phone")} htmlFor="f-phone"><Input type="tel" {...text("phone")} placeholder="+91 98240 11872" /></Field>
            <Field label="Date of birth" error={err("dateOfBirth")} htmlFor="f-dateOfBirth"><Input type="date" {...text("dateOfBirth")} /></Field>
            <Field label="Gender" error={err("gender")} htmlFor="f-gender">
              <Select {...text("gender")}>
                <option value="">Select</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="undisclosed">Prefer not to say</option>
              </Select>
            </Field>
            <Field label="Marital status" htmlFor="f-maritalStatus">
              <Select {...text("maritalStatus")}>
                <option value="">Select</option>
                <option>Single</option>
                <option>Married</option>
                <option>Divorced</option>
                <option>Widowed</option>
              </Select>
            </Field>
            <Field label="Blood group" error={err("bloodGroup")} htmlFor="f-bloodGroup"><Input {...text("bloodGroup")} placeholder="O+" maxLength={5} /></Field>
            <Field label="Current address" span error={err("currentAddress")} htmlFor="f-currentAddress"><Input {...text("currentAddress")} placeholder="House, street, area, city, PIN" /></Field>
            <Field label="Permanent address" span error={err("permanentAddress")} htmlFor="f-permanentAddress"><Input {...text("permanentAddress")} placeholder="Leave blank if same as current" /></Field>
            <Field label="Emergency contact name" error={err("emergencyContactName")} htmlFor="f-emergencyContactName"><Input {...text("emergencyContactName")} /></Field>
            <Field label="Relation" error={err("emergencyContactRelation")} htmlFor="f-emergencyContactRelation"><Input {...text("emergencyContactRelation")} placeholder="Father, spouse…" /></Field>
            <Field label="Emergency phone" error={err("emergencyContactPhone")} htmlFor="f-emergencyContactPhone"><Input type="tel" {...text("emergencyContactPhone")} /></Field>
          </Section>

          <Section title="Employment">
            {isEdit ? (
              <Field label="Employee ID" hint="Assigned automatically"><Input value={form.employeeCode} readOnly /></Field>
            ) : null}
            <Field label="Date of joining *" error={err("dateOfJoining")} htmlFor="f-dateOfJoining"><Input type="date" {...text("dateOfJoining")} /></Field>
            <Field label="Department" error={err("departmentId")} htmlFor="f-departmentId">
              <Select {...text("departmentId")}>
                <option value="">Select</option>
                {L?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Designation" error={err("designationId")} htmlFor="f-designationId">
              <Select {...text("designationId")}>
                <option value="">Select</option>
                {L?.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Reporting manager" error={err("managerId")} htmlFor="f-managerId">
              <Select {...text("managerId")}>
                <option value="">None</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
              </Select>
            </Field>
            <Field label="Employment type" htmlFor="f-employmentType">
              <Select {...text("employmentType")}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
              </Select>
            </Field>
            <Field label="Branch" error={err("branchId")} htmlFor="f-branchId">
              <Select {...text("branchId")}>
                <option value="">Select</option>
                {L?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Work location" htmlFor="f-workLocation"><Input {...text("workLocation")} placeholder="Office, remote, client site" /></Field>
            <Field label="Shift" error={err("shiftId")} htmlFor="f-shiftId">
              <Select {...text("shiftId")}>
                <option value="">Company default</option>
                {L?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.startTime}–{s.endTime}</option>)}
              </Select>
            </Field>
            <Field label="Biometric ID" error={err("biometricId")} htmlFor="f-biometricId" hint="Enrolment number on the attendance device, if it isn't the employee ID">
              <Input {...text("biometricId")} placeholder="e.g. 1042" />
            </Field>
            {isEdit || !form.sendInvite ? (
              <Field label="Status" htmlFor="f-status">
                <Select {...text("status")}>
                  {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="Probation (months)" error={err("probationMonths")} htmlFor="f-probationMonths"><Input type="number" min={0} max={24} {...text("probationMonths")} /></Field>
            <Field label="Annual CTC (₹)" error={err("annualCtc")} htmlFor="f-annualCtc" hint={monthly ? `About ${monthly} a month` : undefined}><Input inputMode="numeric" {...text("annualCtc")} placeholder="840000" /></Field>
            {isEdit ? (
              <>
                <Field label="Confirmation date" error={err("confirmationDate")} htmlFor="f-confirmationDate"><Input type="date" {...text("confirmationDate")} /></Field>
                <Field label="Resignation date" error={err("resignationDate")} htmlFor="f-resignationDate"><Input type="date" {...text("resignationDate")} /></Field>
                <Field label="Last working day" error={err("lastWorkingDay")} htmlFor="f-lastWorkingDay"><Input type="date" {...text("lastWorkingDay")} /></Field>
              </>
            ) : null}
          </Section>

          <Section title="Bank" sub={!isEdit && form.sendInvite ? "Optional. The employee can add this during self-onboarding." : undefined}>
            <Field label="Account holder name" error={err("accountHolderName")} htmlFor="f-accountHolderName"><Input {...text("accountHolderName")} placeholder={fullName || undefined} /></Field>
            <Field label="Bank name" error={err("bankName")} htmlFor="f-bankName"><Input {...text("bankName")} placeholder="HDFC Bank" /></Field>
            <Field label="Account number" error={err("accountNumber")} htmlFor="f-accountNumber" hint={isEdit && detail.data?.accountLast4 ? "Leave blank to keep the current account" : undefined}>
              <Input inputMode="numeric" autoComplete="off" {...text("accountNumber")} placeholder={isEdit && detail.data?.accountLast4 ? `···· ${detail.data.accountLast4}` : "50100…"} />
            </Field>
            <Field label="IFSC" error={err("ifsc")} htmlFor="f-ifsc"><Input {...text("ifsc")} placeholder="HDFC0000412" className="uppercase" /></Field>
            <Field label="Payment method" htmlFor="f-paymentMethod">
              <Select {...text("paymentMethod")}>
                <option value="bank_transfer">Bank transfer (NEFT / IMPS)</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
              </Select>
            </Field>
          </Section>

          <Section title="Statutory">
            <Field label="PAN" error={err("pan")} htmlFor="f-pan"><Input {...text("pan")} placeholder="ABCDE1234F" className="uppercase" maxLength={10} /></Field>
            <Field label="Aadhaar (last 4 digits only)" error={err("aadhaarLast4")} htmlFor="f-aadhaarLast4"><Input inputMode="numeric" {...text("aadhaarLast4")} placeholder="1234" maxLength={4} /></Field>
            <Field label="UAN (if existing)" error={err("uan")} htmlFor="f-uan"><Input inputMode="numeric" {...text("uan")} placeholder="12 digits" maxLength={12} /></Field>
            <Field label="ESIC IP number" error={err("esicIpNumber")} htmlFor="f-esicIpNumber"><Input inputMode="numeric" {...text("esicIpNumber")} placeholder="10 digits" maxLength={10} /></Field>
            <Field label="Tax regime">
              <Segmented value={form.taxRegime} onChange={(v) => set("taxRegime", v)} options={[{ value: "new", label: "New" }, { value: "old", label: "Old" }]} />
            </Field>
            <Field label="Applicability" span>
              <div className="flex flex-wrap gap-5 pt-1">
                <Checkbox checked={form.pfApplicable} onChange={(v) => set("pfApplicable", v)} label="PF" />
                <Checkbox checked={form.esiApplicable} onChange={(v) => set("esiApplicable", v)} label="ESI (gross up to ₹21,000)" />
                <Checkbox checked={form.ptApplicable} onChange={(v) => set("ptApplicable", v)} label="Professional Tax" />
              </div>
            </Field>
          </Section>

          {!isEdit ? (
            <Card className="!gap-2">
              <Checkbox
                checked={form.sendInvite}
                onChange={(v) => set("sendInvite", v)}
                label={<span className="font-medium">Send a self-onboarding invite by email</span>}
              />
              <div className="text-muted pl-6 text-[13px]">
                The employee gets a secure link to set a password and fill in their personal, bank and tax details and upload documents. HR verifies before they become active.
              </div>
            </Card>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => nav(isEdit ? `/employees/${id}` : "/employees")}>Cancel</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {isEdit ? "Save changes" : form.sendInvite ? "Create employee & send invite" : "Create employee"}
            </Button>
          </div>
        </div>

        <Card className="!gap-3 xl:sticky xl:top-[90px]">
          <div className="card-kicker">{isEdit ? "Record" : "Onboarding checklist"}</div>
          <div className="flex flex-col gap-2.5 text-[13.5px]">
            {(isEdit
              ? [
                  [!!form.firstName && !!form.workEmail, "Personal & contact details"],
                  [!!form.departmentId && !!form.designationId, "Department & designation"],
                  [!!detail.data?.accountLast4 || !!form.accountNumber, "Bank account"],
                  [!!form.pan, "PAN captured"],
                  [(detail.data?.documents.length ?? 0) > 0, "Documents uploaded"],
                ]
              : [
                  [true, "Employee ID assigned automatically"],
                  [!!form.firstName && !!form.workEmail && !!form.dateOfJoining, "Name, email & joining date"],
                  [!!form.departmentId && !!form.designationId, "Department & designation"],
                  [!!form.accountNumber || form.sendInvite, form.sendInvite ? "Bank details from the employee" : "Bank account"],
                  [!!form.pan || form.sendInvite, form.sendInvite ? "PAN & documents from the employee" : "PAN captured"],
                ]
            ).map(([done, label]) => (
              <div key={String(label)} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full" style={done ? { background: "var(--ok)", color: "var(--color-bg)" } : { border: "2px solid var(--tint-2)" }}>
                  {done ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                {label}
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--color-divider)] pt-2 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
            Bank account numbers are encrypted at rest. Only the last 4 digits are shown in lists.
          </div>
        </Card>
      </form>
    </>
  );
}
