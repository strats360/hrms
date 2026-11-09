import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fmtDate, inr, structureRevisionSchema, todayIST } from "@hrms/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ExtraComponent, Structure } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";

interface Detail {
  employee: { id: string; name: string; code: string; dateOfJoining: string; pfApplicable: boolean; esiApplicable: boolean; taxRegime: string };
  current: Structure;
  history: { id: string; effectiveFrom: string; annualCtc: number; components: Structure["components"] | null; reason: string | null; createdAt: string; structure: Structure }[];
}

type Std = Exclude<keyof Structure["components"], "extras">;
const COMP: [Std, string][] = [
  ["basic", "Basic"],
  ["hra", "House rent allowance"],
  ["conveyance", "Conveyance"],
  ["medical", "Medical"],
  ["special", "Special allowance"],
];

export function Breakdown({ s }: { s: Structure }) {
  return (
    <div className="flex flex-col text-[13.5px]">
      {COMP.filter(([k]) => k !== "special").map(([k, l]) => (
        <div key={k} className="flex justify-between py-1">
          <span>{l}</span>
          <span className="num">{inr(s.components[k])}</span>
        </div>
      ))}
      {(s.components.extras ?? []).map((x) => (
        <div key={x.code} className="flex justify-between py-1">
          <span>
            {x.label}
            {x.taxable === false ? <span className="text-muted text-[12px]"> · not taxable</span> : null}
          </span>
          <span className="num">{inr(x.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1">
        <span>Special allowance</span>
        <span className="num">{inr(s.components.special)}</span>
      </div>
      <div className="flex justify-between border-t border-[var(--color-divider)] py-1.5 font-semibold">
        <span>Monthly gross</span>
        <span className="num">{inr(s.gross)}</span>
      </div>
      <div className="text-muted flex justify-between py-1">
        <span>Employer PF{s.esiApplicable ? " · ESI" : ""}</span>
        <span className="num">{inr(s.employer.pf + s.employer.esi)}</span>
      </div>
      <div className="flex justify-between py-1 font-semibold">
        <span>Monthly CTC</span>
        <span className="num">{inr(s.monthlyCtc)}</span>
      </div>
    </div>
  );
}

export function EmployeeStructureDialog({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payroll", "structures", "detail", employeeId], queryFn: () => api.get<Detail>(`/admin/payroll/structures/${employeeId}`), enabled: !!employeeId });
  const [revising, setRevising] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ctc, setCtc] = useState("");
  const [custom, setCustom] = useState(false);
  const [comps, setComps] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<ExtraComponent[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRevising(false);
    setError(null);
  }, [employeeId]);
  const startRevise = () => {
    const c = q.data!.current;
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    setEffectiveFrom(next.toISOString().slice(0, 10));
    setCtc(String(c.annualCtc));
    setCustom(false);
    setComps(Object.fromEntries(COMP.map(([k]) => [k, String(c.components[k])])));
    setExtras((c.components.extras ?? []).map((x) => ({ ...x, taxable: x.taxable !== false, esiWage: x.esiWage !== false })));
    setReason("");
    setError(null);
    setRevising(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        effectiveFrom,
        annualCtc: Number(ctc.replace(/[,₹\s]/g, "")),
        components: custom
          ? {
              ...Object.fromEntries(COMP.map(([k]) => [k, Number(comps[k] || 0)])),
              extras: extras.filter((x) => x.label.trim() && x.amount > 0).map((x) => ({ ...x, code: x.code || x.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "allowance" })),
            }
          : null,
        reason: reason.trim() || null,
      };
      const parsed = structureRevisionSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
      return api.post(`/admin/payroll/structures/${employeeId}`, parsed.data);
    },
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Salary revised");
      setRevising(false);
      qc.invalidateQueries({ queryKey: ["payroll", "structures"] });
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save"),
  });

  const d = q.data;
  const customGross = COMP.reduce((s, [k]) => s + Number(comps[k] || 0), 0) + extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  return (
    <Dialog
      open={!!employeeId}
      onOpenChange={(v) => !v && onClose()}
      title={d ? `${d.employee.name} · salary` : "Salary"}
      description={d ? `${d.employee.code} · joined ${fmtDate(d.employee.dateOfJoining)} · ${d.employee.taxRegime === "old" ? "old" : "new"} tax regime` : undefined}
      width={640}
      footer={
        revising ? (
          <>
            <Button onClick={() => setRevising(false)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save revision
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            {can("payroll", "edit") && d ? (
              <Button variant="primary" onClick={startRevise}>
                Revise salary
              </Button>
            ) : null}
          </>
        )
      }
    >
      {q.isLoading || !d ? (
        <Loading />
      ) : revising ? (
        <>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Effective from" hint="Use the first of a month that isn't locked yet">
              <Input type="date" value={effectiveFrom} min={todayIST().slice(0, 8) + "01"} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
            <Field label="Annual CTC (₹)" hint={custom ? "Worked out from the components below" : "Split using the salary template"}>
              <Input inputMode="numeric" value={ctc} onChange={(e) => setCtc(e.target.value)} disabled={custom} />
            </Field>
          </div>
          <Checkbox label="Set components manually (custom structure)" checked={custom} onChange={setCustom} />
          {custom ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {COMP.map(([k, l]) => (
                <Field key={k} label={`${l} (monthly)`}>
                  <Input inputMode="numeric" value={comps[k] ?? ""} onChange={(e) => setComps((c) => ({ ...c, [k]: e.target.value.replace(/[^\d]/g, "") }))} />
                </Field>
              ))}
              <div className="col-span-full flex flex-col gap-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium">Other allowances</span>
                  <Button size="sm" onClick={() => setExtras((x) => [...x, { code: "", label: "", amount: 0, taxable: true, esiWage: true }])}>
                    Add allowance
                  </Button>
                </div>
                {extras.map((x, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_auto_auto] items-center gap-2">
                    <Input placeholder="e.g. Night shift allowance" value={x.label} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                    <Input inputMode="numeric" placeholder="Monthly" value={x.amount || ""} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, amount: Number(e.target.value.replace(/[^\d]/g, "")) } : y)))} />
                    <Checkbox label="Taxable" checked={x.taxable !== false} onChange={(v) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, taxable: v } : y)))} />
                    <Button size="sm" variant="ghost" onClick={() => setExtras((all) => all.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <div className="text-muted self-end text-[13px]">Monthly gross {inr(customGross)}</div>
            </div>
          ) : null}
          <Field label="Reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: annual increment 2027" maxLength={200} />
          </Field>
          <div className="text-muted text-[12.5px]">If a locked month needs the new salary, revise from the next open month and add the difference as arrears in that month's payroll.</div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="card-kicker mb-1">Current structure</div>
              <Breakdown s={d.current} />
            </div>
            <div>
              <div className="card-kicker mb-1">Revision history</div>
              {d.history.length === 0 ? (
                <div className="text-muted text-[13px]">No revisions. Pay comes from the employee's CTC and the salary template.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {d.history.map((h) => (
                    <div key={h.id} className="rounded-[var(--radius-md)] px-3 py-2 text-[13px]" style={{ background: "var(--tint-1)" }}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">From {fmtDate(h.effectiveFrom)}</span>
                        <span className="num">{inr(h.annualCtc)} / yr</span>
                      </div>
                      <div className="text-muted text-[12px]">
                        {h.components ? <Tag tone="accent">Custom</Tag> : "Template"} {h.reason ? `· ${h.reason}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
