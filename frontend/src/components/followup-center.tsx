"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, ArrowRightLeft, CalendarClock, CheckCircle2, Clock, Mail, MessageCircle, MessageSquare, Phone, StickyNote, Sun } from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDateTime, fromNow, waLink, openUrl } from "@/lib/utils";
import { opts } from "./data";
import { CompleteFollowUpModal, RescheduleModal, useFollowupInvalidate } from "./followup-actions";
import { LogModal } from "./lead-actions";
import { Avatar, Badge, Button, Drawer, Empty, IconButton, Loading, Modal, Pagination, PriorityBadge, Select, Field } from "./ui";
import { LeadPanel } from "./lead-panel";

const BUCKETS = [
  { key: "overdue", label: "Overdue", icon: <AlarmClock className="h-4 w-4" />, cls: "text-red-600 bg-red-50 ring-red-200" },
  { key: "due_now", label: "Due now", icon: <Clock className="h-4 w-4" />, cls: "text-amber-700 bg-amber-50 ring-amber-200" },
  { key: "later_today", label: "Later today", icon: <Sun className="h-4 w-4" />, cls: "text-blue-700 bg-blue-50 ring-blue-200" },
  { key: "upcoming", label: "Upcoming", icon: <CalendarClock className="h-4 w-4" />, cls: "text-slate-700 bg-slate-100 ring-slate-200" },
];
const GROUPS = [
  { value: "", label: "No grouping" }, { value: "assigned_to_name", label: "Group by agent" }, { value: "priority", label: "Group by priority" },
  { value: "project_name", label: "Group by project" }, { value: "source_name", label: "Group by source" }, { value: "status_name", label: "Group by status" },
];

