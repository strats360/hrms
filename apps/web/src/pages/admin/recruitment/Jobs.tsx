import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ExternalLink, Globe, Plus } from "lucide-react";
import { PIPELINE, STAGE_LABEL } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, Notice, PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { ctcRange, JobDialog, JobStatusTag, type Job } from "@/components/recruitment/shared";

interface Data {
  rows: Job[];
  canEdit: boolean;
  canConfigure: boolean;
  careers: { slug: string | null; intro: string };
}
export const useRecruitmentHome = () => useQuery({ queryKey: ["recruitment", "jobs"], queryFn: () => api.get<Data>("/admin/recruitment/jobs") });

export function RecruitmentHeader() {
  const q = useRecruitmentHome();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [careers, setCareers] = useState(false);
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Recruitment"
        sub="Job openings, candidates and interviews"
        actions={
          <>
            {d?.canConfigure ? <Button onClick={() => setCareers(true)}><Globe size={16} /> Careers page</Button> : null}
            {d?.canEdit ? <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New job</Button> : null}
          </>
        }
      />
      {d?.canEdit ? <RouteTabs tabs={[{ to: "/recruitment", label: "Jobs", end: true }, { to: "/recruitment/candidates", label: "Candidates" }]} /> : null}
      {creating ? <JobDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/recruitment/jobs/${id}`)} /> : null}
      {careers && d ? <CareersDialog current={d.careers} onClose={() => setCareers(false)} /> : null}
    </>
  );
}

export default function Jobs() {
  const nav = useNavigate();
  const q = useRecruitmentHome();
  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      { id: "title", header: "Job", accessorKey: "title", cell: ({ row: { original: j } }) => <div><div className="font-medium">{j.title}</div><div className="text-muted text-[12px]">{[j.code, j.department, j.location ?? j.branch].filter(Boolean).join(" · ")}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: j } }) => <div className="flex flex-wrap items-center gap-1.5"><JobStatusTag s={j.status} />{j.published && j.status === "open" ? <span className="text-muted text-[12px]">on careers page</span> : null}</div> },
      { id: "manager", header: "Hiring manager", accessorFn: (j) => j.hiringManager ?? "", cell: ({ getValue }) => getValue<string>() || "—" },
      {
        id: "pipeline",
        header: "Pipeline",
        enableSorting: false,
        cell: ({ row: { original: j } }) => (
          <div className="flex gap-3 text-[12.5px]">
            {PIPELINE.map((s) => (
              <span key={s} title={STAGE_LABEL[s]}><span className="text-muted">{STAGE_LABEL[s]}</span> <b className="num">{j.counts[s] ?? 0}</b></span>
            ))}
          </div>
        ),
      },
      { id: "filled", header: "Filled", accessorFn: (j) => j.hired, cell: ({ row: { original: j } }) => <span className="num">{j.hired} / {j.openings}</span> },
      { id: "budget", header: "Budget", enableSorting: false, cell: ({ row: { original: j } }) => ctcRange(j) || "—" },
    ],
    [],
  );
  const d = q.data;
  const url = d?.careers.slug ? `${location.origin}/careers/${d.careers.slug}` : null;
  return (
    <>
      <RecruitmentHeader />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {d?.canConfigure && !url ? <Notice tone="sel">Turn on your careers page so candidates can apply directly. Use the Careers page button above.</Notice> : null}
      {url ? (
        <Notice tone="ok">
          Careers page: <a href={url} target="_blank" rel="noreferrer">{url} <ExternalLink size={12} className="inline" /></a>
        </Notice>
      ) : null}
      <TableCard>
        <CardHeader className="py-2" title="Job openings" sub={d && !d.canEdit ? "Jobs you're the hiring manager for." : undefined} />
        <DataTable data={d?.rows ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/recruitment/jobs/${r.id}`)} storageKey="jobs" empty={d?.canEdit ? "No job openings yet. Create one to start hiring." : "You're not the hiring manager for any job yet."} />
      </TableCard>
    </>
  );
}

function CareersDialog({ current, onClose }: { current: { slug: string | null; intro: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState(current.slug ?? "");
  const [intro, setIntro] = useState(current.intro);
  useEffect(() => setSlug(current.slug ?? ""), [current.slug]);
  const save = useMutation({
    mutationFn: (off: boolean) => api.put("/admin/recruitment/settings", { slug: off ? null : slug.trim().toLowerCase(), intro }),
    onSuccess: (_, off) => (toast.success(off ? "Careers page turned off" : "Careers page saved"), qc.invalidateQueries({ queryKey: ["recruitment"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Careers page"
      description="A public page listing your open jobs, where candidates apply with their resume. Applications land in the job's pipeline."
      footer={
        <>
          {current.slug ? <Button variant="danger" onClick={() => save.mutate(true)}>Turn off</Button> : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={slug.trim().length < 3} onClick={() => save.mutate(false)}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Page address" hint={`${location.origin}/careers/${slug.trim().toLowerCase() || "your-company"}`}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. strats360" />
        </Field>
        <Field label="Introduction" hint="A few lines about working with you">
          <Textarea rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
