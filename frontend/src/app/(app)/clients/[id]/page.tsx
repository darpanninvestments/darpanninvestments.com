"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, CalendarCheck, Check, CheckCircle2, ClipboardCheck, Copy, Download, Eye, FileText, Link2, Mail,
  MapPin, MessageCircle, MessageSquare, Pencil, Phone, Pin, PinOff, Plus, RefreshCw, Send, Settings2, Trash2, Upload,
  UserCheck, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, fromLocalInput, fromNow, humanize, money, toLocalInput, tomorrowAt, waLink } from "@/lib/utils";
import {
  Avatar, Badge, Button, Card, Empty, Field, IconButton, Input, KeyValue, Loading, Modal, Select, StatusPill, Tabs,
  Textarea, Toggle, useConfirm,
} from "@/components/ui";
import { CLIENT_STAGES, ClientFormModal, ProgressBar } from "@/components/clients";
import { ScheduleMeetingModal, ScheduleVisitModal, useApptActions } from "@/components/scheduling";

type Detail = Row & { documents: Row[]; visits: Row[]; meetings: Row[]; followups: Row[]; timeline: Row[]; submissions: Row[]; lead: Row | null };

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, lookup } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const key = ["client-detail", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Detail>(`/api/clients/${id}/detail`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["client-detail"] });
  const stageM = useMutation({
    mutationFn: (stage: string) => api.post(`/api/clients/${id}/stage`, { stage }),
    onSuccess: () => { toast.success("Stage updated"); refresh(); qc.invalidateQueries({ queryKey: ["/api/clients"] }); },
  });

  if (q.isLoading) return <Loading />;
  const c = q.data;
  if (!c) return <Empty title="Client not found" text={(q.error as Error)?.message} action={<Link href="/clients" className="text-sm text-primary">Back to clients</Link>} />;

  const canEdit = can("clients", "edit");
  const stages = lookup("client_stage").map((l) => l.value);
  const steps = stages.length ? stages : CLIENT_STAGES;
  const stageIdx = steps.indexOf(c.stage);
  const changeStage = async (s: string) => {
    if (s === c.stage) return;
    if (await confirm({ title: "Change client stage?", message: <>Move from <b>{c.stage}</b> to <b>{s}</b>.</>, confirmText: "Change stage", danger: false })) stageM.mutate(s);
  };
  const pendingFu = c.followups.filter((f) => f.status === "pending").length;

  return (
    <div className="space-y-4">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" />Clients</Link>
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={c.name} size={48} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold text-slate-900">{c.name}</h1>
                <StatusPill value={c.stage} />
              </div>
              <p className="text-sm text-muted">{[c.code, c.project_name, c.property_code, c.assigned_to_name && `Agent: ${c.assigned_to_name}`].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`tel:${c.mobile}`}><Button size="sm" variant="outline" icon={<Phone className="h-4 w-4 text-blue-600" />}>Call</Button></a>
            <a href={waLink(c.mobile, `Hello ${c.name}, `)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>WhatsApp</Button></a>
            {c.email && <a href={`mailto:${c.email}`}><Button size="sm" variant="outline" icon={<Mail className="h-4 w-4 text-violet-600" />}>Email</Button></a>}
            {canEdit && (
              <Select className="h-8 w-auto py-0 text-xs" value={c.stage} options={steps.map((s) => ({ value: s, label: s }))}
                disabled={stageM.isPending} onChange={(e) => changeStage(e.target.value)} aria-label="Stage" />
            )}
            {canEdit && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        </div>
        <ol className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
          {steps.map((s, i) => {
            const done = i < stageIdx, cur = i === stageIdx;
            return (
              <li key={s} className="flex flex-1 items-center gap-2">
                <button type="button" disabled={!canEdit || cur} onClick={() => changeStage(s)}
                  className={cn("flex shrink-0 items-center gap-2 text-left text-xs font-medium", canEdit && !cur && "hover:opacity-80")}>
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs",
                    done ? "border-emerald-500 bg-emerald-500 text-white" : cur ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-400")}>
                    {done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn(cur ? "text-primary" : done ? "text-slate-700" : "text-slate-400")}>{s}</span>
                </button>
                {i < steps.length - 1 && <span className={cn("mx-2 hidden h-0.5 flex-1 rounded sm:block", i < stageIdx ? "bg-emerald-400" : "bg-slate-200")} />}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Documents" value={`${c.document_completion}%`} sub={`${c.documents_done}/${c.documents_total} complete`}>
          <ProgressBar value={c.document_completion} className="mt-2" />
        </MiniStat>
        <MiniStat label="Deal value" value={c.deal_value_masked ? "•••" : money(c.deal_value)} sub={c.booking_date ? `Booked ${fmtDate(c.booking_date)}` : "No booking date"} />
        <MiniStat label="Visits / meetings" value={`${c.visits.length} / ${c.meetings.length}`} sub="Linked to this client" />
        <MiniStat label="Pending follow-ups" value={pendingFu} sub={`${c.followups.length} total`} />
      </div>

      <div className="card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[
          { value: "overview", label: "Overview" },
          { value: "documents", label: "Documents", count: c.documents.length },
          { value: "onboarding", label: "Onboarding", count: c.submissions.length || undefined },
          { value: "timeline", label: "Timeline", count: c.timeline.length },
          { value: "schedule", label: "Visits & Meetings", count: c.visits.length + c.meetings.length },
          { value: "followups", label: "Follow-ups", count: pendingFu || undefined },
        ]} />
        <div className="p-4">
          {tab === "overview" && <Overview c={c} />}
          {tab === "documents" && <Documents c={c} refresh={refresh} />}
          {tab === "onboarding" && <Onboarding c={c} refresh={refresh} />}
          {tab === "timeline" && <Timeline c={c} refresh={refresh} />}
          {tab === "schedule" && <Schedule c={c} />}
          {tab === "followups" && <FollowUps c={c} refresh={refresh} />}
        </div>
      </div>
      {editing && <ClientFormModal initial={c} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MiniStat({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
      {children}
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────────
function Overview({ c }: { c: Detail }) {
  const masked = (v: ReactNode) => (c.deal_value_masked ? <span className="tracking-widest text-slate-400">•••</span> : v);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Contact">
        <KeyValue items={[
          ["Name", c.name], ["Code", c.code],
          ["Mobile", <a key="m" href={`tel:${c.mobile}`} className="text-primary hover:underline">{c.mobile}</a>],
          ["Alternate mobile", c.alt_mobile],
          ["Email", c.email ? <a key="e" href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a> : null],
          ["City", c.city], ["Address", c.address], ["Company", c.company_name],
        ]} />
      </Card>
      <Card title="Booking">
        <KeyValue items={[
          ["Project", c.project_name], ["Property / unit", c.property_code], ["Booking date", c.booking_date ? fmtDate(c.booking_date) : null],
          ["Stage", <StatusPill key="s" value={c.stage} />], ["Assigned agent", c.assigned_to_name], ["Source", c.source_name],
          ["Referral", c.referral], ["Client since", fmtDate(c.created_at)],
        ]} />
      </Card>
      <Card title="Commercials">
        <KeyValue items={[
          ["Deal value", masked(money(c.deal_value, false))], ["Booking amount", masked(money(c.booking_amount, false))],
          ["Payment plan", masked(c.payment_plan || "—")],
        ]} />
        {c.deal_value_masked && <p className="mt-3 text-xs text-muted">Commercial details are hidden for your role.</p>}
      </Card>
      <Card title="Origin & notes">
        <KeyValue cols={1} items={[
          ["Original lead", c.lead_id ? (
            <Link key="l" href={`/leads/${c.lead_id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <Link2 className="h-3.5 w-3.5" />{c.lead ? `${c.lead.code} – ${c.lead.name}` : `Lead #${c.lead_id}`}
            </Link>) : "Created directly as a client"],
          ["Notes", c.notes ? <span key="n" className="whitespace-pre-wrap">{c.notes}</span> : null],
        ]} />
      </Card>
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────────
function Documents({ c, refresh }: { c: Detail; refresh: () => void }) {
  const { can, lookup } = useAuth();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState<"" | "item" | "upload">("");
  const canAdd = can("documents", "add"), canEdit = can("documents", "edit");
  const categories = lookup("document_category").map((l) => ({ value: l.value, label: l.name }));

  const upload = async (file: File, fillId: number) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("fill_id", String(fillId));
    setBusy(fillId);
    try { await api.upload("/api/documents", fd); toast.success("Document uploaded"); refresh(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  const setStatus = async (d: Row, status: string) => {
    try { await api.patch(`/api/documents/${d.id}`, { status }); toast.success(`${d.title}: ${status}`); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (d: Row) => {
    if (!(await confirm({ title: "Delete document?", message: <>“{d.title}” will be removed.</> }))) return;
    try { await api.del(`/api/documents/${d.id}`); toast.success("Deleted"); refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  const pick = (id: number) => { target.current = id; fileRef.current?.click(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[220px] flex-1 sm:max-w-sm">
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Checklist completion</span><span>{c.documents_done}/{c.documents_total} · {c.document_completion}%</span></div>
          <ProgressBar value={c.document_completion} />
        </div>
        {canAdd && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setAdding("item")}>Add checklist item</Button>
            <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setAdding("upload")}>Upload document</Button>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f && target.current) upload(f, target.current);
        e.target.value = "";
      }} />
      {!c.documents.length ? <Empty icon={<FileText className="h-6 w-6" />} title="No documents yet" text="Add checklist items or upload documents for this client." /> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {c.documents.map((d) => {
            const hasFile = !!(d.file_name || d.storage_path);
            const file = `/api/documents/${d.id}/file`;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  d.status === "Verified" ? "bg-emerald-50 text-emerald-600" : d.status === "Rejected" ? "bg-red-50 text-red-600" : hasFile ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400")}>
                  {d.status === "Verified" ? <CheckCircle2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{d.title}</span>
                    <StatusPill value={d.status} />
                    {d.version > 1 && <Badge>v{d.version}</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {[d.category, hasFile ? d.file_name : "Awaiting upload", d.size_bytes ? `${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : null,
                      hasFile ? `Updated ${fromNow(d.updated_at)}` : null, d.expires_at ? `Expires ${fmtDate(d.expires_at)}` : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  {canAdd && (!hasFile || d.status === "Rejected") && (
                    <Button size="xs" variant={hasFile ? "outline" : "primary"} loading={busy === d.id} icon={<Upload className="h-3.5 w-3.5" />} onClick={() => pick(d.id)}>
                      {hasFile ? "Re-upload" : "Upload"}
                    </Button>
                  )}
                  {hasFile && (
                    <a href={`${file}?inline=1`} target="_blank" rel="noreferrer" title="Preview" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                      <Eye className="h-4 w-4" />
                    </a>
                  )}
                  {hasFile && can("documents", "download") && (
                    <a href={file} download title="Download" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                  {hasFile && canEdit && d.status !== "Verified" && (
                    <IconButton title="Mark verified" tone="green" onClick={() => setStatus(d, "Verified")}><CheckCircle2 className="h-4 w-4" /></IconButton>
                  )}
                  {hasFile && canEdit && d.status !== "Rejected" && (
                    <IconButton title="Reject" tone="red" onClick={() => setStatus(d, "Rejected")}><XCircle className="h-4 w-4" /></IconButton>
                  )}
                  {can("documents", "delete") && <IconButton title="Delete" tone="red" onClick={() => remove(d)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <DocModal mode={adding} clientId={c.id} categories={categories} onClose={() => setAdding("")} onDone={refresh} />}
    </div>
  );
}

function DocModal({ mode, clientId, categories, onClose, onDone }:
  { mode: "item" | "upload"; clientId: number; categories: { value: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(mode === "item" ? "KYC" : "General");
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      if (mode === "item") return api.post("/api/documents/checklist", { client_id: clientId, title, category });
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("client_id", String(clientId));
      fd.append("category", category);
      if (title) fd.append("title", title);
      return api.upload("/api/documents", fd);
    },
    onSuccess: () => { toast.success(mode === "item" ? "Checklist item added" : "Document uploaded"); onDone(); onClose(); },
  });
  const ok = mode === "item" ? !!title.trim() : !!file;
  return (
    <Modal open onClose={onClose} size="sm" title={mode === "item" ? "Add checklist item" : "Upload document"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>{mode === "item" ? "Add item" : "Upload"}</Button></>}>
      <div className="space-y-4">
        {mode === "upload" && (
          <Field label="File" required hint="PDF, images, Office documents · max upload size applies">
            <input type="file" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
        )}
        <Field label="Title" required={mode === "item"} hint={mode === "upload" ? "Defaults to the file name" : undefined}>
          <Input value={title} placeholder={mode === "item" ? "e.g. PAN card" : ""} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={category} options={categories.length ? categories : [{ value: "General", label: "General" }]} onChange={(e) => setCategory(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Onboarding ─────────────────────────────────────────────────────────────────
function fmtVal(v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fmtDateTime(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
  return String(v);
}
const kvOf = (o?: Row | null): [ReactNode, ReactNode][] => Object.entries(o || {}).map(([k, v]) => [humanize(k.replace(/^_+/, "")), fmtVal(v)]);

function Onboarding({ c, refresh }: { c: Detail; refresh: () => void }) {
  const { can } = useAuth();
  const [link, setLink] = useState<{ url: string; expires_in_days: number } | null>(null);
  const [correct, setCorrect] = useState<Row | null>(null);
  const gen = useMutation({
    mutationFn: () => api.post<{ url: string; expires_in_days: number }>(`/api/clients/${c.id}/onboarding-link`, {}),
    onSuccess: (r) => { setLink(r); toast.success("Onboarding link generated"); refresh(); },
  });
  const review = useMutation({
    mutationFn: ({ sid, status, note }: { sid: number; status: string; note?: string }) => api.patch(`/api/forms/submissions/${sid}`, { status, note }),
    onSuccess: (_r, v) => { toast.success(v.status === "Reviewed" ? "Marked as reviewed" : "Correction requested"); setCorrect(null); refresh(); },
  });
  const msg = link ? `Hello ${c.name}, welcome to Darpann Investments! Please complete your onboarding form here: ${link.url}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(link!.url); toast.success("Link copied"); } catch { toast.error("Could not copy – select and copy manually"); }
  };
  const data = kvOf(c.onboarding_data);

  return (
    <div className="space-y-4">
      <Card title="Onboarding form link" actions={can("clients", "edit") && (
        <Button size="sm" loading={gen.isPending} icon={link ? <RefreshCw className="h-4 w-4" /> : <Send className="h-4 w-4" />} onClick={() => gen.mutate()}>
          {link ? "Regenerate" : "Generate onboarding link"}
        </Button>)}>
        {link ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={link.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={copy}>Copy</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={waLink(c.mobile, msg)} target="_blank" rel="noreferrer"><Button size="sm" variant="success" icon={<MessageCircle className="h-4 w-4" />}>Share on WhatsApp</Button></a>
              {c.email && (
                <a href={`mailto:${c.email}?subject=${encodeURIComponent("Your onboarding form – Darpann Investments")}&body=${encodeURIComponent(msg)}`}>
                  <Button size="sm" variant="outline" icon={<Mail className="h-4 w-4" />}>Email</Button>
                </a>
              )}
              <span className="text-xs text-muted">Valid for {link.expires_in_days} days</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Generate a secure link the client can use to fill in their onboarding details. Submissions appear below.</p>
        )}
      </Card>
      <Card title="Onboarding data">
        {data.length ? <KeyValue items={data} /> : <p className="text-sm text-muted">No onboarding data captured yet.</p>}
      </Card>
      <Card title={`Form submissions (${c.submissions.length})`} bodyClass="p-0">
        {!c.submissions.length ? <Empty title="No submissions yet" text="The client hasn't submitted the onboarding form." /> : (
          <ul className="divide-y divide-border">
            {c.submissions.map((s) => (
              <li key={s.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-slate-800">Submission #{s.id}</span>
                    <StatusPill value={s.status} />
                    <span className="text-xs text-muted">{fmtDateTime(s.created_at)}</span>
                  </div>
                  {can("forms", "edit") && (
                    <div className="flex gap-2">
                      {s.status !== "Reviewed" && (
                        <Button size="xs" variant="success" icon={<UserCheck className="h-3.5 w-3.5" />} loading={review.isPending && review.variables?.sid === s.id}
                          onClick={() => review.mutate({ sid: s.id, status: "Reviewed" })}>Mark reviewed</Button>
                      )}
                      <Button size="xs" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setCorrect(s)}>Request correction</Button>
                    </div>
                  )}
                </div>
                <div className="rounded-lg bg-slate-50 p-3"><KeyValue items={kvOf(s.data)} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {correct && <CorrectionModal onClose={() => setCorrect(null)} saving={review.isPending}
        onSave={(note) => review.mutate({ sid: correct.id, status: "Correction Requested", note })} />}
    </div>
  );
}

function CorrectionModal({ onClose, onSave, saving }: { onClose: () => void; onSave: (note: string) => void; saving: boolean }) {
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} size="sm" title="Request correction"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={() => onSave(note)}>Request correction</Button></>}>
      <Field label="What needs to be corrected?" hint="Shown on the client's timeline. Share a fresh onboarding link so they can resubmit.">
        <Textarea value={note} rows={4} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────────
const ACT_ICON: Record<string, [ReactNode, string]> = {
  call: [<Phone key="i" className="h-4 w-4" />, "bg-blue-50 text-blue-600"],
  whatsapp: [<MessageCircle key="i" className="h-4 w-4" />, "bg-emerald-50 text-emerald-600"],
  sms: [<MessageSquare key="i" className="h-4 w-4" />, "bg-sky-50 text-sky-600"],
  email: [<Mail key="i" className="h-4 w-4" />, "bg-violet-50 text-violet-600"],
  note: [<Pencil key="i" className="h-4 w-4" />, "bg-amber-50 text-amber-600"],
  followup: [<Calendar key="i" className="h-4 w-4" />, "bg-orange-50 text-orange-600"],
  visit: [<MapPin key="i" className="h-4 w-4" />, "bg-teal-50 text-teal-600"],
  meeting: [<CalendarCheck key="i" className="h-4 w-4" />, "bg-indigo-50 text-indigo-600"],
  document: [<FileText key="i" className="h-4 w-4" />, "bg-slate-100 text-slate-600"],
  conversion: [<CheckCircle2 key="i" className="h-4 w-4" />, "bg-emerald-50 text-emerald-600"],
  status: [<RefreshCw key="i" className="h-4 w-4" />, "bg-pink-50 text-pink-600"],
};

function Timeline({ c, refresh }: { c: Detail; refresh: () => void }) {
  const [type, setType] = useState("note");
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(true);
  const [filter, setFilter] = useState("");
  const add = useMutation({
    mutationFn: () => api.post(`/api/clients/${c.id}/note`, { type, description: text, is_internal: internal }),
    onSuccess: () => { toast.success("Added to timeline"); setText(""); refresh(); },
  });
  const pin = useMutation({
    mutationFn: (a: Row) => api.patch(`/api/activities/${a.id}`, { is_pinned: !a.is_pinned }),
    onSuccess: (_r, a) => { toast.success(a.is_pinned ? "Unpinned" : "Pinned"); refresh(); },
  });
  const items = c.timeline.filter((a) => !filter || (filter === "internal" ? a.is_internal : !a.is_internal));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {["note", "call", "whatsapp", "sms", "email"].map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-medium", type === t ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {t === "sms" ? "SMS" : t === "whatsapp" ? "WhatsApp" : humanize(t)}
            </button>
          ))}
        </div>
        <Textarea value={text} placeholder={type === "note" ? "Add a note…" : `Summary of the ${type === "sms" ? "SMS" : type}…`} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toggle checked={internal} onChange={setInternal} label={<span className="text-xs text-slate-600">{internal ? "Internal only" : "Client-facing"}</span>} />
          <Button size="sm" disabled={!text.trim()} loading={add.isPending} icon={<Plus className="h-4 w-4" />} onClick={() => add.mutate()}>Add</Button>
        </div>
      </div>
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: "", label: "All" }, { value: "internal", label: "Internal" }, { value: "client", label: "Client-facing" }]} />
      {!items.length ? <Empty title="No activity yet" /> : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {items.map((a) => {
            const [icon, tone] = ACT_ICON[a.type] || [<Settings2 key="i" className="h-4 w-4" />, "bg-slate-100 text-slate-500"];
            return (
              <li key={a.id} className={cn("relative rounded-lg p-2", a.is_pinned && "bg-amber-50/60 ring-1 ring-amber-200")}>
                <span className={cn("absolute -left-[34px] top-2 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white", tone)}>{icon}</span>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{a.title}</p>
                    {a.description && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{a.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{a.user_name || "System"}</span>·<span title={fmtDateTime(a.created_at)}>{fromNow(a.created_at)}</span>
                      {a.is_internal ? <Badge>Internal</Badge> : <Badge tone="green">Client-facing</Badge>}
                      {a.lead_id && !a.client_id && <Badge tone="blue">Lead stage</Badge>}
                    </p>
                  </div>
                  <IconButton title={a.is_pinned ? "Unpin" : "Pin"} tone={a.is_pinned ? "amber" : "default"} disabled={pin.isPending} onClick={() => pin.mutate(a)}>
                    {a.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ── Visits & meetings ──────────────────────────────────────────────────────────
function Schedule({ c }: { c: Detail }) {
  const { can, meta } = useAuth();
  const [open, setOpen] = useState<"" | "visit" | "meeting">("");
  const visitActs = useApptActions("visit");
  const meetActs = useApptActions("meeting");
  const users = Object.fromEntries((meta?.users || []).map((u) => [u.id, u.name]));
  const projects = Object.fromEntries((meta?.projects || []).map((p) => [p.id, p.name]));
  const enrich = (r: Row): Row => ({ ...r, contact_name: c.name, contact_mobile: c.mobile, project_name: projects[r.project_id],
    agent_name: users[r.agent_id], host_name: users[r.host_id] });
  const sortDesc = (a: Row, b: Row) => String(b.scheduled_at).localeCompare(String(a.scheduled_at));
  const row = (r: Row, kind: "visit" | "meeting", acts: ReturnType<typeof useApptActions>) => (
    <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 hover:bg-slate-50/70">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => acts.view(r)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-800">{fmtDateTime(r.scheduled_at)}</span>
          <StatusPill value={r.status} />
          {kind === "meeting" && <Badge tone={r.mode === "online" ? "blue" : "slate"}>{r.mode === "online" ? "Online" : "Offline"}</Badge>}
        </div>
        <p className="truncate text-xs text-muted">
          {[kind === "meeting" ? r.title : r.project_name, kind === "visit" ? r.agent_name : r.host_name, r.outcome && `Outcome: ${r.outcome}`].filter(Boolean).join(" · ")}
        </p>
      </button>
      {kind === "meeting" && r.mode === "online" && r.meeting_link && (
        <a href={r.meeting_link} target="_blank" rel="noreferrer"><Button size="xs" variant="success">Join</Button></a>
      )}
      {kind === "visit" && r.map_link && <a href={r.map_link} target="_blank" rel="noreferrer" title="Open map" className="text-blue-600"><MapPin className="h-4 w-4" /></a>}
      {acts.buttons(r)}
    </li>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Site visits (${c.visits.length})`} bodyClass="p-0"
        actions={can("visits", "add") && <Button size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen("visit")}>Schedule visit</Button>}>
        {!c.visits.length ? <Empty title="No site visits" /> : <ul className="divide-y divide-border">{[...c.visits].sort(sortDesc).map((v) => row(enrich(v), "visit", visitActs))}</ul>}
      </Card>
      <Card title={`Meetings (${c.meetings.length})`} bodyClass="p-0"
        actions={can("meetings", "add") && <Button size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen("meeting")}>Schedule meeting</Button>}>
        {!c.meetings.length ? <Empty title="No meetings" /> : <ul className="divide-y divide-border">{[...c.meetings].sort(sortDesc).map((m) => row(enrich(m), "meeting", meetActs))}</ul>}
      </Card>
      {visitActs.modals}
      {meetActs.modals}
      <ScheduleVisitModal open={open === "visit"} onClose={() => setOpen("")} clientId={c.id} projectId={c.project_id ?? undefined} />
      <ScheduleMeetingModal open={open === "meeting"} onClose={() => setOpen("")} clientId={c.id} projectId={c.project_id ?? undefined} />
    </div>
  );
}

// ── Follow-ups ─────────────────────────────────────────────────────────────────
function FollowUps({ c, refresh }: { c: Detail; refresh: () => void }) {
  const { can, meta } = useAuth();
  const [adding, setAdding] = useState(false);
  const users = Object.fromEntries((meta?.users || []).map((u) => [u.id, u.name]));
  const done = useMutation({
    mutationFn: (f: Row) => api.post(`/api/followups/${f.id}/complete`, { outcome: "Completed" }),
    onSuccess: () => { toast.success("Follow-up completed"); refresh(); },
  });
  const [now] = useState(() => Date.now());
  return (
    <div className="space-y-3">
      {can("followups", "add") && (
        <div className="flex justify-end"><Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add follow-up</Button></div>
      )}
      {!c.followups.length ? <Empty icon={<Calendar className="h-6 w-6" />} title="No follow-ups" /> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {c.followups.map((f) => {
            const overdue = f.status === "pending" && new Date(f.due_at).getTime() < now;
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium", overdue ? "text-red-600" : "text-slate-800")}>{fmtDateTime(f.due_at)}</span>
                    <Badge>{humanize(f.type)}</Badge>
                    <StatusPill value={f.status} />
                    {overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted">{[users[f.assigned_to_id], f.outcome, f.notes].filter(Boolean).join(" · ")}</p>
                </div>
                {f.status === "pending" && can("followups", "edit") && (
                  <Button size="xs" variant="outline" icon={<Check className="h-3.5 w-3.5" />} loading={done.isPending && done.variables?.id === f.id} onClick={() => done.mutate(f)}>Done</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <FollowUpModal clientId={c.id} onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

function FollowUpModal({ clientId, onClose, onDone }: { clientId: number; onClose: () => void; onDone: () => void }) {
  const [due, setDue] = useState(tomorrowAt(11));
  const [type, setType] = useState("call");
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/api/followups", { client_id: clientId, due_at: fromLocalInput(due), type, notes: notes || null }),
    onSuccess: () => { toast.success("Follow-up scheduled"); onDone(); onClose(); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title="Add follow-up"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!due} loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="space-y-4">
        <Field label="Due" required><Input type="datetime-local" value={due || toLocalInput(null)} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Type"><Select value={type} options={["call", "whatsapp", "email", "meeting", "visit"].map((t) => ({ value: t, label: humanize(t) }))} onChange={(e) => setType(e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