export function FollowUpCenter({ compact, defaultBucket = "overdue", extraParams = {} }: { compact?: boolean; defaultBucket?: string; extraParams?: Row }) {
  const { can, meta } = useAuth();
  const invalidate = useFollowupInvalidate();
  const [bucket, setBucket] = useState(defaultBucket);
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [action, setAction] = useState<{ kind: "complete" | "reschedule" | "note" | "bulk-reschedule" | "bulk-assign"; fu?: Row } | null>(null);
  const [lead, setLead] = useState<number | null>(null);
  const dayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); })();
  const counters = useQuery({
    queryKey: ["followup-counters", extraParams], refetchInterval: 60_000,
    queryFn: () => api.get<Record<string, number>>("/api/followups/counters", { day_start: dayStart, ...extraParams }),
  });
  const list = useQuery({
    queryKey: ["/api/followups", bucket, page, extraParams], refetchInterval: 60_000,
    queryFn: () => api.get<Paged<Row>>("/api/followups", { bucket, day_start: dayStart, page, page_size: compact ? 8 : 30, sort: bucket === "completed" ? "-completed_at" : "due_at", ...extraParams }),
  });
  const items = list.data?.items || [];
  const grouped = group ? items.reduce<Record<string, Row[]>>((acc, f) => { const k = f[group] || "—"; (acc[k] ||= []).push(f); return acc; }, {}) : { "": items };
  const quickComplete = async (fu: Row, outcome: string) => {
    await api.post(`/api/followups/${fu.id}/complete`, { outcome });
    toast.success(`Marked ${outcome}`); invalidate();
  };
  const logComm = async (fu: Row, type: string) => {
    if (fu.lead_id) await api.post(`/api/leads/${fu.lead_id}/activity`, { type, description: `${type} from follow-up center` }).catch(() => null);
  };

  return (
    <div>
      <div className={cn("grid gap-2 p-3", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4")}>
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" onClick={() => { setBucket(b.key); setPage(1); setSelected([]); }}
            className={cn("flex items-center justify-between rounded-lg px-3 py-2.5 text-left ring-1 transition", b.cls, bucket === b.key ? "ring-2 shadow-sm" : "opacity-80 hover:opacity-100")}>
            <span className="flex items-center gap-2 text-xs font-medium">{b.icon}{b.label}</span>
            <span className="text-xl font-semibold">{counters.data?.[b.key] ?? "…"}</span>
          </button>
        ))}
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 border-y border-border px-3 py-2">
          <Select className="w-auto" value={group} onChange={(e) => setGroup(e.target.value)} options={GROUPS.slice(1)} placeholder="No grouping" />
          <Button size="sm" variant={bucket === "completed" ? "secondary" : "ghost"} onClick={() => setBucket("completed")}>Completed</Button>
          {selected.length > 0 && (<>
            <span className="text-sm font-medium text-primary">{selected.length} selected</span>
            <Button size="xs" variant="outline" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setAction({ kind: "bulk-reschedule" })}>Reschedule</Button>
            {can("followups", "assign") && <Button size="xs" variant="outline" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setAction({ kind: "bulk-assign" })}>Assign</Button>}
          </>)}
        </div>
      )}
      {list.isLoading ? <Loading /> : !items.length ? (
        <Empty icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />} title={bucket === "overdue" ? "Nothing overdue" : "No follow-ups here"} text="Pick another bucket above." />
      ) : (
        <div className="divide-y divide-slate-100">
          {Object.entries(grouped).map(([g, rows]) => (
            <div key={g}>
              {g && <p className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500">{g} · {rows.length}</p>}
              {rows.map((f) => {
                const overdue = f.status === "pending" && new Date(f.due_at) < new Date();
                return (
                  <div key={f.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-slate-50/70", overdue && "border-l-2 border-l-red-400")}>
                    {!compact && f.status === "pending" && (
                      <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={selected.includes(f.id)}
                        onChange={() => setSelected(selected.includes(f.id) ? selected.filter((x) => x !== f.id) : [...selected, f.id])} />
                    )}
                    <button type="button" onClick={() => f.lead_id && setLead(f.lead_id)} className="flex min-w-[200px] flex-1 items-center gap-2.5 text-left">
                      <Avatar name={f.name} size={32} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{f.name || "—"}</span>
                          {f.status_name && <Badge color={f.status_color}>{f.status_name}</Badge>}</span>
                        <span className="block truncate text-xs text-muted">{f.mobile} · {f.type}{f.project_name ? ` · ${f.project_name}` : ""}{f.notes ? ` · ${f.notes}` : ""}</span>
                      </span>
                    </button>
                    <div className="w-36 text-xs">
                      <p className={cn("font-medium", overdue ? "text-danger" : "text-slate-700")}>{fmtDateTime(f.due_at)}</p>
                      <p className="text-muted">{f.status === "completed" ? f.outcome : fromNow(f.due_at)}</p>
                    </div>
                    {!compact && <div className="hidden w-28 text-xs text-slate-600 md:block">{f.assigned_to_name}</div>}
                    <PriorityBadge value={f.priority} />
                    {f.status === "pending" && (
                      <div className="flex items-center gap-0.5">
                        <IconButton title="Call" tone="blue" onClick={() => { logComm(f, "call"); openUrl(`tel:${f.mobile}`); }}><Phone className="h-3.5 w-3.5" /></IconButton>
                        <a href={waLink(f.mobile, `Hello ${f.name}, `)} target="_blank" rel="noreferrer" onClick={() => logComm(f, "whatsapp")} title="WhatsApp"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"><MessageCircle className="h-3.5 w-3.5" /></a>
                        <IconButton title="SMS" onClick={() => { logComm(f, "sms"); openUrl(`sms:${f.mobile}`); }}><MessageSquare className="h-3.5 w-3.5" /></IconButton>
                        {f.email && <IconButton title="Email" tone="violet" onClick={() => { logComm(f, "email"); openUrl(`mailto:${f.email}`); }}><Mail className="h-3.5 w-3.5" /></IconButton>}
                        {f.lead_id && <IconButton title="Add note" tone="amber" onClick={() => setAction({ kind: "note", fu: f })}><StickyNote className="h-3.5 w-3.5" /></IconButton>}
                        <IconButton title="Reschedule" onClick={() => setAction({ kind: "reschedule", fu: f })}><CalendarClock className="h-3.5 w-3.5" /></IconButton>
                        <IconButton title="No answer (auto retry)" onClick={() => quickComplete(f, "No Answer")}><AlarmClock className="h-3.5 w-3.5" /></IconButton>
                        <Button size="xs" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setAction({ kind: "complete", fu: f })}>Done</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {compact ? (
        <div className="border-t border-border px-4 py-2 text-right"><Link href="/followups" className="inline-flex items-center gap-1 py-2 text-xs font-medium text-primary hover:underline">Open follow-up center <ArrowRight className="h-3.5 w-3.5" /></Link></div>
      ) : list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}

      {action?.kind === "complete" && action.fu && <CompleteFollowUpModal fu={action.fu} open onClose={() => setAction(null)} />}
      {action?.kind === "reschedule" && action.fu && <RescheduleModal fu={action.fu} open onClose={() => setAction(null)} />}
      {action?.kind === "bulk-reschedule" && <RescheduleModal ids={selected} open onClose={() => { setAction(null); setSelected([]); }} />}
      {action?.kind === "note" && action.fu && <LogModal lead={{ id: action.fu.lead_id, name: action.fu.name }} type="note" open onClose={() => setAction(null)} />}
      {action?.kind === "bulk-assign" && <BulkAssignFollowups ids={selected} users={opts.users(meta)} onClose={() => { setAction(null); setSelected([]); }} />}
      <Drawer open={lead !== null} onClose={() => setLead(null)} width="max-w-3xl" title="Lead">{lead !== null && <LeadPanel leadId={lead} />}</Drawer>
    </div>
  );
}

function BulkAssignFollowups({ ids, users, onClose }: { ids: number[]; users: { value: string | number; label: string }[]; onClose: () => void }) {
  const invalidate = useFollowupInvalidate();
  const [userId, setUserId] = useState("");
  const save = async () => {
    const r = await api.post("/api/followups/bulk", { action: "assign", ids, user_id: Number(userId) });
    toast.success(`Reassigned ${r.updated}`); invalidate(); onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Assign ${ids.length} follow-ups`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!userId} onClick={save}>Assign</Button></>}>
      <Field label="Assign to"><Select value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Select…" options={users} /></Field>
    </Modal>
  );
}
