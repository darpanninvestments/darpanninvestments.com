"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, Bot, CalendarCheck, CalendarClock, CheckCircle2, Copy, ExternalLink, FileText, Mail, MapPin,
  MessageCircle, MessageSquare, Phone, Pin, Send, StickyNote, Tag, Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, fromNow, money } from "@/lib/utils";
import { CompleteFollowUpModal, RescheduleModal } from "./followup-actions";
import { ConvertModal, LeadQuickActions, StatusModal } from "./lead-actions";
import { Avatar, Badge, Button, Card, Checkbox, Empty, IconButton, KeyValue, Loading, PriorityBadge, StatusPill, Tabs, Textarea } from "./ui";

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  call: { icon: <Phone className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-700", label: "Calls" },
  whatsapp: { icon: <MessageCircle className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-700", label: "WhatsApp" },
  sms: { icon: <MessageSquare className="h-3.5 w-3.5" />, color: "bg-slate-100 text-slate-700", label: "SMS" },
  email: { icon: <Mail className="h-3.5 w-3.5" />, color: "bg-violet-100 text-violet-700", label: "Email" },
  note: { icon: <StickyNote className="h-3.5 w-3.5" />, color: "bg-amber-100 text-amber-700", label: "Notes" },
  followup: { icon: <CalendarClock className="h-3.5 w-3.5" />, color: "bg-sky-100 text-sky-700", label: "Follow-ups" },
  status: { icon: <Tag className="h-3.5 w-3.5" />, color: "bg-pink-100 text-pink-700", label: "Status" },
  assignment: { icon: <ArrowRightLeft className="h-3.5 w-3.5" />, color: "bg-indigo-100 text-indigo-700", label: "Assignment" },
  visit: { icon: <MapPin className="h-3.5 w-3.5" />, color: "bg-teal-100 text-teal-700", label: "Visits" },
  meeting: { icon: <CalendarCheck className="h-3.5 w-3.5" />, color: "bg-cyan-100 text-cyan-700", label: "Meetings" },
  document: { icon: <FileText className="h-3.5 w-3.5" />, color: "bg-orange-100 text-orange-700", label: "Documents" },
  conversion: { icon: <Trophy className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-700", label: "Conversion" },
  system: { icon: <Bot className="h-3.5 w-3.5" />, color: "bg-slate-100 text-slate-500", label: "System" },
};

export function Timeline({ items, onPin }: { items: Row[]; onPin?: (a: Row) => void }) {
  if (!items.length) return <Empty title="No activity yet" />;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {items.map((a) => {
        const t = TYPE_META[a.type] || TYPE_META.system;
        return (
          <li key={a.id} className="relative">
            <span className={cn("absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white", t.color)}>{t.icon}</span>
            <div className={cn("rounded-lg border px-3 py-2", a.is_pinned ? "border-amber-200 bg-amber-50/60" : "border-transparent")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{a.title}</p>
                {onPin && (
                  <IconButton title={a.is_pinned ? "Unpin" : "Pin"} onClick={() => onPin(a)} className={a.is_pinned ? "text-amber-600" : "opacity-40 hover:opacity-100"}>
                    <Pin className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>
              {a.description && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{a.description}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>{a.user_name}</span>·<span title={fmtDateTime(a.created_at)}>{fromNow(a.created_at)}</span>
                {!a.is_internal && <Badge tone="green">Client-facing</Badge>}
                {a.meta?.outcome && <Badge>{a.meta.outcome}</Badge>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LeadPanel({ leadId, full }: { leadId: number; full?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tlType, setTlType] = useState("");
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const [modal, setModal] = useState<"status" | "convert" | null>(null);
  const [fuAction, setFuAction] = useState<{ fu: Row; kind: "complete" | "reschedule" } | null>(null);
  const lead = useQuery({ queryKey: ["lead", leadId], queryFn: () => api.get(`/api/leads/${leadId}`) });
  const tl = useQuery({ queryKey: ["timeline", leadId, tlType], queryFn: () => api.get<Row[]>(`/api/leads/${leadId}/timeline`, { type: tlType }) });
  const addNote = useMutation({
    mutationFn: () => api.post(`/api/leads/${leadId}/activity`, { type: "note", description: note, is_internal: internal }),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["timeline", leadId] }); toast.success("Note added"); },
  });
  const pin = async (a: Row) => { await api.patch(`/api/activities/${a.id}`, { is_pinned: !a.is_pinned }); qc.invalidateQueries({ queryKey: ["timeline", leadId] }); };

  if (lead.isLoading) return <Loading />;
  if (lead.error || !lead.data) return <Empty title="Lead not available" text={(lead.error as Error)?.message} />;
  const l = lead.data;
  const pendingFu = (l.followups || []).filter((f: Row) => f.status === "pending");
  const overdue = (d?: string) => d && new Date(d) < new Date();

  return (
    <div className={cn("space-y-4", !full && "p-5")}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={l.name} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{l.name}</h2>
              <PriorityBadge value={l.priority} />
              {l.is_duplicate && <Badge tone="amber">Possible duplicate</Badge>}
              {l.client_id && <Link href={`/clients/${l.client_id}`}><Badge tone="green">Client</Badge></Link>}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
              <span className="font-mono text-xs">{l.code}</span>
              <a href={`tel:${l.mobile}`} className="hover:text-primary">{l.mobile}</a>
              <button type="button" title="Copy mobile" onClick={() => { navigator.clipboard.writeText(l.mobile); toast.success("Copied"); }}><Copy className="h-3 w-3" /></button>
              {l.email && <a href={`mailto:${l.email}`} className="truncate hover:text-primary">{l.email}</a>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!can("leads", "edit")} onClick={() => setModal("status")} className="disabled:cursor-default">
            <Badge color={l.status_color} className="px-3 py-1 text-xs">{l.status_name || "No status"}{l.sub_status_name ? ` · ${l.sub_status_name}` : ""}</Badge>
          </button>
          {!full && <Link href={`/leads/${l.id}`} title="Open full page" className="text-slate-400 hover:text-primary"><ExternalLink className="h-4 w-4" /></Link>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-slate-50/60 p-2">
        <LeadQuickActions lead={l} size="panel" />
        {can("leads", "convert") && !l.client_id && (
          <Button size="sm" variant="success" icon={<Trophy className="h-4 w-4" />} onClick={() => setModal("convert")}>Convert</Button>
        )}
      </div>

      <div className={cn("grid gap-4", full && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
        <div className="space-y-4">
          <Card title="Details" bodyClass="p-4">
            <KeyValue items={[
              ["Owner", l.assigned_to_name || <span className="text-amber-600">Unassigned</span>],
              ["Source", [l.source_name, l.sub_source].filter(Boolean).join(" · ")],
              ["Campaign", [l.campaign, l.ad_set, l.ad_name].filter(Boolean).join(" / ")],
              ["Project", l.project_name], ["Property type", l.property_type],
              ["Budget", l.budget_min || l.budget_max ? `${money(l.budget_min)} – ${money(l.budget_max)}` : null],
              ["Purpose", l.purpose], ["Preferred location", l.preferred_location],
              ["City", [l.city, l.state].filter(Boolean).join(", ")], ["Next follow-up", l.next_followup_at ? fmtDateTime(l.next_followup_at) : null],
              ["Next action", l.next_action], ["Loss reason", l.loss_reason],
              ["Visits / Meetings", `${l.visit_count} / ${l.meeting_count}`], ["Company", l.company_name],
              ["Created", `${fmtDateTime(l.created_at)}${l.created_by_name ? ` by ${l.created_by_name}` : ""}`], ["Last activity", fromNow(l.last_activity_at)],
            ]} />
            {l.requirement && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{l.requirement}</p>}
            {l.custom_fields && Object.keys(l.custom_fields).length > 0 && (
              <div className="mt-3 border-t border-border pt-3"><KeyValue items={Object.entries(l.custom_fields).map(([k, v]) => [k.replace(/_/g, " "), String(v ?? "")])} /></div>
            )}
          </Card>

          <Card title={`Pending follow-ups (${pendingFu.length})`} bodyClass="p-0">
            {!pendingFu.length ? <p className="p-4 text-sm text-muted">No pending follow-ups. Every lead should have a next action.</p> : (
              <ul className="divide-y divide-slate-100">
                {pendingFu.map((f: Row) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", overdue(f.due_at) && "text-danger")}>{fmtDateTime(f.due_at)} {overdue(f.due_at) && "· overdue"}</p>
                      <p className="truncate text-xs text-muted">{f.type} {f.notes ? `· ${f.notes}` : ""}</p>
                    </div>
                    {can("followups", "edit") && (
                      <div className="flex gap-1">
                        <Button size="xs" variant="outline" onClick={() => setFuAction({ fu: { ...f, name: l.name }, kind: "reschedule" })}>Reschedule</Button>
                        <Button size="xs" variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setFuAction({ fu: { ...f, name: l.name }, kind: "complete" })}>Done</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(l.visits?.length > 0 || l.meetings?.length > 0) && (
            <Card title="Visits & meetings" bodyClass="p-0">
              <ul className="divide-y divide-slate-100 text-sm">
                {[...(l.visits || []).map((v: Row) => ({ ...v, _k: "Site visit" })), ...(l.meetings || []).map((m: Row) => ({ ...m, _k: m.title || "Meeting" }))]
                  .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)).map((e: Row) => (
                    <li key={`${e._k}-${e.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="min-w-0"><span className="block truncate font-medium">{e._k}</span>
                        <span className="text-xs text-muted">{fmtDateTime(e.scheduled_at)}{e.outcome ? ` · ${e.outcome}` : ""}</span></span>
                      <span className="flex items-center gap-2">
                        {e.meeting_link && <a href={e.meeting_link} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary">Join</a>}
                        <StatusPill value={e.status} />
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
          {l.duplicates?.length > 0 && (
            <Card title="Possible duplicates">
              <ul className="space-y-1 text-sm">{l.duplicates.map((d: Row) => <li key={d.id}><Link className="text-primary hover:underline" href={`/leads/${d.id}`}>{d.code} · {d.name}</Link></li>)}</ul>
            </Card>
          )}
        </div>

        <Card title="Activity timeline" bodyClass="p-0">
          <div className="border-b border-border p-3">
            <Textarea rows={2} placeholder="Add a note… (Ctrl+Enter to save)" value={note} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && note.trim()) addNote.mutate(); }} />
            <div className="mt-2 flex items-center justify-between">
              <Checkbox label={<span className="text-xs">Internal</span>} checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              <Button size="sm" disabled={!note.trim()} loading={addNote.isPending} icon={<Send className="h-3.5 w-3.5" />} onClick={() => addNote.mutate()}>Add note</Button>
            </div>
          </div>
          <Tabs className="px-2" value={tlType} onChange={setTlType}
            tabs={[{ value: "", label: "All" }, ...["call,whatsapp,sms,email", "note", "status,assignment", "followup", "visit,meeting", "document"].map((v) => ({ value: v, label: TYPE_META[v.split(",")[0]].label.replace("Calls", "Communication") }))]} />
          <div className="max-h-[70vh] overflow-y-auto p-4 pl-8">
            {tl.isLoading ? <Loading /> : <Timeline items={tl.data || []} onPin={pin} />}
          </div>
        </Card>
      </div>

      {modal === "status" && <StatusModal lead={l} open onClose={() => setModal(null)} />}
      {modal === "convert" && <ConvertModal lead={l} open onClose={() => setModal(null)} />}
      {fuAction?.kind === "complete" && <CompleteFollowUpModal fu={fuAction.fu} open onClose={() => setFuAction(null)} />}
      {fuAction?.kind === "reschedule" && <RescheduleModal fu={fuAction.fu} open onClose={() => setFuAction(null)} />}
      <p className="text-right text-[11px] text-slate-400">Updated {fmtDate(l.updated_at, "dd MMM yyyy HH:mm")}</p>
    </div>
  );
}
