import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { ATTENDANCE_STATUS_LABELS, fmtDate, type AttendanceStatus } from "@hrms/shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api, download, errorMessage } from "@/lib/api";

interface Row {
  row: number;
  employeeCode: string;
  employeeName: string | null;
  date: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus | null;
  action: "create" | "update" | "skip" | "error";
  message: string | null;
}
interface Result {
  total: number;
  create: number;
  update: number;
  skip: number;
  errors: number;
  written: number;
  results: Row[];
  truncated: boolean;
}

/** Bulk attendance from a spreadsheet or a biometric software export: check first, then upload. */
export function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const reset = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setOverwrite(false);
  };
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<Result>("/admin/attendance/import", { csv, dryRun, overwrite }),
    onSuccess: (r, dryRun) => {
      if (dryRun) return setPreview(r);
      toast.success(`Saved attendance for ${r.written} day${r.written === 1 ? "" : "s"}${r.errors + r.skip ? `. ${r.errors + r.skip} row(s) left out` : ""}`);
      qc.invalidateQueries({ queryKey: ["attendance"] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) return void toast.error("The file is larger than 5 MB. Split it by month or branch.");
    setFileName(f.name);
    setCsv(await f.text());
    setPreview(null);
  };
  const writable = preview ? preview.create + preview.update : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Upload attendance"
      description="From a spreadsheet or your biometric software's export (save it as CSV). We check every row before anything is saved."
      width={820}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          {preview && writable > 0 ? (
            <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(false)}>
              Save {writable} day{writable === 1 ? "" : "s"}
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
        <Button onClick={() => download("/admin/attendance/import/template.csv", "attendance-upload-template.csv").catch((e) => toast.error(errorMessage(e)))}>
          <Download size={15} /> Download template
        </Button>
        <label className="btn btn-secondary cursor-pointer">
          <Upload size={15} /> {fileName || "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <Field label="Or paste CSV" hint="Columns: Employee ID (or biometric ID), Date, Check in, Check out, Status, Note. Dates as DD-MM-YYYY or YYYY-MM-DD, times as 09:30 or 9:30 AM. Status codes: P, A, HD, L, WFH, WO, H. Without a status, it's worked out from the times and the shift.">
        <Textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          rows={5}
          className="font-mono !text-[12px]"
          placeholder="Employee ID,Date,Check in,Check out,Status"
        />
      </Field>
      <Checkbox
        checked={overwrite}
        onChange={(v) => {
          setOverwrite(v);
          setPreview(null);
        }}
        label={<span className="text-[13px]">Replace days that already have attendance</span>}
      />
      {preview ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone="neutral">{preview.total} rows</Tag>
            {preview.create ? <Tag tone="ok">{preview.create} new</Tag> : null}
            {preview.update ? <Tag tone="warn">{preview.update} to replace</Tag> : null}
            {preview.skip ? <Tag tone="neutral">{preview.skip} already marked</Tag> : null}
            {preview.errors ? <Tag tone="bad">{preview.errors} with errors</Tag> : null}
          </div>
          {writable === 0 ? <Notice tone="bad">Nothing can be saved. Fix the rows below and check again.</Notice> : null}
          <div className="scroll-thin max-h-[300px] min-w-0 overflow-auto">
            <table className="table text-[13px]">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>In · Out</th>
                  <th>Status</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.results.map((r) => (
                  <tr key={r.row}>
                    <td className="num">{r.row}</td>
                    <td className="whitespace-nowrap">{r.employeeName ? `${r.employeeName} · ${r.employeeCode}` : r.employeeCode || "—"}</td>
                    <td className="whitespace-nowrap">{r.date ? fmtDate(r.date) : "—"}</td>
                    <td className="num whitespace-nowrap">{r.checkIn ? `${r.checkIn} · ${r.checkOut ?? "—"}` : "—"}</td>
                    <td>{r.status ? ATTENDANCE_STATUS_LABELS[r.status] : "—"}</td>
                    <td>
                      {r.action === "error" ? (
                        <span style={{ color: "var(--bad)" }}>{r.message}</span>
                      ) : r.action === "skip" ? (
                        <span className="text-muted">{r.message}</span>
                      ) : (
                        <Tag tone={r.action === "create" ? "ok" : "warn"}>{r.action === "create" ? "New" : "Replace"}</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.truncated ? <div className="text-muted p-2 text-[12px]">Showing the first 2,000 rows, errors first.</div> : null}
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
