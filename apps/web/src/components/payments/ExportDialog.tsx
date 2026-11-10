import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { BANK_FORMAT_LABEL, EXPORT_COLUMNS, EXPORT_DATE_FORMATS, EXPORT_FILE_TYPE_LABEL, EXPORT_FILE_TYPES, inr, type BankFileFormat, type ExportColumnKey, type ExportLayout } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";

interface Preview {
  preview: string[];
  ext: string;
  total: number;
  missing: number;
  amount: number;
}

const same = (a: ExportLayout, b: ExportLayout) => JSON.stringify(a) === JSON.stringify(b);

/** Pick the bank file format (or your own columns), preview it, and download. */
export function ExportDialog({ batch, onClose, onDone }: { batch: { id: string; code: string; fileFormat: BankFileFormat; exportCount: number }; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<BankFileFormat>(batch.fileFormat);
  const saved = useQuery({ queryKey: ["payments", "export-layout"], queryFn: () => api.get<ExportLayout>("/admin/payments/export-layout") });
  const [layout, setLayout] = useState<ExportLayout | null>(null);
  useEffect(() => {
    if (saved.data && !layout) setLayout(saved.data);
  }, [saved.data, layout]);

  // live preview, a moment after the last change
  const [debounced, setDebounced] = useState<{ format: BankFileFormat; layout: ExportLayout | null }>({ format, layout });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ format, layout }), 250);
    return () => clearTimeout(t);
  }, [format, layout]);
  const custom = format === "custom";
  const valid = !custom || (!!layout && layout.columns.includes("account_number") && layout.columns.includes("amount"));
  const preview = useQuery({
    queryKey: ["payments", "file-preview", batch.id, debounced],
    queryFn: () => api.post<Preview>(`/admin/payments/batches/${batch.id}/file/preview`, { format: debounced.format, ...(debounced.format === "custom" && debounced.layout ? { layout: debounced.layout } : {}) }),
    enabled: debounced.format !== "custom" || (!!debounced.layout && valid),
    retry: false,
  });

  const run = useMutation({
    mutationFn: async () => {
      if (custom && layout && saved.data && !same(layout, saved.data)) {
        await api.put("/admin/payments/export-layout", layout);
        qc.setQueryData(["payments", "export-layout"], layout);
      }
      const ext = preview.data?.ext ?? "csv";
      await download(`/admin/payments/batches/${batch.id}/file${format !== batch.fileFormat ? `?format=${format}` : ""}`, `${batch.code}.${ext}`);
    },
    onSuccess: () => {
      toast.success(batch.exportCount ? "Retry file downloaded (pending payments only)" : "Bank file downloaded. Upload it on your bank's portal.");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // chosen columns in their order, then the rest
  const ordered = useMemo(() => (layout ? [...layout.columns, ...EXPORT_COLUMNS.map((c) => c.key).filter((k) => !layout.columns.includes(k))] : []), [layout]);
  const toggle = (k: ExportColumnKey, on: boolean) => layout && setLayout({ ...layout, columns: on ? [...layout.columns, k] : layout.columns.filter((x) => x !== k) });
  const move = (k: ExportColumnKey, by: -1 | 1) => {
    if (!layout) return;
    const cols = [...layout.columns];
    const i = cols.indexOf(k);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j]!, cols[i]!];
    setLayout({ ...layout, columns: cols });
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      width={720}
      title="Export bank file"
      description={batch.exportCount ? "This file has only the payments still pending." : "Choose the layout your bank's bulk upload expects."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || !preview.data} loading={run.isPending} onClick={() => run.mutate()}>
            <Download size={15} /> {custom && layout && saved.data && !same(layout, saved.data) ? "Save layout and export" : "Export"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as BankFileFormat)}>
              {(Object.entries(BANK_FORMAT_LABEL) as [BankFileFormat, string][]).map(([v, l]) => (
                <option key={v} value={v}>
                  {v === "custom" ? "Custom layout (choose columns)" : l}
                  {v === batch.fileFormat ? " · this batch's format" : ""}
                </option>
              ))}
            </Select>
          </Field>
          {custom && layout ? (
            <Field label="File type">
              <Select value={layout.fileType} onChange={(e) => setLayout({ ...layout, fileType: e.target.value as ExportLayout["fileType"] })}>
                {EXPORT_FILE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EXPORT_FILE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        {custom && layout ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date format">
                <Select value={layout.dateFormat} onChange={(e) => setLayout({ ...layout, dateFormat: e.target.value as ExportLayout["dateFormat"] })}>
                  {EXPORT_DATE_FORMATS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col justify-end gap-1.5 pb-1">
                <Checkbox checked={layout.header} onChange={(v) => setLayout({ ...layout, header: v })} label="First row has column names" />
                <Checkbox checked={layout.bankSafe} onChange={(v) => setLayout({ ...layout, bankSafe: v })} label="Bank-safe names (capitals, no special characters)" />
              </div>
            </div>
            <Field label="Columns" hint="Ticked columns go in the file in this order. The account number and amount are required.">
              <div className="grid gap-x-4 sm:grid-cols-2">
                {ordered.map((k) => {
                  const on = layout.columns.includes(k);
                  const i = layout.columns.indexOf(k);
                  const label = EXPORT_COLUMNS.find((c) => c.key === k)!.label;
                  return (
                    <div key={k} className="flex items-center justify-between gap-2 border-b border-[var(--color-divider)] py-1">
                      <Checkbox checked={on} onChange={(v) => toggle(k, v)} label={on ? `${i + 1}. ${label}` : label} />
                      {on ? (
                        <span className="flex flex-none">
                          <Button size="sm" variant="ghost" icon aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(k, -1)}>
                            <ArrowUp size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" icon aria-label={`Move ${label} down`} disabled={i === layout.columns.length - 1} onClick={() => move(k, 1)}>
                            <ArrowDown size={14} />
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Field>
            {!valid ? <Notice tone="warn">Add the account number and amount columns. The bank can't pay without them.</Notice> : null}
          </>
        ) : null}

        <div>
          <div className="text-muted mb-1 text-[12px]">
            {preview.data ? `Preview (first ${Math.min(3, preview.data.total)} of ${preview.data.total} · ${inr(preview.data.amount)}). Account numbers are masked here, not in the file.` : "Preview"}
          </div>
          <pre className="scroll-thin !m-0 max-h-[180px] overflow-auto rounded-[var(--radius-md)] p-3 text-[11.5px] leading-relaxed" style={{ background: "var(--inverse-bg)", color: "var(--inverse-fg)" }} data-testid="file-preview">
            {preview.error ? errorMessage(preview.error) : preview.data ? preview.data.preview.join("\n") : "Loading…"}
          </pre>
          {preview.data?.ext === "xlsx" ? <div className="text-muted mt-1 text-[12px]">Shown as CSV; the download is an Excel file.</div> : null}
        </div>
        {preview.data?.missing ? <Notice tone="warn">{preview.data.missing} payment{preview.data.missing === 1 ? " has" : "s have"} no bank details. They'll be held and left out of the file.</Notice> : null}
        <div className="text-muted text-[12px]">Duplicate guard: if two payments go to the same account for the same amount, the export stops so you can check the bank details first.</div>
      </div>
    </Dialog>
  );
}
