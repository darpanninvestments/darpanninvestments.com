"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Bell, CalendarClock, CheckCheck, FileText, FormInput, Info, MapPin, PartyPopper, Upload, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { api, type Paged, type Row } from "@/lib/api";
import { cn, fmtDateTime, fromNow, humanize } from "@/lib/utils";
import { Button, Empty, IconButton, Loading, PageHeader, Pagination, Select, Tabs } from "@/components/ui";

const TYPES: Record<string, { icon: LucideIcon; cls: string }> = {
  assignment: { icon: Users, cls: "bg-blue-50 text-blue-600" },
  new_lead: { icon: UserPlus, cls: "bg-emerald-50 text-emerald-600" },
  followup: { icon: CalendarClock, cls: "bg-violet-50 text-violet-600" },
  followup_reminder: { icon: CalendarClock, cls: "bg-violet-50 text-violet-600" },
  escalation: { icon: AlertTriangle, cls: "bg-red-50 text-red-600" },
  visit_reminder: { icon: MapPin, cls: "bg-teal-50 text-teal-600" },
  meeting_reminder: { icon: CalendarClock, cls: "bg-sky-50 text-sky-600" },
  status: { icon: Info, cls: "bg-amber-50 text-amber-600" },
  conversion: { icon: PartyPopper, cls: "bg-emerald-50 text-emerald-600" },
  form_submission: { icon: FormInput, cls: "bg-pink-50 text-pink-600" },
  import: { icon: Upload, cls: "bg-slate-100 text-slate-600" },
  document: { icon: FileText, cls: "bg-indigo-50 text-indigo-600" },
  system: { icon: Bell, cls: "bg-slate-100 text-slate-600" },
};

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const params = { unread: tab === "unread" ? 1 : undefined, type, page, page_size: 30 };
  const list = useQuery({
    queryKey: ["notifications", "page", params], placeholderData: keepPreviousData,
    queryFn: () => api.get<Paged<Row> & { unread: number }>("/api/notifications", params),
  });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["me"] }); };
  const mark = useMutation({ mutationFn: (ids?: number[]) => api.post("/api/notifications/read", ids ? { ids } : {}), onSuccess: invalidate });
  const open = (n: Row) => {
    if (!n.is_read) mark.mutate([n.id]);
    if (n.link) router.push(n.link);
  };
  const items = list.data?.items || [];
  const unread = list.data?.unread ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" subtitle={unread ? `${unread} unread` : "You're all caught up"}
        actions={<Button size="sm" variant="outline" icon={<CheckCheck className="h-4 w-4" />} disabled={!unread} loading={mark.isPending && !mark.variables}
          onClick={() => mark.mutate(undefined)}>Mark all read</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 pt-1">
          <Tabs className="border-0" value={tab} onChange={(v) => { setTab(v); setPage(1); }}
            tabs={[{ value: "all", label: "All" }, { value: "unread", label: "Unread", count: unread }]} />
          <Select className="mb-1 w-auto min-w-[160px]" placeholder="All types" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}
            options={Object.keys(TYPES).map((t) => ({ value: t, label: humanize(t) }))} />
        </div>
        {list.isLoading ? <Loading /> : !items.length ? (
          <Empty icon={<Bell className="h-6 w-6" />} title={tab === "unread" ? "No unread notifications" : "No notifications"} />
        ) : (
          <ul className={cn("divide-y divide-slate-100", list.isFetching && "opacity-70")}>
            {items.map((n) => {
              const t = TYPES[n.type] || TYPES.system;
              const Icon = t.icon;
              return (
                <li key={n.id} className={cn("group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50", !n.is_read && "bg-blue-50/40")}>
                  <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", t.cls)}><Icon className="h-4 w-4" /></span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-sm", n.is_read ? "text-slate-700" : "font-semibold text-slate-900")}>{n.title}</span>
                      {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-xs text-slate-600">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted" title={fmtDateTime(n.created_at)}>
                      {fromNow(n.created_at)} · {humanize(n.type)}{n.emailed_at ? " · emailed" : ""}
                    </span>
                  </button>
                  {!n.is_read && (
                    <IconButton title="Mark as read" className="opacity-60 group-hover:opacity-100" onClick={() => mark.mutate([n.id])}>
                      <CheckCheck className="h-4 w-4" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />
        )}
      </div>
    </div>
  );
}
