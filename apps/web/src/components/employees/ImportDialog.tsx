import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api, download, errorMessage } from "@/lib/api";

interface ImportResult {
  total: number;
  ready: number;
  failed: number;
  created: number;
  results: { row: number; name: string; email: string; ok: boolean; errors: string[] }[];
}

/** Bulk import employees from CSV: download template, preview (dry run), then import. */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [sendInvites, setSendInvites] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const reset = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setSendInvites(false);
  };

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<ImportResult>("/admin/employees/import", { csv, dryRun, sendInvites }),
    onSuccess: (r, dryRun) => {
      if (dryRun) {
        setPreview(r);
        return;
      }
      toast.success(`Imported ${r.created} employee${r.created === 1 ? "" : "s"}${r.failed ? `. ${r.failed} row(s) skipped` : ""}`);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-stats"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      reset();
      onOpenChange(false);
    },
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      toast.error("The file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    setFileName(f.name);
    setCsv(await f.text());
    setPreview(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Bulk import employees"
      description="Upload a CSV using our template. We check every row before anything is saved."
      width={760}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          {preview && preview.ready > 0 ? (
            <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(false)}>
              Import {preview.ready} employee{preview.ready === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button variant="primary" loading={run.isPending} disabled={!csv.trim()} onClick={() => run.mutate(true)}>
              Check file
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => download("/admin/employees/import/template.csv", "employee-import-template.csv").catch((e) => toast.error(errorMessage(e)))}>
          <Download size={15} /> Download template
        </Button>
        <label className="btn btn-secondary cursor-pointer">
          <Upload size={15} /> {fileName || "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <Field label="Or paste CSV" hint="First row must be the header. Department, designation and branch must match names in Settings.">
        <Textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          rows={5}
          className="font-mono !text-[12px]"
          placeholder="First name,Last name,Work email,..."
        />
      </Field>
      <Checkbox checked={sendInvites} onChange={setSendInvites} label={<span className="text-[13px]">Email each new employee a self-onboarding invite</span>} />
      {preview ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone="neutral">{preview.total} rows</Tag>
            <Tag tone="ok">{preview.ready} ready</Tag>
            {preview.failed ? <Tag tone="bad">{preview.failed} with errors</Tag> : null}
          </div>
          {preview.ready === 0 ? <Notice tone="bad">No rows can be imported. Fix the errors below and check again.</Notice> : null}
          <div className="scroll-thin max-h-[280px] min-w-0 overflow-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.results.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td className="whitespace-nowrap">{r.name || "—"}</td>
                    <td className="whitespace-nowrap">{r.email || "—"}</td>
                    <td>{r.ok ? <Tag tone="ok">Ready</Tag> : <span style={{ color: "var(--bad)" }}>{r.errors.join("; ")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
