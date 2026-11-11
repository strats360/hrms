import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { fmtDate, inr, todayIST } from "@hrms/shared";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { Tag } from "@/components/ui/tag";
import { useAccounts } from "@/components/payments/shared";
import { ExperienceLetter, RelievingLetter, SettlementStatement, type Company, type FnfLine, type LetterExit } from "@/components/exits/Letters";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { EXIT_TONE } from "./Exits";

interface Manual {
  label: string;
  kind: "earning" | "deduction";
  amount: number;
  taxable?: boolean;
}
interface Result {
  lines: FnfLine[];
  earnings: number;
  deductions: number;
  net: number;
  taxable: number;
  service: { days: number; years: number; completedYears: number };
  notice: { required: number; served: number; shortfall: number };
  gratuityEligible: boolean;
}
interface Preview {
  result: Result;
  structure: { basic: number; gross: number };
  leave: { leaveTypeId: string; name: string; days: number; available: number }[];
  finalPayroll: { month: string; status: string; net: number; onHold: boolean } | null;
  openClaims: { count: number; amount: number };
  openPayments: { count: number; amount: number };
  warnings: string[];
}
interface ExitDetailView extends LetterExit {
  id: string;
  status: string;
  statusLabel: string;
  reason: string | null;
  noticeDays: number;
  noticeWaived: boolean;
  payInLieu: boolean;
  clearance: { key: string; label: string; done: boolean; doneBy?: string | null; doneAt?: string | null; note?: string | null }[];
  heldAssets?: { id: string; tag: string; name: string }[];
  inputs: { manual?: Manual[]; tds?: number; encashDays?: Record<string, number>; notes?: string | null };
  settlement: (Result & { leave: { leaveTypeId: string; name: string; days: number }[] }) | null;
  netAmount: number | null;
  preparedAt: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  preview: Preview | null;
  payment: { id: string; reference: string; status: string; amount: number; utr: string | null; batchId: string; batchCode: string } | null;
  employee: LetterExit["employee"] & { id: string; status: string; workEmail?: string };
}

const OPEN = ["requested", "notice", "settlement"];

