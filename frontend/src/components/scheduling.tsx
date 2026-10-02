"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, format, isSameDay, startOfWeek } from "date-fns";
import {
  CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, List, MapPin, Pencil, Plus, Search, Video, X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDateTime, fromLocalInput, fromNow, inHours, toLocalInput, tomorrowAt } from "@/lib/utils";
import {
  Badge, Button, Empty, Field, IconButton, Input, KeyValue, Loading, Modal, PageHeader, Pagination, Select, StatusPill,
  Tabs, Textarea, useConfirm,
} from "./ui";
import { DataTable, RowLink, useList, type Column } from "./data";

// ── Config ─────────────────────────────────────────────────────────────────────
export type ApptKind = "visit" | "meeting";
export const APPT_STATUSES = ["Scheduled", "Confirmed", "Rescheduled", "Completed", "Cancelled", "No Show"];
const KINDS = {
  visit: { endpoint: "/api/visits", module: "visits", owner: "agent_id", ownerName: "agent_name", ownerLabel: "Agent",
    noun: "Site visit", plural: "Site visits", reminder: 60 },
  meeting: { endpoint: "/api/meetings", module: "meetings", owner: "host_id", ownerName: "host_name", ownerLabel: "Host",
    noun: "Meeting", plural: "Meetings", reminder: 30 },
} as const;
const FIELDS: Record<ApptKind, string[]> = {
  visit: ["project_id", "property_id", "scheduled_at", "agent_id", "location", "map_link", "attendees", "reminder_minutes", "notes"],
  meeting: ["project_id", "title", "mode", "purpose", "scheduled_at", "duration_minutes", "host_id", "meeting_link", "location",
    "attendees", "reminder_minutes", "next_action", "notes"],
};
const REMINDERS = [0, 15, 30, 60, 120, 1440].map((m) => ({
  value: m, label: m === 0 ? "No reminder" : m < 60 ? `${m} min before` : m === 1440 ? "1 day before" : `${m / 60} hr before`,
}));
const STATUS_DOT: Record<string, string> = {
  Scheduled: "border-l-violet-500", Confirmed: "border-l-blue-500", Rescheduled: "border-l-amber-500",
  Completed: "border-l-emerald-500", Cancelled: "border-l-red-400", "No Show": "border-l-red-600",
};

/** Refresh every list/detail that may show visits, meetings or follow-ups. */
export function invalidateSchedules(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === "string" && /^(\/api\/(visits|meetings|leads|clients|followups)|client-detail|lead)/.test(k);
    },
  });
}

/** Local date (yyyy-mm-dd) → ISO UTC at start / end of that local day. */
export const dayStartISO = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
export const dayEndISO = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : undefined);

