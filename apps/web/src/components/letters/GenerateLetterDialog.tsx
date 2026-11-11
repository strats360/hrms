import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileCheck2 } from "lucide-react";
import { LETTER_FIELDS, SALARY_TABLE } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import type { Preview, Template } from "./types";

const label = (k: string) => LETTER_FIELDS.find((f) => f.key === k)?.label ?? k;
const rupees = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;

/** Pick a template, check and edit the filled-in letter, then download or save it. */
export function GenerateLetterDialog({ employee, onClose, initialTemplate = "builtin:offer" }: { employee: { id: string; fullName: string }; onClose: () => void; initialTemplate?: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const list = useQuery({ queryKey: ["letters", "templates"], queryFn: () => api.get<{ templates: Template[] }>("/admin/letters/templates") });
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [text, setText] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["letters", "preview", employee.id, templateId],
    queryFn: () => api.post<Preview>("/admin/letters/preview", { employeeId: employee.id, templateId }),
    enabled: !!templateId,
  });
  useEffect(() => {
    if (preview.data) setText(preview.data.text);
  }, [preview.data]);
  const make = useMutation({
    mutationFn: (save: boolean) => download("/admin/letters/pdf", `${preview.data?.title ?? "Letter"}.pdf`, { employeeId: employee.id, templateId, text: text ?? undefined, save }),
    onSuccess: (_d, save) => {
      toast.success(save ? `Saved to ${employee.fullName}'s documents and downloaded` : "Letter downloaded");
      if (save) {
        qc.invalidateQueries({ queryKey: ["employee", employee.id] });
        onClose();
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const p = preview.data;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      width={760}
      title={`Letter for ${employee.fullName}`}
      description="Fields fill in from the employee's record. Check the text and change anything before you download."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!text} loading={make.isPending && make.variables === false} onClick={() => make.mutate(false)}>
            <Download size={15} /> Download PDF
          </Button>
          <Button variant="primary" disabled={!text} loading={make.isPending && make.variables === true} onClick={() => make.mutate(true)}>
            <FileCheck2 size={15} /> Save to documents
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Template">
          <Select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setText(null);
            }}
          >
            {list.data?.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {p?.missing.length ? (
          <Notice tone="warn">
            Not on record, shown in square brackets: {p.missing.map(label).join(", ")}. Fill them in below, or add them to the employee's profile first.
          </Notice>
        ) : null}
        {p?.salaryHidden ? <Notice tone="warn">This letter has salary details, which need payroll access. Ask someone in payroll to generate it.</Notice> : null}
        {p?.salaryMissing ? <Notice tone="warn">No salary is on record for this employee yet, so the salary details are blank.</Notice> : null}
        <Field label="Letter" hint={`"# " starts the heading. A blank line starts a new paragraph. ${SALARY_TABLE} is where the salary table goes.`}>
          <Textarea rows={14} value={text ?? (preview.isLoading ? "Filling in…" : "")} onChange={(e) => setText(e.target.value)} className="font-[inherit] text-[13px] leading-relaxed" aria-label="Letter text" />
        </Field>
        {text?.includes(SALARY_TABLE) && p?.salaryTable ? (
          <div>
            <div className="text-muted mb-1 text-[12px]">Salary table in the letter</div>
            <table className="table text-[12.5px]">
              <tbody>
                {p.salaryTable.map((r) => (
                  <tr key={r.label} className={r.strong ? "font-semibold" : undefined}>
                    <td>{r.label}</td>
                    <td className="num text-right">{rupees(r.monthly)}</td>
                    <td className="num text-right">{rupees(r.monthly * 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {can("settings", "edit") ? <div className="text-muted text-[12px]">Change the wording for everyone under Settings › Letter templates.</div> : null}
      </div>
    </Dialog>
  );
}