export default function ExitDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["exit", id], queryFn: () => api.get<ExitDetailView>(`/admin/exits/${id}`) });
  const company = useQuery({ queryKey: ["org", "tenant"], queryFn: () => api.get<Company>("/admin/org/tenant"), staleTime: 300_000 });
  const [dialog, setDialog] = useState<null | "accept" | "edit" | "pay" | "settle" | "cancel">(null);
  const [letter, setLetter] = useState<null | "statement" | "relieving" | "experience">(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["exit", id] });
    qc.invalidateQueries({ queryKey: ["exits"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["employee-stats"] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/admin/exits/${id}/${path}`, body ?? {}),
    onSuccess: (_d, v) => {
      toast.success(({ approve: "Settlement approved", reopen: "Settlement reopened" } as Record<string, string>)[v.path] ?? "Saved");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const x = q.data;
  const e = x.employee;
  const editHr = can("employees", "edit");
  const money = can("payroll", "view");
  const isOpen = OPEN.includes(x.status);
  const paymentLive = x.payment && x.payment.status !== "cancelled";
  const ended = x.lastWorkingDay <= todayIST();

  const actions = (
    <>
      {x.status === "requested" && editHr ? (
        <Button variant="primary" onClick={() => setDialog("accept")}>
          Accept resignation
        </Button>
      ) : null}
      {x.status === "settlement" && can("payroll", "approve") ? (
        <Button variant="primary" loading={act.isPending && act.variables?.path === "approve"} onClick={() => act.mutate({ path: "approve" })}>
          Approve settlement
        </Button>
      ) : null}
      {x.status === "approved" && !paymentLive && Number(x.netAmount) > 0 && can("payments", "edit") ? (
        <Button variant="primary" onClick={() => setDialog("pay")}>
          Pay via payment batch
        </Button>
      ) : null}
      {x.status === "approved" && !paymentLive && can("payroll", "approve") ? <Button onClick={() => setDialog("settle")}>Mark settled</Button> : null}
      <Menu
        trigger={
          <Button>
            <FileText size={16} /> Letters
          </Button>
        }
        items={[
          { label: "Settlement statement", onSelect: () => setLetter("statement"), disabled: !x.settlement || !money },
          { label: "Relieving letter", onSelect: () => setLetter("relieving"), disabled: x.status !== "settled" },
          { label: "Experience letter", onSelect: () => setLetter("experience"), disabled: !ended || x.status === "cancelled" || x.status === "requested" },
        ]}
      />
      {isOpen && editHr ? (
        <Menu
          trigger={<Button>More</Button>}
          items={[
            ...(x.status !== "requested" ? [{ label: "Change dates or notice", onSelect: () => setDialog("edit") }] : []),
            { label: x.status === "requested" ? "Decline resignation" : "Withdraw exit", danger: true, onSelect: () => setDialog("cancel") },
          ]}
        />
      ) : null}
      {x.status === "approved" && !paymentLive && can("payroll", "approve") ? <Button onClick={() => act.mutate({ path: "reopen" })}>Reopen</Button> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/employees/exits" className="text-muted inline-flex items-center gap-1 text-[13px]">
          <ArrowLeft size={14} /> Exits
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {e.name} <Tag tone={EXIT_TONE[x.status] ?? "neutral"}>{x.statusLabel}</Tag>
          </span>
        }
        sub={`${x.typeLabel} · ${x.code} · ${e.code}${e.designation ? ` · ${e.designation}` : ""}`}
        actions={actions}
      />
      {x.status === "cancelled" && x.cancelReason ? <Notice tone="sel">Withdrawn: {x.cancelReason}</Notice> : null}
      {x.status === "requested" ? <Notice tone="sel">{e.name} submitted this resignation. Accept it to confirm the last working day, or decline it.</Notice> : null}
      {paymentLive ? (
        <Notice tone={x.payment!.status === "paid" ? "ok" : "sel"}>
          Payment {x.payment!.reference} for {inr(x.payment!.amount)} is {x.payment!.status} in{" "}
          <Link to={`/payments/batches/${x.payment!.batchId}`} className="underline">
            {x.payment!.batchCode}
          </Link>
          . The exit closes when it's marked paid.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Exit details" actions={<Button size="sm" variant="ghost" onClick={() => nav(`/employees/${e.id}`)}>Profile</Button>} />
            <div className="grid grid-cols-2 gap-3 text-[13.5px]">
              <KV label="Date of joining">{fmtDate(e.dateOfJoining)}</KV>
              <KV label="Department">{e.department}</KV>
              <KV label={x.type === "resignation" ? "Resigned on" : "Notice date"}>{fmtDate(x.resignationDate)}</KV>
              <KV label="Last working day">{fmtDate(x.lastWorkingDay)}</KV>
              <KV label="Notice period">
                {x.noticeDays} days{x.noticeWaived ? " (shortfall waived)" : ""}
                {x.payInLieu ? " · paid in lieu" : ""}
              </KV>
              <KV label="Notice served">{x.preview ? `${x.preview.result.notice.served} days${x.preview.result.notice.shortfall ? `, ${x.preview.result.notice.shortfall} short` : ""}` : x.settlement ? `${x.settlement.notice.served} days` : "—"}</KV>
              {x.reason ? (
                <KV label="Reason" span>
                  {x.reason}
                </KV>
              ) : null}
            </div>
          </Card>
          <Clearance x={x} editable={editHr && x.status !== "settled" && x.status !== "cancelled"} onChange={refresh} />
        </div>
        {money ? <SettlementCard x={x} onSaved={refresh} /> : <Card><CardHeader title="Full and final settlement" sub="Payroll prepares and approves the settlement." /></Card>}
      </div>

      <AcceptDialog open={dialog === "accept"} x={x} onClose={() => setDialog(null)} onDone={refresh} />
      <EditDialog open={dialog === "edit"} x={x} onClose={() => setDialog(null)} onDone={refresh} />
      <PayDialog open={dialog === "pay"} x={x} onClose={() => setDialog(null)} onDone={refresh} />
      <SettleDialog open={dialog === "settle"} x={x} onClose={() => setDialog(null)} onDone={refresh} />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(v) => !v && setDialog(null)}
        title={x.status === "requested" ? "Decline this resignation?" : "Withdraw this exit?"}
        confirmLabel={x.status === "requested" ? "Decline" : "Withdraw exit"}
        onConfirm={async (reason) => {
          await api.post(`/admin/exits/${id}/cancel`, { reason });
          toast.success(x.status === "requested" ? "Resignation declined. The employee has been told." : `Exit withdrawn. ${e.name} is back to their earlier status.`);
          setDialog(null);
          refresh();
        }}
      />
      <Dialog
        open={!!letter && !!company.data}
        onOpenChange={(v) => !v && setLetter(null)}
        title={letter === "statement" ? "Settlement statement" : letter === "relieving" ? "Relieving letter" : "Experience letter"}
        width={760}
        footer={
          <>
            <Button onClick={() => setLetter(null)}>Close</Button>
            <Button variant="primary" onClick={() => window.print()}>
              <Printer size={16} /> Print or save PDF
            </Button>
          </>
        }
      >
        <div id="letter-print">
          {company.data && letter === "statement" ? <SettlementStatement company={company.data} exit={x as LetterExit} /> : null}
          {company.data && letter === "relieving" ? <RelievingLetter company={company.data} exit={x} /> : null}
          {company.data && letter === "experience" ? <ExperienceLetter company={company.data} exit={x} /> : null}
        </div>
      </Dialog>
    </div>
  );
}

function Clearance({ x, editable, onChange }: { x: ExitDetailView; editable: boolean; onChange: () => void }) {
  const tick = useMutation({
    mutationFn: (b: { key: string; done: boolean }) => api.post(`/admin/exits/${x.id}/clearance`, b),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const done = x.clearance.filter((i) => i.done).length;
  return (
    <Card>
      <CardHeader title="Exit checklist" sub={`${done} of ${x.clearance.length} done. All of it is needed before the settlement is approved.`} />
      <div className="flex flex-col gap-2.5">
        {x.clearance.map((i) => (
          <div key={i.key} className="flex flex-col gap-0.5">
            <Checkbox checked={i.done} disabled={!editable || tick.isPending} onChange={(v) => tick.mutate({ key: i.key, done: v })} label={i.label} />
            {i.done && i.doneBy ? <div className="text-muted pl-7 text-[12px]">{`${i.doneBy}${i.doneAt ? `, ${fmtDate(i.doneAt.slice(0, 10))}` : ""}`}</div> : null}
            {i.key === "assets" && x.heldAssets?.length ? (
              <div className="pl-7 text-[12.5px] text-[var(--bad)]">
                Still with them:{" "}
                {x.heldAssets.map((a, n) => (
                  <span key={a.id}>{n ? ", " : ""}<Link to={`/assets/${a.id}`}>{a.name} ({a.tag})</Link></span>
                ))}
                . It ticks itself once they're returned.
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettlementCard({ x, onSaved }: { x: ExitDetailView; onSaved: () => void }) {
  const { can } = useSession();
  const editable = (x.status === "notice" || x.status === "settlement") && can("payroll", "edit");
  const [manual, setManual] = useState<Manual[]>(x.inputs.manual ?? []);
  const [tds, setTds] = useState(String(x.inputs.tds ?? 0));
  const [encash, setEncash] = useState<Record<string, string>>(Object.fromEntries(Object.entries(x.inputs.encashDays ?? {}).map(([k, v]) => [k, String(v)])));
  const [notes, setNotes] = useState(x.inputs.notes ?? "");
  useEffect(() => {
    setManual(x.inputs.manual ?? []);
    setTds(String(x.inputs.tds ?? 0));
    setNotes(x.inputs.notes ?? "");
  }, [x.inputs]);

  const body = useMemo(
    () => ({
      manual: manual.filter((m) => m.label.trim() && m.amount > 0),
      tds: Number(tds) || 0,
      encashDays: Object.fromEntries(Object.entries(encash).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
      notes: notes.trim() || null,
    }),
    [manual, tds, encash, notes],
  );
  // live figures while editing; the saved statement once approved
  const live = useQuery({
    queryKey: ["exit", x.id, "preview", body],
    queryFn: () => api.post<Preview>(`/admin/exits/${x.id}/settlement/preview`, body),
    enabled: editable,
    placeholderData: (p) => p,
  });
  const save = useMutation({
    mutationFn: () => api.put<{ warnings: string[] }>(`/admin/exits/${x.id}/settlement`, body),
    onSuccess: () => {
      toast.success("Settlement saved. Someone else with payroll approval can now approve it.");
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const view = editable ? (live.data ?? x.preview) : x.preview;
  const r: Result | null = editable ? (view?.result ?? null) : (x.settlement ?? view?.result ?? null);
  if (!r) return null;
  const earn = r.lines.filter((l) => l.kind === "earning");
  const ded = r.lines.filter((l) => l.kind === "deduction");

  return (
    <Card>
      <CardHeader
        title="Full and final settlement"
        sub={x.status === "approved" || x.status === "settled" ? `Approved${x.approvedAt ? ` on ${fmtDate(x.approvedAt.slice(0, 10))}` : ""}` : x.status === "settlement" ? "Drafted. Changes below need saving again." : "Not drafted yet"}
        actions={
          editable ? (
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {x.status === "settlement" ? "Save changes" : "Save draft"}
            </Button>
          ) : null
        }
      />
      {view?.warnings.length && x.status !== "settled" ? (
        <div className="flex flex-col gap-1.5">
          {view.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
        </div>
      ) : null}
      {view ? (
        <div className="text-muted grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
          <span>Basic {inr(view.structure.basic)}/mo</span>
          <span>Gross {inr(view.structure.gross)}/mo</span>
          <span>Service {r.service.years} yrs</span>
          <span>{r.gratuityEligible ? "Gratuity eligible" : "No gratuity (under 4 yrs 240 days)"}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <LineList title="Payable" lines={earn} total={r.earnings} />
        <LineList title="Recoveries and deductions" lines={ded} total={r.deductions} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-3.5 py-3" style={{ background: r.net >= 0 ? "var(--ok-bg)" : "var(--warn-bg, var(--tint-2))" }}>
        <span className="font-medium">{r.net >= 0 ? "Net payable to the employee" : "Net recoverable from the employee"}</span>
        <span className="num text-[18px] font-semibold">{inr(Math.abs(r.net))}</span>
        {r.taxable > 0 ? <span className="text-muted w-full text-[12px]">Taxable part: {inr(r.taxable)} (gratuity up to ₹20 lakh and leave encashment up to ₹25 lakh are exempt)</span> : null}
      </div>

      {editable && view ? (
        <div className="flex flex-col gap-4 border-t border-[var(--color-divider)] pt-4">
          {view.leave.length ? (
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Leave to encash</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {view.leave.map((l) => (
                  <Field key={l.leaveTypeId} label={`${l.name} (${l.available} available)`}>
                    <Input type="number" min={0} max={l.available} step={0.5} placeholder={String(l.available)} value={encash[l.leaveTypeId] ?? ""} onChange={(ev) => setEncash({ ...encash, [l.leaveTypeId]: ev.target.value })} />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium">Other earnings and recoveries</span>
              <Button size="sm" onClick={() => setManual([...manual, { label: "", kind: "deduction", amount: 0 }])}>
                <Plus size={14} /> Add line
              </Button>
            </div>
            {manual.length ? (
              <div className="flex flex-col gap-2">
                {manual.map((m, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px_110px_auto] items-center gap-2">
                    <Input placeholder="e.g. Notice buyout, laptop recovery, bonus" value={m.label} onChange={(ev) => setManual(manual.map((y, j) => (j === i ? { ...y, label: ev.target.value } : y)))} />
                    <Select value={m.kind} onChange={(ev) => setManual(manual.map((y, j) => (j === i ? { ...y, kind: ev.target.value as Manual["kind"] } : y)))}>
                      <option value="earning">Earning</option>
                      <option value="deduction">Recovery</option>
                    </Select>
                    <Input type="number" min={0} placeholder="Amount" value={m.amount || ""} onChange={(ev) => setManual(manual.map((y, j) => (j === i ? { ...y, amount: Number(ev.target.value) } : y)))} />
                    <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setManual(manual.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted text-[12.5px]">Loan or advance recoveries, assets not returned, notice buyout, pending incentives.</div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="TDS on the settlement" hint="From the employee's tax computation">
              <Input type="number" min={0} value={tds} onChange={(ev) => setTds(ev.target.value)} />
            </Field>
            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
            </Field>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function LineList({ title, lines, total }: { title: string; lines: FnfLine[]; total: number }) {
  return (
    <div className="text-[13px]">
      <div className="mb-1 font-medium">{title}</div>
      {lines.length ? (
        lines.map((l) => (
          <div key={l.key} className="flex justify-between gap-2 border-b border-[var(--color-divider)] py-1.5">
            <span>
              {l.label}
              {l.note ? <span className="text-muted block text-[11.5px]">{l.note}</span> : null}
            </span>
            <span className="num">{inr(l.amount)}</span>
          </div>
        ))
      ) : (
        <div className="text-muted py-1.5">None</div>
      )}
      <div className="flex justify-between py-1.5 font-medium">
        <span>Total</span>
        <span className="num">{inr(total)}</span>
      </div>
    </div>
  );
}

function AcceptDialog({ open, x, onClose, onDone }: { open: boolean; x: ExitDetailView; onClose: () => void; onDone: () => void }) {
  const [lwd, setLwd] = useState(x.lastWorkingDay);
  const [waive, setWaive] = useState(false);
  const accept = useMutation({
    mutationFn: () => api.post(`/admin/exits/${x.id}/accept`, { lastWorkingDay: lwd, noticeWaived: waive }),
    onSuccess: () => {
      toast.success("Resignation accepted. The employee has been emailed.");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Accept resignation"
      description={`${x.employee.name} resigned on ${fmtDate(x.resignationDate)} with a ${x.noticeDays}-day notice period.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={accept.isPending} onClick={() => accept.mutate()}>
            Accept
          </Button>
        </>
      }
    >
      <Field label="Last working day">
        <Input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} />
      </Field>
      <Checkbox checked={waive} onChange={setWaive} label="Waive any notice shortfall (no recovery)" />
    </Dialog>
  );
}

