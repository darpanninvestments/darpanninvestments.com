"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRightLeft, CalendarCheck, CalendarClock, FileText, Mail, MapPin, MessageCircle,
  MessageSquare, MoreHorizontal, Pencil, Phone, StickyNote, Tag, Trash2, Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fillTemplate, fromLocalInput, inHours, money, toLocalInput, tomorrowAt, waLink, openUrl } from "@/lib/utils";
import { FormFields, opts, whenOpen, type FieldDef } from "./data";
import { DocumentShareModal } from "./documents";
import { ScheduleMeetingModal, ScheduleVisitModal } from "./scheduling";
import { Button, Checkbox, Field, IconButton, Input, Menu, MenuItem, Modal, Select, Textarea, useConfirm } from "./ui";

export type LeadAction = "status" | "followup" | "call" | "note" | "sms" | "whatsapp" | "email" | "assign" | "convert"
  | "visit" | "meeting" | "documents" | "edit";

function useLeadInvalidate() {
  const qc = useQueryClient();
  return () => {
    ["/api/leads", "lead", "/api/followups", "followup-counters", "dashboard", "/api/visits", "/api/meetings", "timeline"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

// ── Status change ──────────────────────────────────────────────────────────────
function StatusModalBody({ lead, open, onClose }: { lead: Row; open: boolean; onClose: () => void }) {
  const { meta } = useAuth();
  const invalidate = useLeadInvalidate();
  const [statusId, setStatusId] = useState<number | "">(lead.status_id || "");
  const [subId, setSubId] = useState<number | "">(lead.sub_status_id || "");
  const [reason, setReason] = useState(lead.loss_reason || "");
  const [note, setNote] = useState("");
  const [fu, setFu] = useState("");
  const current = meta?.statuses.find((s) => s.id === lead.status_id);
  const allowed = meta?.statuses.filter((s) => !current?.allowed_next_ids?.length || s.id === current.id || current.allowed_next_ids.includes(s.id)) || [];
  const st = meta?.statuses.find((s) => s.id === statusId);
  const m = useMutation({
    mutationFn: () => api.post(`/api/leads/${lead.id}/status`, {
      status_id: statusId || null, sub_status_id: subId || null, loss_reason: reason || null, note: note || null,
      followup_at: fromLocalInput(fu),
    }),
    onSuccess: () => { toast.success("Status updated"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Change status · ${lead.name}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Update status</Button></>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {allowed.map((s) => (
            <button key={s.id} type="button" onClick={() => { setStatusId(s.id); setSubId(""); }}
              className="rounded-full border-2 px-3 py-1 text-xs font-medium transition"
              style={statusId === s.id ? { background: s.color, borderColor: s.color, color: "#fff" } : { borderColor: s.color, color: s.color }}>
              {s.name}
            </button>
          ))}
        </div>
        {!!st?.sub_statuses.length && (
          <Field label="Sub-status" required={st.requires_reason}>
            <div className="flex flex-wrap gap-1.5">
              {st.sub_statuses.map((s) => (
                <button key={s.id} type="button" onClick={() => setSubId(s.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${subId === s.id ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-slate-600 hover:bg-slate-50"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        {(st?.category === "lost" || st?.requires_reason) && (
          <Field label="Loss reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Select reason…"
              options={(meta?.lookups.loss_reason || []).map((l) => ({ value: l.name, label: l.name }))} />
          </Field>
        )}
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" /></Field>
        {st?.category === "open" && (
          <Field label="Next follow-up" hint="Optional – also creates a reminder">
            <div className="flex flex-wrap gap-2">
              <Input type="datetime-local" className="max-w-[220px]" value={fu} onChange={(e) => setFu(e.target.value)} />
              {[["+2h", inHours(2)], ["Tomorrow 10am", tomorrowAt(10)], ["+3 days", inHours(72)]].map(([l, v]) => (
                <Button key={l} size="sm" variant="outline" onClick={() => setFu(v)}>{l}</Button>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ── Follow-up ──────────────────────────────────────────────────────────────────
function FollowUpModalBody({ lead, clientId, open, onClose }: { lead?: Row; clientId?: number; open: boolean; onClose: () => void }) {
  const { can, meta } = useAuth();
  const invalidate = useLeadInvalidate();
  const [form, setForm] = useState<Row>(() => ({ due_at: tomorrowAt(10), type: "call", reminder_minutes: 15, assigned_to_id: lead?.assigned_to_id || "" }));
  const m = useMutation({
    mutationFn: () => api.post("/api/followups", {
      lead_id: lead?.id, client_id: clientId, due_at: fromLocalInput(form.due_at), type: form.type, notes: form.notes,
      reminder_minutes: Number(form.reminder_minutes), assigned_to_id: form.assigned_to_id || null, next_action: form.next_action,
    }),
    onSuccess: () => { toast.success("Follow-up scheduled"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Schedule follow-up${lead ? ` · ${lead.name}` : ""}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!form.due_at} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date & time" required className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Input type="datetime-local" className="max-w-[220px]" value={form.due_at || ""} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
            {[["In 1 hour", inHours(1)], ["This evening", (() => { const d = new Date(); d.setHours(18, 0, 0, 0); return toLocalInput(d.toISOString()); })()], ["Tomorrow 10am", tomorrowAt(10)], ["In 1 week", inHours(168)]].map(([l, v]) => (
              <Button key={l} size="sm" variant="outline" onClick={() => setForm({ ...form, due_at: v })}>{l}</Button>
            ))}
          </div>
        </Field>
        <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={opts.list("call", "whatsapp", "email", "meeting", "visit", "other").map((o) => ({ ...o, label: o.label[0].toUpperCase() + o.label.slice(1) }))} /></Field>
        <Field label="Remind me">
          <Select value={form.reminder_minutes} onChange={(e) => setForm({ ...form, reminder_minutes: e.target.value })}
            options={[[0, "At the time"], [5, "5 min before"], [10, "10 min before"], [15, "15 min before"], [30, "30 min before"], [60, "1 hour before"], [120, "2 hours before"], [1440, "1 day before"]].map(([v, l]) => ({ value: v, label: String(l) }))} />
        </Field>
        {can("followups", "assign") && (
          <Field label="Assign to"><Select value={form.assigned_to_id ?? ""} placeholder="Lead owner" onChange={(e) => setForm({ ...form, assigned_to_id: e.target.value })} options={opts.users(meta)} /></Field>
        )}
        <Field label="Next action"><Input value={form.next_action || ""} onChange={(e) => setForm({ ...form, next_action: e.target.value })} placeholder="e.g. Share price list" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ── Log call / note / sms ──────────────────────────────────────────────────────
function LogModalBody({ lead, type, open, onClose }: { lead: Row; type: "call" | "note" | "sms"; open: boolean; onClose: () => void }) {
  const invalidate = useLeadInvalidate();
  const [desc, setDesc] = useState("");
  const [outcome, setOutcome] = useState(type === "call" ? "Connected" : "");
  const [internal, setInternal] = useState(true);
  const [fu, setFu] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/api/leads/${lead.id}/activity`, { type, description: desc, outcome: outcome || undefined, is_internal: internal, followup_at: fromLocalInput(fu) }),
    onSuccess: () => { toast.success(type === "note" ? "Note added" : "Logged"); invalidate(); onClose(); },
  });
  const title = { call: "Log call", note: "Add note", sms: "Log SMS" }[type];
  return (
    <Modal open={open} onClose={onClose} title={`${title} · ${lead.name}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={type === "note" && !desc.trim()} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {type === "call" && (
          <Field label="Outcome">
            <div className="flex flex-wrap gap-1.5">
              {["Connected", "No Answer", "Busy", "Switched Off", "Call Back", "Wrong Number"].map((o) => (
                <button key={o} type="button" onClick={() => setOutcome(o)} className={`rounded-md border px-2.5 py-1 text-xs ${outcome === o ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-slate-600"}`}>{o}</button>
              ))}
            </div>
          </Field>
        )}
        <Field label={type === "note" ? "Note" : "Summary"}><Textarea rows={4} autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        {type === "note" && <Checkbox label="Internal note (not client-facing)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
        <Field label="Follow-up" hint="Optional">
          <div className="flex flex-wrap gap-2">
            <Input type="datetime-local" className="max-w-[220px]" value={fu} onChange={(e) => setFu(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => setFu(inHours(2))}>+2h</Button>
            <Button size="sm" variant="outline" onClick={() => setFu(tomorrowAt(10))}>Tomorrow</Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ── WhatsApp with templates ────────────────────────────────────────────────────
function WhatsAppModalBody({ lead, open, onClose }: { lead: Row; open: boolean; onClose: () => void }) {
  const { meta, me } = useAuth();
  const invalidate = useLeadInvalidate();
  const templates = meta?.templates.filter((t) => t.channel === "whatsapp") || [];
  const vars = { name: lead.name, agent: me?.user.name, project: lead.project_name || "our projects" };
  const [text, setText] = useState(() => (templates[0] ? fillTemplate(templates[0].body, vars) : `Hello ${lead.name}, `));
  const send = async () => {
    window.open(waLink(lead.mobile, text), "_blank", "noopener");
    await api.post(`/api/leads/${lead.id}/activity`, { type: "whatsapp", description: text, is_internal: false });
    invalidate();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`WhatsApp · ${lead.name}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="success" icon={<MessageCircle className="h-4 w-4" />} onClick={send}>Open WhatsApp</Button></>}>
      <div className="space-y-3">
        {!!templates.length && (
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => <Button key={t.id} size="xs" variant="outline" onClick={() => setText(fillTemplate(t.body, vars))}>{t.name}</Button>)}
          </div>
        )}
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-muted">Opens WhatsApp ({lead.mobile}) with this message and records it on the lead timeline.</p>
      </div>
    </Modal>
  );
}

// ── Email (real SMTP send, optional attachments) ───────────────────────────────
function EmailModalBody({ lead, open, onClose }: { lead: Row; open: boolean; onClose: () => void }) {
  const { meta, me, can } = useAuth();
  const invalidate = useLeadInvalidate();
  const [to, setTo] = useState(lead.email || "");
  const [subject, setSubject] = useState("Regarding your property enquiry – Darpann Investments");
  const [body, setBody] = useState(`Dear ${lead.name},\n\n`);
  const [docIds, setDocIds] = useState<number[]>([]);
  const vars = { name: lead.name, agent: me?.user.name, project: lead.project_name || "our projects" };
  const templates = meta?.templates.filter((t) => t.channel === "email") || [];
  const docs = useQuery({ queryKey: ["lead-docs", lead.id], queryFn: () => api.get<Row[]>(`/api/documents/for-lead/${lead.id}`), enabled: open && can("documents", "share") });
  const m = useMutation({
    mutationFn: () => api.post(`/api/leads/${lead.id}/email`, { to, subject, body, document_ids: docIds }),
    onSuccess: () => { toast.success("Email queued for delivery"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Email · ${lead.name}`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!to || !subject} icon={<Mail className="h-4 w-4" />} onClick={() => m.mutate()}>Send email</Button></>}>
      <div className="space-y-3">
        {!!templates.length && <div className="flex flex-wrap gap-1.5">{templates.map((t) => (
          <Button key={t.id} size="xs" variant="outline" onClick={() => { setSubject(fillTemplate(t.subject || subject, vars)); setBody(fillTemplate(t.body, vars)); }}>{t.name}</Button>
        ))}</div>}
        <Field label="To"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        {!!docs.data?.length && (
          <Field label="Attach project documents">
            <div className="grid gap-1 sm:grid-cols-2">
              {docs.data.map((d) => <Checkbox key={d.id} label={`${d.title} (${d.category})`} checked={docIds.includes(d.id)}
                onChange={(e) => setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))} />)}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ── Assign ─────────────────────────────────────────────────────────────────────
function AssignModalBody({ lead, ids, open, onClose }: { lead?: Row; ids?: number[]; open: boolean; onClose: () => void }) {
  const { meta } = useAuth();
  const invalidate = useLeadInvalidate();
  const [userId, setUserId] = useState<string>(lead?.assigned_to_id ? String(lead.assigned_to_id) : "");
  const m = useMutation({
    mutationFn: () => ids?.length
      ? api.post("/api/leads/bulk", { action: "assign", ids, user_id: userId ? Number(userId) : null })
      : api.post(`/api/leads/${lead!.id}/assign`, { user_id: userId ? Number(userId) : null }),
    onSuccess: () => { toast.success("Assignment updated"); invalidate(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={ids?.length ? `Assign ${ids.length} leads` : `Assign · ${lead?.name}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Assign</Button></>}>
      <Field label="Assign to"><Select value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Unassigned" options={opts.users(meta)} /></Field>
    </Modal>
  );
}

// ── Convert to client ──────────────────────────────────────────────────────────
function ConvertModalBody({ lead, open, onClose, onDone }: { lead: Row; open: boolean; onClose: () => void; onDone?: (clientId: number) => void }) {
  const { meta } = useAuth();
  const invalidate = useLeadInvalidate();
  const [form, setForm] = useState<Row>(() => ({ project_id: lead.project_id, property_id: lead.property_id, booking_date: new Date().toISOString() }));
  const props = useQuery({
    queryKey: ["props-for", form.project_id], enabled: open && !!form.project_id,
    queryFn: () => api.get<{ items: Row[] }>("/api/properties", { project_id: form.project_id, page_size: 0 }),
  });
  const fields: FieldDef[] = [
    { key: "project_id", label: "Project", type: "select", options: opts.projects(meta), onChange: () => ({ property_id: null }) },
    { key: "property_id", label: "Unit / Property", type: "select", options: (props.data?.items || []).filter((p) => ["Available", "Hold", "Reserved"].includes(p.availability) || p.id === lead.property_id).map((p) => ({ value: p.id, label: `${p.code}${p.unit_no ? ` · ${p.unit_no}` : ""} · ${p.availability}${p.offer_price || p.base_price ? ` · ${money(p.offer_price || p.base_price)}` : ""}` })) },
    { key: "booking_date", label: "Booking date", type: "date" },
    { key: "booking_amount", label: "Booking amount (₹)", type: "number" },
    { key: "deal_value", label: "Deal value (₹)", type: "number" },
    { key: "payment_plan", label: "Payment plan", type: "text", placeholder: "e.g. 20:80 / CLP" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const m = useMutation({
    mutationFn: () => api.post<{ client_id: number; client_code: string }>(`/api/leads/${lead.id}/convert`, form),
    onSuccess: (r) => { toast.success(`Converted to client ${r.client_code}`); invalidate(); onClose(); onDone?.(r.client_id); },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Convert to client · ${lead.name}`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="success" loading={m.isPending} icon={<Trophy className="h-4 w-4" />} onClick={() => m.mutate()}>Convert</Button></>}>
      <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">The client record reuses all lead details and history. A document checklist is created automatically and the selected unit is marked Booked.</p>
      <FormFields fields={fields} value={form} onChange={setForm} />
    </Modal>
  );
}

// ── Create / edit lead with live duplicate check ───────────────────────────────
function LeadFormModalBody({ open, onClose, lead, onSaved }: { open: boolean; onClose: () => void; lead?: Row | null; onSaved?: (l: Row) => void }) {
  const { meta, me, can } = useAuth();
  const invalidate = useLeadInvalidate();
  const [form, setForm] = useState<Row>(() => (lead ? { ...lead } : { priority: "Warm", whatsapp_available: true, company_id: me?.company?.id }));
  const [dups, setDups] = useState<Row[]>([]);
  useEffect(() => {
    if (!open || (!form.mobile && !form.email)) return;
    const t = setTimeout(async () => {
      if ((form.mobile || "").replace(/\D/g, "").length < 7 && !form.email) return;
      const r = await api.get<{ duplicates: Row[] }>("/api/leads/check-duplicate", { mobile: form.mobile, email: form.email, company_id: form.company_id, exclude_id: lead?.id }).catch(() => ({ duplicates: [] }));
      setDups(r.duplicates);
    }, 500);
    return () => clearTimeout(t);
  }, [form.mobile, form.email, form.company_id, open, lead]);
  const customFields: FieldDef[] = useMemo(() => (meta?.custom_fields || []).filter((f) => f.module === "lead" && f.is_active).map((f) => ({
    key: `cf_${f.key}`, label: f.label, required: f.required,
    type: f.field_type === "select" ? "select" : f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : f.field_type === "textarea" ? "textarea" : f.field_type === "checkbox" ? "checkbox" : "text",
    options: (Array.isArray(f.options) ? f.options : String(f.options || "").split(",")).map((o: string) => ({ value: String(o).trim(), label: String(o).trim() })),
  })), [meta]);
  const fields: FieldDef[] = [
    { key: "company_id", label: "Company", type: "select", options: opts.companies(meta), required: true, hidden: (_f, c) => !c.isGlobal || c.editing },
    { key: "name", label: "Full name", required: true },
    { key: "mobile", label: "Mobile", type: "tel", required: true },
    { key: "alt_mobile", label: "Alternate mobile", type: "tel" },
    { key: "email", label: "Email", type: "email" },
    { key: "source_id", label: "Source", type: "select", options: opts.sources(meta) },
    { key: "sub_source", label: "Sub-source / campaign detail" },
    { key: "campaign", label: "Campaign" },
    { key: "project_id", label: "Interested project", type: "select", options: opts.projects(meta) },
    { key: "property_type", label: "Property type", type: "select", options: opts.lookup("property_type")(meta) },
    { key: "purpose", label: "Purpose", type: "select", options: opts.lookup("purpose")(meta) },
    { key: "budget_min", label: "Budget min (₹)", type: "number" },
    { key: "budget_max", label: "Budget max (₹)", type: "number" },
    { key: "preferred_location", label: "Preferred location" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "priority", label: "Priority", type: "select", options: opts.list("Hot", "Warm", "Cold") },
    ...(can("leads", "assign") && !lead ? [{ key: "assigned_to_id", label: "Assign to", type: "select" as const, options: opts.users(meta), placeholder: "Auto-assign" }] : []),
    ...(!lead ? [{ key: "next_followup_at", label: "First follow-up", type: "datetime" as const }] : []),
    { key: "whatsapp_available", label: "WhatsApp", type: "checkbox", placeholder: "Available on WhatsApp" },
    { key: "requirement", label: "Requirement details", type: "textarea" },
    ...customFields,
  ];
  const value = useMemo(() => ({ ...form, ...Object.fromEntries(Object.entries(form.custom_fields || {}).map(([k, v]) => [`cf_${k}`, v])) }), [form]);
  const m = useMutation({
    meta: { silent: true },
    mutationFn: (force: boolean) => {
      const cf = Object.fromEntries(Object.entries(value).filter(([k]) => k.startsWith("cf_")).map(([k, v]) => [k.slice(3), v]));
      const body = { ...Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith("cf_"))), custom_fields: Object.keys(cf).length ? cf : form.custom_fields, force };
      return lead ? api.patch(`/api/leads/${lead.id}`, body) : api.post("/api/leads", body);
    },
    onSuccess: (r) => { toast.success(lead ? "Lead updated" : `Lead ${r.code} created`); invalidate(); onSaved?.(r); onClose(); },
    onError: (e: Error & { status?: number }) => { if (e.status !== 409) toast.error(e.message); else toast.warning("Possible duplicate – review and click “Create anyway”."); },
  });
  const missing = !value.name || !value.mobile || (me?.is_global && !lead && !value.company_id);
  return (
    <Modal open={open} onClose={onClose} title={lead ? `Edit lead · ${lead.code}` : "New lead"} size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {!lead && dups.length > 0 && <Button variant="secondary" loading={m.isPending} disabled={!!missing} onClick={() => m.mutate(true)}>Create anyway</Button>}
        <Button loading={m.isPending} disabled={!!missing} onClick={() => m.mutate(false)}>{lead ? "Save changes" : "Create lead"}</Button>
      </>}>
      {dups.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" /> Possible duplicate{dups.length > 1 ? "s" : ""} found</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {dups.map((d) => <li key={d.id}>{d.visible ? <Link className="underline" href={`/leads/${d.id}`} target="_blank">{d.code} · {d.name} · {d.mobile}</Link> : <span>{d.code} (owned by {d.assigned_to_name || "another user"})</span>}{d.visible && d.assigned_to_name ? ` – ${d.assigned_to_name}` : ""}</li>)}
          </ul>
        </div>
      )}
      <FormFields fields={fields} value={value} onChange={setForm} />
    </Modal>
  );
}

// ── Action bar used on board rows, panel and detail ────────────────────────────
/** Actions always visible on phone cards; the rest live in the "More" menu on small screens. */
const CORE = ["tel", "whatsapp", "followup", "status"];

export function LeadQuickActions({ lead, size = "row", onOpen }: { lead: Row; size?: "row" | "panel"; onOpen?: () => void }) {
  const { can } = useAuth();
  const confirm = useConfirm();
  const invalidate = useLeadInvalidate();
  const [action, setAction] = useState<LeadAction | null>(null);
  const close = () => setAction(null);
  const call = () => { openUrl(`tel:${lead.mobile}`); setTimeout(() => setAction("call"), 600); };
  const sms = () => { openUrl(`sms:${lead.mobile}`); setTimeout(() => setAction("sms"), 600); };
  const remove = async () => {
    if (!(await confirm({ title: "Delete lead?", message: `${lead.code} · ${lead.name} will be moved to trash.` }))) return;
    await api.del(`/api/leads/${lead.id}`); toast.success("Lead deleted"); invalidate();
  };
  const icon = size === "panel" ? "h-4 w-4" : "h-3.5 w-3.5";
  const btns: [LeadAction | "tel" | "smsl", string, React.ReactNode, "default" | "green" | "blue" | "red" | "amber" | "violet", boolean][] = [
    ["tel", "Call", <Phone key="c" className={icon} />, "blue", true],
    ["whatsapp", "WhatsApp", <MessageCircle key="w" className={icon} />, "green", !!lead.mobile],
    ["smsl", "SMS", <MessageSquare key="s" className={icon} />, "default", true],
    ["email", "Email", <Mail key="e" className={icon} />, "violet", true],
    ["note", "Add note", <StickyNote key="n" className={icon} />, "amber", true],
    ["followup", "Follow-up", <CalendarClock key="f" className={icon} />, "blue", can("followups", "add")],
    ["visit", "Schedule visit", <MapPin key="v" className={icon} />, "default", can("visits", "add")],
    ["meeting", "Schedule meeting", <CalendarCheck key="m" className={icon} />, "default", can("meetings", "add")],
    ["documents", "Share project documents", <FileText key="d" className={icon} />, "default", can("documents", "share")],
    ["status", "Change status", <Tag key="t" className={icon} />, "default", can("leads", "edit")],
  ];
  return (
    <div className={cn("flex flex-wrap items-center", size === "panel" ? "gap-1.5" : "gap-0.5")} onClick={(e) => e.stopPropagation()}>
      {btns.filter((b) => b[4]).map(([a, title, ic, tone]) => (
        <IconButton key={a} title={title} tone={tone}
          onClick={() => (a === "tel" ? call() : a === "smsl" ? sms() : setAction(a as LeadAction))}
          className={cn(size === "panel" && "h-9 w-9 border border-border", size === "row" && !CORE.includes(a) && "hidden md:inline-flex")}>{ic}</IconButton>
      ))}
      <Menu trigger={(t) => <IconButton title="More actions" onClick={t} className={size === "panel" ? "h-9 w-9 border border-border" : ""}><MoreHorizontal className={icon} /></IconButton>}>
        {(c) => (<>
          {onOpen && <MenuItem icon={<FileText className="h-4 w-4" />} onClick={() => { c(); onOpen(); }}>Open lead</MenuItem>}
          {size === "row" && btns.filter((b) => b[4] && !CORE.includes(b[0])).map(([a, title, ic]) => (
            <div key={a} className="md:hidden">
              <MenuItem icon={ic} onClick={() => { c(); if (a === "smsl") sms(); else setAction(a as LeadAction); }}>{title}</MenuItem>
            </div>
          ))}
          <MenuItem icon={<Phone className="h-4 w-4" />} onClick={() => { c(); setAction("call"); }}>Log a call</MenuItem>
          {can("leads", "assign") && <MenuItem icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => { c(); setAction("assign"); }}>Assign / reassign</MenuItem>}
          {can("leads", "edit") && <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { c(); setAction("edit"); }}>Edit lead</MenuItem>}
          {can("leads", "convert") && !lead.client_id && <MenuItem icon={<Trophy className="h-4 w-4" />} onClick={() => { c(); setAction("convert"); }}>Convert to client</MenuItem>}
          {lead.client_id && <Link href={`/clients/${lead.client_id}`}><MenuItem icon={<Trophy className="h-4 w-4" />}>Open client</MenuItem></Link>}
          {can("leads", "delete") && <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { c(); remove(); }}>Delete</MenuItem>}
        </>)}
      </Menu>
      {action === "status" && <StatusModal lead={lead} open onClose={close} />}
      {action === "followup" && <FollowUpModal lead={lead} open onClose={close} />}
      {(action === "call" || action === "note" || action === "sms") && <LogModal lead={lead} type={action} open onClose={close} />}
      {action === "whatsapp" && <WhatsAppModal lead={lead} open onClose={close} />}
      {action === "email" && <EmailModal lead={lead} open onClose={close} />}
      {action === "assign" && <AssignModal lead={lead} open onClose={close} />}
      {action === "convert" && <ConvertModal lead={lead} open onClose={close} />}
      {action === "edit" && <LeadFormModal lead={lead} open onClose={close} />}
      {action === "visit" && <ScheduleVisitModal open onClose={close} leadId={lead.id} projectId={lead.project_id} onSaved={invalidate} />}
      {action === "meeting" && <ScheduleMeetingModal open onClose={close} leadId={lead.id} projectId={lead.project_id} onSaved={invalidate} />}
      {action === "documents" && <DocumentShareModal open onClose={() => { close(); invalidate(); }} leadId={lead.id} />}
    </div>
  );
}

export const StatusModal = whenOpen(StatusModalBody);

export const FollowUpModal = whenOpen(FollowUpModalBody);

export const LogModal = whenOpen(LogModalBody);

export const WhatsAppModal = whenOpen(WhatsAppModalBody);

export const EmailModal = whenOpen(EmailModalBody);

export const AssignModal = whenOpen(AssignModalBody);

export const ConvertModal = whenOpen(ConvertModalBody);

export const LeadFormModal = whenOpen(LeadFormModalBody);
