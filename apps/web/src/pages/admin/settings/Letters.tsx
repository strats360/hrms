import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { LETTER_FIELDS, SALARY_TABLE } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Loading } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { LetterSettings, Template } from "@/components/letters/types";

const NEW = "__new__";
const GROUPS = [...new Set(LETTER_FIELDS.map((f) => f.group))];

export default function LetterTemplates() {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can("settings", "edit");
  const q = useQuery({ queryKey: ["letters", "templates"], queryFn: () => api.get<{ templates: Template[]; settings: LetterSettings }>("/admin/letters/templates") });
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", body: "" });
  const [sig, setSig] = useState<LetterSettings>({ signatoryName: null, signatoryTitle: null });
  const area = useRef<HTMLTextAreaElement>(null);
  const list = q.data?.templates ?? [];
  const current = useMemo(() => list.find((t) => t.id === sel) ?? null, [list, sel]);
  useEffect(() => {
    if (!sel && list[0]) setSel(list[0].id);
  }, [list, sel]);
  useEffect(() => {
    if (sel === NEW) setF({ name: "", body: "# Heading\n\nDear {{employee.first_name}},\n\n" });
    else if (current) setF({ name: current.name, body: current.body });
  }, [sel, current]);
  useEffect(() => {
    if (q.data) setSig(q.data.settings);
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["letters"] });
  const save = useMutation({
    mutationFn: () => (sel === NEW ? api.post<Template>("/admin/letters/templates", f) : api.put<Template>(`/admin/letters/templates/${sel}`, f)),
    onSuccess: (t) => {
      toast.success("Template saved");
      setSel(t.id);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/admin/letters/templates/${sel}`),
    onSuccess: () => {
      toast.success(current?.builtIn ? "Template reset to the original" : "Template deleted");
      if (!current?.builtIn) setSel(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveSig = useMutation({
    mutationFn: () => api.put("/admin/letters/settings", { signatoryName: sig.signatoryName || null, signatoryTitle: sig.signatoryTitle || null }),
    onSuccess: () => (toast.success("Signatory saved"), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const insert = (token: string) => {
    const el = area.current;
    if (!el) return setF((x) => ({ ...x, body: x.body + token }));
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const body = f.body.slice(0, a) + token + f.body.slice(b);
    setF({ ...f, body });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  if (q.isLoading) return <Loading />;
  const dirty = sel === NEW || (current && (f.name !== current.name || f.body !== current.body));
  return (
    <div className="flex flex-col gap-4">
      <Card className="!gap-3">
        <CardHeader title="Signatory" sub="Printed under each letter. Leave the name blank to sign as the company only." />
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name">
            <Input value={sig.signatoryName ?? ""} onChange={(e) => setSig({ ...sig, signatoryName: e.target.value })} placeholder="e.g. Kunal Shah" disabled={!editable} />
          </Field>
          <Field label="Title">
            <Input value={sig.signatoryTitle ?? ""} onChange={(e) => setSig({ ...sig, signatoryTitle: e.target.value })} placeholder="e.g. Director, HR" disabled={!editable} />
          </Field>
          {editable ? (
            <Button loading={saveSig.isPending} disabled={sig.signatoryName === q.data?.settings.signatoryName && sig.signatoryTitle === q.data?.settings.signatoryTitle} onClick={() => saveSig.mutate()}>
              Save
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="!gap-px !p-2">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSel(t.id)}
              className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-md)] border-0 px-3 py-2 text-left text-[13.5px] text-[var(--color-text)] hover:bg-[var(--tint-1)]", sel === t.id ? "bg-[var(--sel-bg)] font-semibold text-[var(--sel-fg)]" : "bg-transparent")}
            >
              <span className="min-w-0 truncate">{t.name}</span>
              {t.edited ? <Tag tone="accent">Edited</Tag> : !t.builtIn ? <Tag tone="neutral">Yours</Tag> : null}
            </button>
          ))}
          {editable ? (
            <Button size="sm" variant="ghost" className="mt-1 justify-start" onClick={() => setSel(NEW)}>
              <Plus size={14} /> New template
            </Button>
          ) : null}
        </Card>

        <Card className="!gap-3 min-w-0">
          <CardHeader
            title={sel === NEW ? "New template" : (current?.name ?? "Template")}
            sub="Generate a letter from an employee's profile. Fields in double braces fill in from their record."
            actions={
              editable ? (
                <div className="flex gap-2">
                  {sel !== NEW && current && (current.edited || !current.builtIn) ? (
                    <Button loading={remove.isPending} onClick={() => remove.mutate()}>
                      {current.builtIn ? "Reset to original" : "Delete"}
                    </Button>
                  ) : null}
                  <Button variant="primary" disabled={!dirty || f.name.trim().length < 2 || f.body.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>
                    Save
                  </Button>
                </div>
              ) : null
            }
          />
          <Field label="Name">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!editable} />
          </Field>
          <Field label="Letter" hint={`"# " starts the heading. A blank line starts a new paragraph. Put ${SALARY_TABLE} on its own line for the salary breakdown.`}>
            <Textarea ref={area} rows={16} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} disabled={!editable} className="font-[inherit] text-[13px] leading-relaxed" aria-label="Template text" />
          </Field>
          {editable ? (
            <div className="flex flex-col gap-2">
              <div className="text-muted text-[12px]">Click a field to add it where the cursor is.</div>
              {GROUPS.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted w-[70px] text-[11.5px] font-semibold uppercase tracking-[0.05em]">{g}</span>
                  {LETTER_FIELDS.filter((x) => x.group === g).map((x) => (
                    <button key={x.key} type="button" onClick={() => insert(`{{${x.key}}}`)} className="cursor-pointer rounded-full border border-[var(--color-divider)] bg-[var(--color-surface)] px-2 py-0.5 text-[12px] text-[var(--color-text)] hover:bg-[var(--tint-1)]" title={`{{${x.key}}}`}>
                      {x.label}
                    </button>
                  ))}
                  {g === "Salary" ? (
                    <button type="button" onClick={() => insert(`\n${SALARY_TABLE}\n`)} className="cursor-pointer rounded-full border border-[var(--color-divider)] bg-[var(--sel-bg)] px-2 py-0.5 text-[12px] text-[var(--sel-fg)]">
                      Salary table
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