function EditDialog({ open, x, onClose, onDone }: { open: boolean; x: ExitDetailView; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ resignationDate: x.resignationDate, lastWorkingDay: x.lastWorkingDay, noticeDays: String(x.noticeDays), noticeWaived: x.noticeWaived, payInLieu: x.payInLieu });
  useEffect(() => setF({ resignationDate: x.resignationDate, lastWorkingDay: x.lastWorkingDay, noticeDays: String(x.noticeDays), noticeWaived: x.noticeWaived, payInLieu: x.payInLieu }), [x, open]);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/exits/${x.id}`, { ...f, noticeDays: Number(f.noticeDays) }),
    onSuccess: () => {
      toast.success(x.status === "settlement" ? "Saved. Draft the settlement again with the new dates." : "Saved");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Change dates or notice"
      description={x.status === "settlement" ? "Changing these clears the drafted settlement, so it's worked out again." : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Resignation / notice date">
          <Input type="date" value={f.resignationDate} onChange={(e) => setF({ ...f, resignationDate: e.target.value })} />
        </Field>
        <Field label="Last working day">
          <Input type="date" value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} />
        </Field>
        <Field label="Notice period (days)">
          <Input type="number" min={0} max={180} value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value })} />
        </Field>
      </div>
      <Checkbox checked={f.noticeWaived} onChange={(v) => setF({ ...f, noticeWaived: v })} label="Waive any notice shortfall" />
      {x.type === "termination" ? <Checkbox checked={f.payInLieu} onChange={(v) => setF({ ...f, payInLieu: v })} label="Pay the shortfall in lieu of notice" /> : null}
    </Dialog>
  );
}

function PayDialog({ open, x, onClose, onDone }: { open: boolean; x: ExitDetailView; onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => (a as { active?: boolean }).active !== false);
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayIST());
  useEffect(() => {
    if (!account && active[0]) setAccount(active[0].id);
  }, [active, account]);
  const pay = useMutation({
    mutationFn: () => api.post<{ batchId: string; batchCode: string }>(`/admin/exits/${x.id}/pay`, { bankAccountId: account, paymentDate: date }),
    onSuccess: (r) => {
      toast.success(`${r.batchCode} created. Approve it and export the bank file under Payments.`);
      onDone();
      onClose();
      nav(`/payments/batches/${r.batchId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Pay the settlement"
      description={`Creates a payment batch for ${inr(Number(x.netAmount))} to ${x.employee.name}. It goes through the usual approval and bank file, and the exit closes when the payment is marked paid.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!account} loading={pay.isPending} onClick={() => pay.mutate()}>
            Create payment batch
          </Button>
        </>
      }
    >
      <Field label="Debit account">
        <Select value={account} onChange={(e) => setAccount(e.target.value)}>
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.bankName} ····{a.accountLast4}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Payment date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function SettleDialog({ open, x, onClose, onDone }: { open: boolean; x: ExitDetailView; onClose: () => void; onDone: () => void }) {
  const net = Number(x.netAmount);
  const [method, setMethod] = useState(net < 0 ? "recovered" : net === 0 ? "nothing_due" : "cheque");
  const [on, setOn] = useState(todayIST());
  const [ref, setRef] = useState("");
  const settle = useMutation({
    mutationFn: () => api.post(`/admin/exits/${x.id}/settle`, { settledOn: on, method, reference: ref.trim() || null }),
    onSuccess: () => {
      toast.success(`${x.employee.name}'s exit is settled and closed`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Mark settled"
      description={net < 0 ? `${x.employee.name} owes ${inr(-net)}. Record how it was recovered.` : `Record how the ${inr(net)} was paid outside a payment batch.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={settle.isPending} onClick={() => settle.mutate()}>
            Mark settled
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="How">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cheque">Cheque</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="recovered">Recovered from the employee</option>
            <option value="nothing_due">Nothing due either way</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Reference" hint="Cheque number, UTR or receipt">
        <Input value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </Dialog>
  );
}
