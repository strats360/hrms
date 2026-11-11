import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Paperclip, Pin } from "lucide-react";
import { ANNOUNCEMENT_CATEGORY_LABEL, fmtDate, type AnnouncementCategory } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { Body } from "@/components/announcements/Body";
import { CATEGORY_TONE } from "@/pages/admin/announcements/Announcements";
import { openFile } from "@/pages/admin/recruitment/CandidateDetail";

export interface FeedItem { id: string; title: string; excerpt: string; category: AnnouncementCategory; pinned: boolean; requireAck: boolean; publishAt: string; authorName: string | null; hasAttachment: boolean; read: boolean; acknowledged: boolean }
export const useFeed = (enabled = true) => useQuery({ queryKey: ["announcements", "feed"], queryFn: () => api.get<FeedItem[]>("/ess/announcements"), enabled, staleTime: 60_000 });

export function FeedRow({ a }: { a: FeedItem }) {
  return (
    <Link to={`/me/announcements/${a.id}`} className="flex gap-3 border-b border-[var(--color-divider)] py-3 no-underline last:border-b-0" style={{ color: "inherit" }}>
      <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: a.read ? "transparent" : "var(--color-accent)" }} aria-label={a.read ? undefined : "Unread"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {a.pinned ? <Pin size={13} aria-label="Pinned" /> : null}
          <span className={`text-[14px] ${a.read ? "" : "font-semibold"}`}>{a.title}</span>
          {a.category !== "general" ? <Tag tone={CATEGORY_TONE[a.category]}>{ANNOUNCEMENT_CATEGORY_LABEL[a.category]}</Tag> : null}
          {a.requireAck && !a.acknowledged ? <Tag tone="warn">Please confirm</Tag> : null}
        </div>
        <div className="text-muted line-clamp-2 text-[12.5px]">{a.excerpt}</div>
        <div className="text-muted text-[11.5px]">{fmtDate(a.publishAt.slice(0, 10))}{a.authorName ? ` · ${a.authorName}` : ""}</div>
      </div>
    </Link>
  );
}

export default function EssAnnouncements() {
  const q = useFeed();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return (
    <>
      <h1 className="!mb-0 text-[26px]">Announcements</h1>
      <Card className="!gap-0 !py-1">{q.data?.length ? q.data.map((a) => <FeedRow key={a.id} a={a} />) : <Empty title="Nothing here yet" sub="Company news and policies show up here." />}</Card>
    </>
  );
}

export function EssAnnouncement() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["announcements", "one", id], queryFn: () => api.get<{ id: string; title: string; body: string; category: AnnouncementCategory; publishAt: string; authorName: string | null; requireAck: boolean; acknowledgedAt: string | null; hasAttachment: boolean; attachmentName: string | null }>(`/ess/announcements/${id}`) });
  // opening it marks it read
  useEffect(() => {
    if (q.isSuccess) qc.setQueryData<FeedItem[]>(["announcements", "feed"], (l) => l?.map((a) => (a.id === id ? { ...a, read: true } : a)));
  }, [q.isSuccess, id, qc]);
  const ack = useMutation({
    mutationFn: () => api.post(`/ess/announcements/${id}/acknowledge`),
    onSuccess: () => (toast.success("Thanks for confirming"), qc.invalidateQueries({ queryKey: ["announcements"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const a = q.data;
  return (
    <>
      <Link to="/me/announcements" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All announcements</Link>
      <Card className="!gap-3">
        <div className="flex flex-wrap items-center gap-2"><Tag tone={CATEGORY_TONE[a.category]}>{ANNOUNCEMENT_CATEGORY_LABEL[a.category]}</Tag><span className="text-muted text-[12.5px]">{fmtDate(a.publishAt.slice(0, 10))}{a.authorName ? ` · ${a.authorName}` : ""}</span></div>
        <h1 className="!m-0 text-[24px]">{a.title}</h1>
        <Body text={a.body} />
        {a.hasAttachment ? <div><Button onClick={() => openFile(`/ess/announcements/${id}/attachment`)}><Paperclip size={15} /> {a.attachmentName ?? "Attachment"}</Button></div> : null}
        {a.requireAck ? (a.acknowledgedAt ? <Notice tone="ok">You confirmed reading this on {fmtDate(a.acknowledgedAt.slice(0, 10))}.</Notice> : <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--tint-1)] p-3 text-[13.5px]"><span>HR has asked everyone to confirm they've read this.</span><Button variant="primary" loading={ack.isPending} onClick={() => ack.mutate()}>I've read it</Button></div>) : null}
      </Card>
    </>
  );
}