// ── Lead / client search picker ────────────────────────────────────────────────
export function RecordPicker({ kind, value, onChange, placeholder }:
  { kind: "lead" | "client"; value: Row | null; onChange: (r: Row | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const endpoint = kind === "lead" ? "/api/leads" : "/api/clients";
  const res = useQuery({
    queryKey: [`${endpoint}#picker`, dq],
    queryFn: () => api.get<Paged<Row>>(endpoint, { q: dq, page_size: 8 }),
    enabled: open && !value, staleTime: 30_000,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm">
        <RecordLabel r={value} />
        <IconButton title="Clear" onClick={() => onChange(null)}><X className="h-4 w-4" /></IconButton>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <Input className="pl-8" value={q} placeholder={placeholder || `Search ${kind}s by name, mobile or code…`}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-xl">
          {res.isLoading ? <p className="px-3 py-2 text-xs text-muted">Searching…</p>
            : !res.data?.items.length ? <p className="px-3 py-2 text-xs text-muted">No {kind}s found</p>
              : res.data.items.map((r) => (
                <button key={r.id} type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                  onMouseDown={(e) => { e.preventDefault(); onChange(r); setQ(""); setOpen(false); }}>
                  <RecordLabel r={r} />
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

function RecordLabel({ r }: { r: Row }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-slate-800">{r.name}</span>
      <span className="block truncate text-xs text-muted">
        {[r.code, r.mobile, r.project_name, r.status_name || r.stage].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

// ── Schedule / edit form ───────────────────────────────────────────────────────
export type ScheduleModalProps = {
  open: boolean; onClose: () => void; leadId?: number; clientId?: number; projectId?: number;
  onSaved?: (row: Row) => void; initial?: Row | null;
};

export function ScheduleVisitModal(p: ScheduleModalProps) {
  return p.open ? <AppointmentForm kind="visit" {...p} /> : null;
}

export function ScheduleMeetingModal(p: ScheduleModalProps) {
  return p.open ? <AppointmentForm kind="meeting" {...p} /> : null;
}

function AppointmentForm({ kind, onClose, leadId, clientId, projectId, onSaved, initial }: ScheduleModalProps & { kind: ApptKind }) {
  const K = KINDS[kind];
  const { meta, can, lookup } = useAuth();
  const qc = useQueryClient();
  const editing = !!initial?.id;
  const fixedLead = leadId ?? (editing ? initial?.lead_id : undefined) ?? undefined;
  const fixedClient = fixedLead ? undefined : clientId ?? (editing ? initial?.client_id : undefined) ?? undefined;
  const [linkType, setLinkType] = useState<"lead" | "client">("lead");
  const [picked, setPicked] = useState<Row | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [f, setF] = useState<Row>(() => editing ? { ...initial } : {
    project_id: projectId, scheduled_at: fromLocalInput(tomorrowAt(11)), reminder_minutes: K.reminder,
    ...(kind === "meeting" ? { mode: "offline", duration_minutes: 30 } : {}),
  });
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));

  const fixedQ = useQuery({
    queryKey: [fixedLead ? `/api/leads/${fixedLead}` : `/api/clients/${fixedClient}`, "picker"],
    queryFn: () => api.get(fixedLead ? `/api/leads/${fixedLead}` : `/api/clients/${fixedClient}`),
    enabled: !!(fixedLead || fixedClient), staleTime: 60_000,
  });
  const linked = fixedLead || fixedClient ? fixedQ.data : picked;
  const projectVal = f.project_id !== undefined ? f.project_id : linked?.project_id ?? null;

  const propsQ = useQuery({
    queryKey: ["/api/properties", { project_id: projectVal, page_size: 300, sort: "code" }],
    queryFn: () => api.get<Paged<Row>>("/api/properties", { project_id: projectVal, page_size: 300, sort: "code" }),
    enabled: kind === "visit" && !!projectVal && can("properties"), staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (body: Row) => editing ? api.patch(`${K.endpoint}/${initial!.id}`, body) : api.post(K.endpoint, body),
    onSuccess: (row) => {
      toast.success(`${K.noun} ${editing ? "updated" : "scheduled"}`);
      invalidateSchedules(qc);
      onSaved?.(row);
      onClose();
    },
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!editing && !fixedLead && !fixedClient && !picked) e.record = `Pick a ${linkType}`;
    if (!f.scheduled_at) e.scheduled_at = "Date & time is required";
    if (kind === "meeting" && !String(f.title || "").trim()) e.title = "Title is required";
    setErr(e);
    if (Object.keys(e).length) return;
    const data: Row = { ...f, project_id: projectVal };
    const body: Row = {};
    FIELDS[kind].forEach((k) => {
      if (editing) { if ((data[k] ?? null) !== (initial?.[k] ?? null)) body[k] = data[k] === "" ? null : data[k]; }
      else if (data[k] !== undefined && data[k] !== null && data[k] !== "") body[k] = data[k];
    });
    if (!editing) {
      if (fixedLead) body.lead_id = fixedLead;
      else if (fixedClient) body.client_id = fixedClient;
      else if (picked) body[linkType === "lead" ? "lead_id" : "client_id"] = picked.id;
    }
    if (editing && !Object.keys(body).length) { onClose(); return; }
    save.mutate(body);
  };

  const users = (meta?.users || []).map((u) => ({ value: u.id, label: u.name }));
  const projects = (meta?.projects || []).map((p) => ({ value: p.id, label: p.name }));
  const num = (v: string) => (v === "" ? null : Number(v));
  const quick: [string, string][] = [["In 2 hrs", inHours(2)], ["Tomorrow 11 AM", tomorrowAt(11)], ["Tomorrow 4 PM", tomorrowAt(16)],
    ["In 3 days", toLocalInput(addDays(new Date(fromLocalInput(tomorrowAt(11))!), 2).toISOString())]];

  return (
    <Modal open onClose={onClose} size="lg" title={`${editing ? "Edit" : "Schedule"} ${K.noun.toLowerCase()}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={submit}>{editing ? "Save changes" : `Schedule ${K.noun.toLowerCase()}`}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Lead / client" required className="sm:col-span-2" error={err.record}>
          {fixedLead || fixedClient ? (
            <div className="rounded-lg border border-border bg-slate-50 px-3 py-2">
              {linked ? <RecordLabel r={linked} /> : <span className="text-xs text-muted">{fixedLead ? `Lead #${fixedLead}` : `Client #${fixedClient}`}</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                {(["lead", "client"] as const).filter((t) => can(t === "lead" ? "leads" : "clients")).map((t) => (
                  <button key={t} type="button" onClick={() => { setLinkType(t); setPicked(null); }}
                    className={cn("rounded-md px-3 py-1 capitalize", linkType === t ? "bg-white text-primary shadow-sm" : "text-slate-500")}>{t}</button>
                ))}
              </div>
              <RecordPicker key={linkType} kind={linkType} value={picked} onChange={setPicked} />
            </div>
          )}
        </Field>
        {kind === "meeting" && (
          <>
            <Field label="Title" required className="sm:col-span-2" error={err.title}>
              <Input value={f.title ?? ""} placeholder="e.g. Price negotiation with family" onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="Mode">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium">
                {["offline", "online"].map((m) => (
                  <button key={m} type="button" onClick={() => set("mode", m)}
                    className={cn("rounded-md px-4 py-1.5 capitalize", f.mode === m ? "bg-white text-primary shadow-sm" : "text-slate-500")}>{m}</button>
                ))}
              </div>
            </Field>
            <Field label="Purpose">
              <Select value={f.purpose ?? ""} placeholder="Select…" options={lookup("meeting_type").map((l) => ({ value: l.value, label: l.name }))}
                onChange={(e) => set("purpose", e.target.value || null)} />
            </Field>
          </>
        )}
        <Field label="Date & time" required error={err.scheduled_at} className="sm:col-span-2"
          hint={<span className="flex flex-wrap gap-1.5">{quick.map(([l, v]) => (
            <button key={l} type="button" className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-primary-soft hover:text-primary"
              onClick={() => set("scheduled_at", fromLocalInput(v))}>{l}</button>))}</span>}>
          <Input type="datetime-local" value={toLocalInput(f.scheduled_at)} onChange={(e) => set("scheduled_at", fromLocalInput(e.target.value))} />
        </Field>
        <Field label="Project">
          <Select value={projectVal ?? ""} placeholder="—" options={projects}
            onChange={(e) => setF((o) => ({ ...o, project_id: num(e.target.value), property_id: null }))} />
        </Field>
        {kind === "visit" ? (
          <Field label="Property / unit">
            <Select value={f.property_id ?? ""} placeholder={projectVal ? "Any unit" : "Pick a project first"} disabled={!projectVal}
              options={(propsQ.data?.items || []).map((p) => ({ value: p.id, label: [p.code, p.unit_no, p.property_type, p.availability].filter(Boolean).join(" · ") }))}
              onChange={(e) => set("property_id", num(e.target.value))} />
          </Field>
        ) : (
          <Field label="Duration">
            <Select value={f.duration_minutes ?? 30} options={[15, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: `${m} min` }))}
              onChange={(e) => set("duration_minutes", Number(e.target.value))} />
          </Field>
        )}
        <Field label={K.ownerLabel}>
          <Select value={f[K.owner] ?? ""} placeholder={editing ? "—" : "Lead's agent (default)"} options={users}
            onChange={(e) => set(K.owner, num(e.target.value))} />
        </Field>
        <Field label="Reminder">
          <Select value={f.reminder_minutes ?? K.reminder} options={REMINDERS} onChange={(e) => set("reminder_minutes", Number(e.target.value))} />
        </Field>
        {kind === "meeting" && f.mode === "online" ? (
          <Field label="Meeting link" className="sm:col-span-2">
            <Input type="url" value={f.meeting_link ?? ""} placeholder="https://meet.google.com/…" onChange={(e) => set("meeting_link", e.target.value)} />
          </Field>
        ) : (
          <Field label="Location" className={kind === "meeting" ? "sm:col-span-2" : ""} hint={kind === "visit" ? "Defaults to the project address" : undefined}>
            <Input value={f.location ?? ""} onChange={(e) => set("location", e.target.value)} />
          </Field>
        )}
        {kind === "visit" && (
          <Field label="Map link">
            <Input type="url" value={f.map_link ?? ""} placeholder="https://maps.google.com/…" onChange={(e) => set("map_link", e.target.value)} />
          </Field>
        )}
        <Field label="Attendees" className="sm:col-span-2">
          <Input value={f.attendees ?? ""} placeholder="e.g. Client + spouse, Site manager" onChange={(e) => set("attendees", e.target.value)} />
        </Field>
        {kind === "meeting" && (
          <Field label="Next action" className="sm:col-span-2">
            <Input value={f.next_action ?? ""} onChange={(e) => set("next_action", e.target.value)} />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// ── Reschedule / outcome modals ────────────────────────────────────────────────
function RescheduleModal({ kind, row, onClose }: { kind: ApptKind; row: Row; onClose: () => void }) {
  const K = KINDS[kind];
  const qc = useQueryClient();
  const [when, setWhen] = useState(toLocalInput(row.scheduled_at));
  const m = useMutation({
    mutationFn: () => api.patch(`${K.endpoint}/${row.id}`, { scheduled_at: fromLocalInput(when), status: "Rescheduled" }),
    onSuccess: () => { toast.success(`${K.noun} rescheduled`); invalidateSchedules(qc); onClose(); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title={`Reschedule ${K.noun.toLowerCase()}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!when} onClick={() => m.mutate()}>Reschedule</Button></>}>
      <p className="mb-3 text-sm text-slate-600">{row.contact_name || row.title} · currently {fmtDateTime(row.scheduled_at)}</p>
      <Field label="New date & time" hint={<span className="flex flex-wrap gap-1.5">{[["Tomorrow 11 AM", tomorrowAt(11)], ["Tomorrow 4 PM", tomorrowAt(16)]].map(([l, v]) => (
        <button key={l} type="button" className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] hover:bg-primary-soft" onClick={() => setWhen(v)}>{l}</button>))}</span>}>
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
    </Modal>
  );
}

const OUTCOMES = {
  visit: ["Interested", "Liked the property", "Needs family discussion", "Price concern", "Not interested", "Booking initiated"],
  meeting: ["Positive", "Negotiation ongoing", "Documents pending", "Deal closed", "Not interested", "Follow-up required"],
};

function OutcomeModal({ kind, row, onClose }: { kind: ApptKind; row: Row; onClose: () => void }) {
  const K = KINDS[kind];
  const qc = useQueryClient();
  const [f, setF] = useState<Row>({ status: "Completed", outcome: row.outcome || "", notes: row.notes || "", next_action: row.next_action || "", next_followup_at: "" });
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const m = useMutation({
    mutationFn: () => api.post(`${K.endpoint}/${row.id}/outcome`, {
      status: f.status, outcome: f.outcome || null, notes: f.notes || null, next_action: f.next_action || null,
      next_followup_at: fromLocalInput(f.next_followup_at),
    }),
    onSuccess: () => { toast.success("Outcome recorded"); invalidateSchedules(qc); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="Record outcome"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save outcome</Button></>}>
      <p className="mb-4 text-sm text-slate-600">{row.title ? `${row.title} · ` : ""}{row.contact_name} · {fmtDateTime(row.scheduled_at)}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status">
          <Select value={f.status} options={APPT_STATUSES.map((s) => ({ value: s, label: s }))} onChange={(e) => set("status", e.target.value)} />
        </Field>
        <Field label="Outcome">
          <Input list={`outcomes-${kind}`} value={f.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="Type or pick…" />
          <datalist id={`outcomes-${kind}`}>{OUTCOMES[kind].map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Field label="Next follow-up (optional)" hint={<span className="flex flex-wrap gap-1.5">{[["Tomorrow 11 AM", tomorrowAt(11)], ["In 2 hrs", inHours(2)]].map(([l, v]) => (
          <button key={l} type="button" className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] hover:bg-primary-soft" onClick={() => set("next_followup_at", v)}>{l}</button>))}</span>}>
          <Input type="datetime-local" value={f.next_followup_at} onChange={(e) => set("next_followup_at", e.target.value)} />
        </Field>
        <Field label="Next action">
          <Input value={f.next_action} placeholder="e.g. Send revised price sheet" onChange={(e) => set("next_action", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Shared action plumbing (list rows, calendar chips, client profile) ─────────
type ActState = { type: "reschedule" | "outcome" | "edit" | "view"; row: Row } | null;

export function useApptActions(kind: ApptKind) {
  const K = KINDS[kind];
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [act, setAct] = useState<ActState>(null);
  const canEdit = can(K.module, "edit");
  const cancel = async (row: Row) => {
    if (!(await confirm({ title: `Cancel this ${K.noun.toLowerCase()}?`, message: `${row.contact_name || row.title || ""} · ${fmtDateTime(row.scheduled_at)}`, confirmText: "Cancel it" }))) return;
    try { await api.patch(`${K.endpoint}/${row.id}`, { status: "Cancelled" }); toast.success(`${K.noun} cancelled`); invalidateSchedules(qc); }
    catch (e) { toast.error((e as Error).message); }
  };
  const close = () => setAct(null);
  const closed = (r: Row) => r.status === "Completed" || r.status === "Cancelled";
  const buttons = (r: Row) => canEdit ? (
    <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {!closed(r) && <IconButton title="Reschedule" tone="amber" onClick={() => setAct({ type: "reschedule", row: r })}><CalendarClock className="h-4 w-4" /></IconButton>}
      <IconButton title="Record outcome" tone="green" onClick={() => setAct({ type: "outcome", row: r })}><CheckCircle2 className="h-4 w-4" /></IconButton>
      {!closed(r) && <IconButton title="Cancel" tone="red" onClick={() => cancel(r)}><XCircle className="h-4 w-4" /></IconButton>}
      <IconButton title="Edit" onClick={() => setAct({ type: "edit", row: r })}><Pencil className="h-3.5 w-3.5" /></IconButton>
    </div>
  ) : null;
  const modals = (
    <>
      {act?.type === "reschedule" && <RescheduleModal kind={kind} row={act.row} onClose={close} />}
      {act?.type === "outcome" && <OutcomeModal kind={kind} row={act.row} onClose={close} />}
      {act?.type === "edit" && <AppointmentForm kind={kind} open initial={act.row} onClose={close} />}
      {act?.type === "view" && <ApptDetailModal kind={kind} row={act.row} onClose={close} footer={buttons(act.row)} />}
    </>
  );
  return { buttons, modals, view: (row: Row) => setAct({ type: "view", row }), setAct };
}

function ApptDetailModal({ kind, row, onClose, footer }: { kind: ApptKind; row: Row; onClose: () => void; footer: ReactNode }) {
  const K = KINDS[kind];
  return (
    <Modal open onClose={onClose} title={row.title || `${K.noun} – ${row.contact_name || ""}`} footer={footer}>
      <KeyValue items={[
        ["When", fmtDateTime(row.scheduled_at)], ["Status", <StatusPill key="s" value={row.status} />],
        ["Contact", <ContactCell key="c" r={row} />], ["Project", row.project_name],
        [K.ownerLabel, row[K.ownerName]], ...(kind === "meeting" ? [["Mode", row.mode] as [ReactNode, ReactNode], ["Duration", `${row.duration_minutes} min`] as [ReactNode, ReactNode]] : []),
        ["Location", row.location], ["Attendees", row.attendees], ["Outcome", row.outcome],
        ...(kind === "meeting" ? [["Next action", row.next_action] as [ReactNode, ReactNode]] : []),
        ["Notes", row.notes],
      ]} />
      <div className="mt-4 flex flex-wrap gap-2"><MapOrJoin r={row} labelled /></div>
    </Modal>
  );
}

function ContactCell({ r }: { r: Row }) {
  if (!r.lead_id && !r.client_id) return <span className="text-slate-300">—</span>;
  return (
    <div className="min-w-0">
      <RowLink href={r.lead_id ? `/leads/${r.lead_id}` : `/clients/${r.client_id}`}>{r.contact_name || r.contact_code}</RowLink>
      <div className="text-xs text-muted">
        {r.contact_mobile && <a href={`tel:${r.contact_mobile}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary">{r.contact_mobile}</a>}
        {r.client_id && !r.lead_id && <Badge tone="green" className="ml-1">Client</Badge>}
      </div>
    </div>
  );
}

function MapOrJoin({ r, labelled }: { r: Row; labelled?: boolean }) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <>
      {r.meeting_link && r.mode === "online" && (
        <a href={r.meeting_link} target="_blank" rel="noreferrer" onClick={stop}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white hover:bg-emerald-700">
          <Video className="h-3.5 w-3.5" />Join
        </a>
      )}
      {r.map_link && (
        <a href={r.map_link} target="_blank" rel="noreferrer" onClick={stop} title="Open map"
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-blue-600 hover:bg-blue-50">
          <MapPin className="h-4 w-4" />{labelled && "Open map"}
        </a>
      )}
    </>
  );
}

// ── Week calendar ──────────────────────────────────────────────────────────────
function WeekCalendar({ kind, weekStart, items, loading, onPick }:
  { kind: ApptKind; weekStart: Date; items: Row[]; loading: boolean; onPick: (r: Row) => void }) {
  const [today] = useState(() => new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  if (loading && !items.length) return <Loading />;
  return (
    <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-7 sm:divide-x sm:divide-y-0">
      {days.map((d) => {
        const list = items.filter((r) => isSameDay(new Date(r.scheduled_at), d))
          .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
        const isToday = isSameDay(d, today);
        return (
          <div key={d.toISOString()} className="min-h-[140px] p-2">
            <div className={cn("mb-2 flex items-baseline justify-between text-xs font-medium", isToday ? "text-primary" : "text-slate-500")}>
              <span>{format(d, "EEE")}</span>
              <span className={cn("rounded-full px-1.5 text-sm", isToday && "bg-primary text-white")}>{format(d, "d MMM")}</span>
            </div>
            <div className="space-y-1.5">
              {list.map((r) => (
                <button key={r.id} type="button" onClick={() => onPick(r)}
                  className={cn("block w-full rounded-md border border-border border-l-4 bg-white px-2 py-1.5 text-left text-xs shadow-sm hover:bg-slate-50",
                    STATUS_DOT[r.status] || "border-l-slate-400", r.status === "Cancelled" && "opacity-60 line-through")}>
                  <span className="block font-semibold text-slate-800">{format(new Date(r.scheduled_at), "h:mm a")}</span>
                  <span className="block truncate text-slate-700">{kind === "meeting" ? r.title : r.contact_name}</span>
                  <span className="block truncate text-[11px] text-muted">{kind === "meeting" ? r.contact_name : r.project_name}</span>
                </button>
              ))}
              {!list.length && <p className="hidden py-4 text-center text-[11px] text-slate-300 sm:block">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Full page (visits / meetings) ──────────────────────────────────────────────
export function AppointmentsPage({ kind }: { kind: ApptKind }) {
  const K = KINDS[kind];
  const { can, meta } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const canAdd = can(K.module, "add");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [mode, setMode] = useState("");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [project, setProject] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("-scheduled_at");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const urlLead = Number(sp.get("lead_id")) || undefined;
  const urlClient = Number(sp.get("client_id")) || undefined;
  const urlNew = sp.get("new") === "1" || !!urlLead || !!urlClient;
  const closeCreate = () => { setCreating(false); if (urlNew) router.replace(pathname); };

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const base = { q: dq, status, [K.owner]: owner, project_id: project, mode: kind === "meeting" ? mode : undefined };
  const listParams = {
    ...base, page, page_size: pageSize, sort: todayOnly ? "scheduled_at" : sort,
    scheduled_at__gte: dayStartISO(todayOnly ? todayStr : from), scheduled_at__lte: dayEndISO(todayOnly ? todayStr : to),
  };
  const calParams = {
    ...base, page_size: 500, sort: "scheduled_at",
    scheduled_at__gte: weekStart.toISOString(), scheduled_at__lte: addDays(weekStart, 7).toISOString(),
  };
  const list = useList(K.endpoint, listParams, view === "list");
  const cal = useList(K.endpoint, calParams, view === "calendar");
  const acts = useApptActions(kind);

  const columns: Column[] = [
    { key: "scheduled_at", label: "When", sortable: true, render: (r) => (
      <div><div className="font-medium text-slate-800">{fmtDateTime(r.scheduled_at)}</div><div className="text-xs text-muted">{fromNow(r.scheduled_at)}</div></div>) },
    ...(kind === "meeting" ? [{ key: "title", label: "Meeting", render: (r: Row) => (
      <div className="max-w-[240px]"><div className="truncate font-medium text-slate-800">{r.title}</div>
        <div className="truncate text-xs text-muted">{[r.purpose, `${r.duration_minutes} min`].filter(Boolean).join(" · ")}</div></div>) }] : []),
    { key: "contact", label: "Contact", render: (r) => <ContactCell r={r} /> },
    { key: "project_name", label: "Project" },
    ...(kind === "meeting" ? [{ key: "mode", label: "Mode", render: (r: Row) => <Badge tone={r.mode === "online" ? "blue" : "slate"}>{r.mode === "online" ? "Online" : "Offline"}</Badge> }] : []),
    { key: K.ownerName, label: K.ownerLabel },
    { key: "status", label: "Status", sortable: true, render: (r) => <StatusPill value={r.status} /> },
    { key: "outcome", label: "Outcome", render: (r) => r.outcome ? <span className="block max-w-[180px] truncate" title={r.outcome}>{r.outcome}</span> : <span className="text-slate-300">—</span> },
    { key: "_links", label: "", render: (r) => <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}><MapOrJoin r={r} /></div> },
    { key: "_actions", label: "", className: "text-right", render: (r) => acts.buttons(r) },
  ];

  const filtersActive = !!(status || owner || project || from || to || dq || todayOnly);
  const reset = () => { setStatus(""); setOwner(""); setProject(""); setFrom(""); setTo(""); setQ(""); setTodayOnly(false); setPage(1); };

  return (
    <div>
      <PageHeader title={K.plural} subtitle={kind === "visit" ? "Schedule, track and close the loop on property site visits" : "Offline and online client meetings"}
        actions={<>
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
            {([["list", <List key="l" className="h-4 w-4" />, "List"], ["calendar", <CalendarDays key="c" className="h-4 w-4" />, "Week"]] as const).map(([v, icon, label]) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium [@media(pointer:coarse)]:py-2.5", view === v ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50")}>
                {icon}{label}
              </button>
            ))}
          </div>
          {canAdd && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Schedule {K.noun.toLowerCase()}</Button>}
        </>} />
      <div className="card">
        {kind === "meeting" && (
          <Tabs className="px-3" value={mode} onChange={(v) => { setMode(v); setPage(1); }}
            tabs={[{ value: "", label: "All" }, { value: "offline", label: "Offline" }, { value: "online", label: "Online" }]} />
        )}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder={kind === "visit" ? "Search location, notes, outcome…" : "Search title, purpose, notes…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {view === "list" && (
            <Button size="sm" variant={todayOnly ? "primary" : "outline"} onClick={() => { setTodayOnly(!todayOnly); setPage(1); }}>Today</Button>
          )}
          <Select className="w-auto min-w-[130px]" value={status} placeholder="All statuses" options={APPT_STATUSES.map((s) => ({ value: s, label: s }))}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
          <Select className="w-auto min-w-[130px]" value={owner} placeholder={`All ${K.ownerLabel.toLowerCase()}s`} options={(meta?.users || []).map((u) => ({ value: u.id, label: u.name }))}
            onChange={(e) => { setOwner(e.target.value); setPage(1); }} />
          <Select className="w-auto min-w-[130px]" value={project} placeholder="All projects" options={(meta?.projects || []).map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => { setProject(e.target.value); setPage(1); }} />
          {view === "list" && !todayOnly && (
            <div className="flex w-full items-center gap-1 sm:w-auto text-xs text-muted">
              <Input type="date" className="w-auto" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
              <span>to</span>
              <Input type="date" className="w-auto" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
            </div>
          )}
          {filtersActive && <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>}
        </div>
        {view === "list" ? (
          <>
            <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort}
              onRowClick={acts.view}
              empty={<Empty icon={kind === "visit" ? <MapPin className="h-6 w-6" /> : <CalendarDays className="h-6 w-6" />}
                title={`No ${K.plural.toLowerCase()} found`} text={filtersActive ? "Try clearing the filters." : undefined}
                action={canAdd ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Schedule {K.noun.toLowerCase()}</Button> : undefined} />} />
            {list.data && list.data.total > 0 && (
              <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-1">
                <IconButton title="Previous week" onClick={() => setWeekStart(addWeeks(weekStart, -1))}><ChevronLeft className="h-4 w-4" /></IconButton>
                <IconButton title="Next week" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="h-4 w-4" /></IconButton>
                <Button size="xs" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
              </div>
              <span className="text-sm font-medium text-slate-700">{format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}</span>
              <span className="text-xs text-muted">{cal.data?.total ?? 0} {K.plural.toLowerCase()}</span>
            </div>
            <WeekCalendar kind={kind} weekStart={weekStart} items={cal.data?.items || []} loading={cal.isFetching} onPick={acts.view} />
          </>
        )}
      </div>
      {acts.modals}
      {(creating || (urlNew && canAdd)) && (
        <AppointmentForm kind={kind} open leadId={urlLead} clientId={urlLead ? undefined : urlClient} onClose={closeCreate} />
      )}
    </div>
  );
}
