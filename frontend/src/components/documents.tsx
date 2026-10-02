"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy, Download, Eye, History, Link2, Mail, MessageCircle, MoreHorizontal, Pencil, Search, Share2, Trash2,
  Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, humanize } from "@/lib/utils";
import {
  Badge, Button, Checkbox, Empty, Field, IconButton, Input, Loading, Menu, MenuItem, Modal, Select, StatusPill,
  Textarea, useConfirm,
} from "./ui";

export const DOC_STATUSES = ["Uploaded", "Pending", "Verified", "Rejected", "Archived"];

export function fileSize(bytes?: number | null): string {
  const n = Number(bytes || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** yyyy-mm-dd (local) → ISO UTC at end of that local day */
function expiryToIso(d: string): string | null {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
function isoToDateInput(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export const previewUrl = (id: number) => `/api/documents/${id}/file?inline=1`;
export async function downloadDocument(doc: Row) {
  try { await api.download(`/api/documents/${doc.id}/file`, undefined, doc.file_name || "document"); }
  catch (e) { toast.error((e as Error).message); }
}

function invalidateDocs(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["/api/documents"] });
  qc.invalidateQueries({ queryKey: ["/api/projects"] });
}

// ── Upload ─────────────────────────────────────────────────────────────────────
type UploadProps = {
  open: boolean; onClose: () => void; projectId?: number; clientId?: number; leadId?: number; onDone?: () => void;
  /** Upload a new version of this document */
  replaceId?: number;
  /** Company of the document being replaced (backend needs it for global admins) */
  companyId?: number;
  defaultCategory?: string;
};

export function DocumentUploadModal(props: UploadProps) {
  if (!props.open) return null;
  return <UploadInner {...props} />;
}

function UploadInner({ onClose, projectId, clientId, leadId, onDone, replaceId, companyId, defaultCategory }: UploadProps) {
  const { meta, me, lookup } = useAuth();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState<string>(projectId ? String(projectId) : "");
  const [company, setCompany] = useState<string>("");
  const [category, setCategory] = useState(defaultCategory || "General");
  const [expiry, setExpiry] = useState("");
  const [sensitive, setSensitive] = useState(!!clientId);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const hasParent = !!(projectId || clientId || leadId);
  const cats = lookup("document_category").map((l) => ({ value: l.value, label: l.name }));
  if (!cats.some((c) => c.value === category)) cats.push({ value: category, label: category });
  const needCompany = !!me?.is_global && !hasParent && !replaceId && !project;

  const submit = async () => {
    if (!files.length) return toast.error("Choose at least one file");
    if (needCompany && !company) return toast.error("Select a company or project");
    setBusy(true);
    let ok = 0;
    try {
      for (const [i, f] of files.entries()) {
        const fd = new FormData();
        fd.append("file", f);
        if (files.length === 1 && title.trim()) fd.append("title", title.trim());
        if (replaceId) {
          fd.append("replace_id", String(replaceId));
          if (companyId) fd.append("company_id", String(companyId));
        }
        else {
          fd.append("category", category);
          if (project) fd.append("project_id", project);
          if (clientId) fd.append("client_id", String(clientId));
          if (leadId) fd.append("lead_id", String(leadId));
          if (needCompany && company) fd.append("company_id", company);
        }
        const exp = expiryToIso(expiry);
        if (exp) fd.append("expires_at", exp);
        if (sensitive) fd.append("is_sensitive", "true");
        await api.upload("/api/documents", fd);
        ok++;
        setProgress(i + 1);
      }
      toast.success(replaceId ? "New version uploaded" : `${ok} document${ok === 1 ? "" : "s"} uploaded`);
      invalidateDocs(qc);
      if (leadId) qc.invalidateQueries({ queryKey: ["/api/leads"] });
      if (clientId) qc.invalidateQueries({ queryKey: ["/api/clients"] });
      onDone?.();
      onClose();
    } catch {
      if (ok) { invalidateDocs(qc); toast.warning(`${ok} of ${files.length} uploaded`); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={replaceId ? "Upload new version" : "Upload documents"}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={busy} icon={<Upload className="h-4 w-4" />} onClick={submit}>
          {busy && files.length > 1 ? `Uploading ${progress}/${files.length}` : "Upload"}
        </Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Files" required className="sm:col-span-2" hint="PDF, images, Office docs, ZIP, video. Executables are blocked.">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 transition hover:border-primary hover:bg-primary-soft/40">
            <Upload className="h-5 w-5 text-slate-400" />
            <span>Click to choose {replaceId ? "a file" : "files"}</span>
            <input type="file" multiple={!replaceId} className="hidden"
              onChange={(e) => { setFiles((p) => (replaceId ? [] : p).concat(Array.from(e.target.files || []))); e.target.value = ""; }} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-border">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted">{fileSize(f.size)}</span>
                  <IconButton title="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </Field>
        {files.length <= 1 && (
          <Field label="Title" className="sm:col-span-2" hint="Defaults to the file name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        {!replaceId && (
          <>
            {!hasParent && (
              <Field label="Project">
                <Select value={project} placeholder="No project" onChange={(e) => setProject(e.target.value)}
                  options={(meta?.projects || []).map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
            )}
            {needCompany && (
              <Field label="Company" required>
                <Select value={company} placeholder="Select…" onChange={(e) => setCompany(e.target.value)}
                  options={(meta?.companies || []).map((c) => ({ value: c.id, label: c.name }))} />
              </Field>
            )}
            <Field label="Category">
              <Select value={category} options={cats} onChange={(e) => setCategory(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Expiry date">
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Sensitive document" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Edit ───────────────────────────────────────────────────────────────────────
export function DocumentEditModal({ doc, onClose }: { doc: Row | null; onClose: () => void }) {
  if (!doc) return null;
  return <EditInner key={doc.id} doc={doc} onClose={onClose} />;
}

function EditInner({ doc, onClose }: { doc: Row; onClose: () => void }) {
  const { lookup } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: doc.title || "", category: doc.category || "General", status: doc.status || "Uploaded",
    expiry: isoToDateInput(doc.expires_at), is_sensitive: !!doc.is_sensitive,
  });
  const cats = lookup("document_category").map((l) => ({ value: l.value, label: l.name }));
  if (!cats.some((c) => c.value === f.category)) cats.push({ value: f.category, label: f.category });
  const save = useMutation({
    mutationFn: () => api.patch(`/api/documents/${doc.id}`, {
      title: f.title, category: f.category, status: f.status, is_sensitive: f.is_sensitive, expires_at: expiryToIso(f.expiry),
    }),
    onSuccess: () => { toast.success("Document updated"); invalidateDocs(qc); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="Edit document" size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => f.title.trim() ? save.mutate() : toast.error("Title is required")}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><Select value={f.category} options={cats} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Status"><Select value={f.status} options={DOC_STATUSES.map((s) => ({ value: s, label: s }))} onChange={(e) => setF({ ...f, status: e.target.value })} /></Field>
        </div>
        <Field label="Expiry date"><Input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></Field>
        <Checkbox label="Sensitive document" checked={f.is_sensitive} onChange={(e) => setF({ ...f, is_sensitive: e.target.checked })} />
      </div>
    </Modal>
  );
}

// ── Versions ───────────────────────────────────────────────────────────────────
export function DocumentVersionsModal({ doc, onClose }: { doc: Row | null; onClose: () => void }) {
  const { can } = useAuth();
  const [uploading, setUploading] = useState(false);
  const q = useQuery({
    queryKey: ["/api/documents", "versions", doc?.id],
    queryFn: () => api.get<Row[]>(`/api/documents/${doc!.id}/versions`),
    enabled: !!doc,
  });
  if (!doc) return null;
  return (
    <>
      <Modal open onClose={onClose} title={<>Versions · <span className="font-normal">{doc.title}</span></>} size="lg"
        footer={can("documents", "add") && can("documents", "edit")
          ? <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>Upload new version</Button> : undefined}>
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No versions" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-slate-500">
                <th className="px-2 py-2">Version</th><th className="px-2 py-2">File</th><th className="px-2 py-2">Size</th>
                <th className="px-2 py-2">Uploaded</th><th className="px-2 py-2" />
              </tr></thead>
              <tbody>
                {q.data.map((v, i) => (
                  <tr key={v.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2"><Badge tone={i === 0 ? "blue" : "slate"}>v{v.version}{i === 0 ? " · latest" : ""}</Badge></td>
                    <td className="max-w-[220px] truncate px-2 py-2">{v.file_name || "—"}</td>
                    <td className="px-2 py-2 text-muted">{fileSize(v.size_bytes)}</td>
                    <td className="px-2 py-2 text-xs text-muted">{fmtDateTime(v.created_at)}<br />{v.uploaded_by_name}</td>
                    <td className="px-2 py-2">
                      {v.has_file && (
                        <div className="flex justify-end gap-0.5">
                          <IconButton title="Preview" onClick={() => window.open(previewUrl(v.id), "_blank")}><Eye className="h-3.5 w-3.5" /></IconButton>
                          {can("documents", "download") && <IconButton title="Download" onClick={() => downloadDocument(v)}><Download className="h-3.5 w-3.5" /></IconButton>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      <DocumentUploadModal open={uploading} onClose={() => setUploading(false)} replaceId={doc.id} companyId={doc.company_id}
        onDone={() => { q.refetch(); onClose(); }} />
    </>
  );
}

// ── Share history ──────────────────────────────────────────────────────────────
export function DocumentSharesModal({ doc, onClose }: { doc: Row | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["/api/documents", "shares", doc?.id],
    queryFn: () => api.get<Row[]>(`/api/documents/${doc!.id}/shares`),
    enabled: !!doc,
  });
  if (!doc) return null;
  return (
    <Modal open onClose={onClose} title={<>Share history · <span className="font-normal">{doc.title}</span></>}>
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="Not shared yet" /> : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2.5 text-sm">
              <ChannelIcon channel={s.channel} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{humanize(s.channel)}{s.recipient ? ` to ${s.recipient}` : ""}</p>
                <p className="text-xs text-muted">By {s.shared_by_name || "—"} · {fmtDateTime(s.created_at)}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-muted">Expires {fmtDate(s.expires_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  const c = channel === "whatsapp" ? ["bg-emerald-50 text-emerald-600", <MessageCircle key="i" className="h-4 w-4" />]
    : channel === "email" ? ["bg-blue-50 text-blue-600", <Mail key="i" className="h-4 w-4" />]
      : ["bg-slate-100 text-slate-600", <Link2 key="i" className="h-4 w-4" />];
  return <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", c[0] as string)}>{c[1]}</span>;
}

// ── Lead picker ────────────────────────────────────────────────────────────────
export function LeadPicker({ value, onChange }: { value: Row | null; onChange: (lead: Row | null) => void }) {
  const [q, setQ] = useState("");
  const res = useQuery({
    queryKey: ["/api/leads", { q, page_size: 8, picker: 1 }],
    queryFn: () => api.get<Paged<Row>>("/api/leads", { q, page_size: 8 }),
    enabled: !value && q.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate"><b className="font-medium">{value.name}</b> <span className="text-muted">· {value.mobile}{value.email ? ` · ${value.email}` : ""}</span></span>
        <IconButton title="Change lead" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></IconButton>
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input className="pl-8" placeholder="Search lead by name, mobile, email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border">
          {res.isFetching && !res.data ? <p className="px-3 py-2 text-xs text-muted">Searching…</p>
            : !res.data?.items.length ? <p className="px-3 py-2 text-xs text-muted">No leads found</p>
              : res.data.items.map((l) => (
                <button key={l.id} type="button" onClick={() => onChange(l)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="truncate font-medium">{l.name}</span>
                  <span className="shrink-0 text-xs text-muted">{l.mobile}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

// ── Share ──────────────────────────────────────────────────────────────────────
type ShareProps = { open: boolean; onClose: () => void; documentIds?: number[]; leadId?: number; clientId?: number };

export function DocumentShareModal(props: ShareProps) {
  if (!props.open) return null;
  return <ShareInner {...props} />;
}

function ShareInner({ onClose, documentIds, leadId, clientId }: ShareProps) {
  const [channel, setChannel] = useState<"whatsapp" | "email" | "link">("whatsapp");
  const [lead, setLead] = useState<Row | null>(null);
  const [picked, setPicked] = useState<number[]>(documentIds || []);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const pickDocs = !documentIds?.length;
  const candidates = useQuery({
    queryKey: ["/api/documents", "share-candidates", leadId, clientId],
    queryFn: async () => leadId
      ? api.get<Row[]>(`/api/documents/for-lead/${leadId}`)
      : (await api.get<Paged<Row>>("/api/documents", { client_id: clientId, page_size: 0 })).items,
    enabled: pickDocs && !!(leadId || clientId),
  });
  const groups = Object.entries((candidates.data || []).filter((d) => d.has_file).reduce<Record<string, Row[]>>((acc, d) => {
    (acc[d.category || "General"] ||= []).push(d);
    return acc;
  }, {})).sort(([a], [b]) => a.localeCompare(b));
  const hasRecipient = !!(leadId || clientId || lead);
  const share = useMutation({
    mutationFn: () => api.post("/api/documents/share", {
      document_ids: picked, channel, valid_days: days, message: message.trim() || undefined,
      lead_id: leadId || lead?.id || undefined, client_id: clientId || undefined,
    }),
    onSuccess: (r) => {
      setResult(r);
      if (r.whatsapp_url) window.open(r.whatsapp_url, "_blank");
      toast.success(r.emailed_to ? `Emailed to ${r.emailed_to}` : "Share links created");
    },
  });
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  const submit = () => {
    if (!picked.length) return toast.error("Select at least one document");
    if (channel !== "link" && !hasRecipient) return toast.error("Select a lead to share with");
    share.mutate();
  };

  const channels = [
    { v: "whatsapp" as const, label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
    { v: "email" as const, label: "Email", icon: <Mail className="h-4 w-4" /> },
    { v: "link" as const, label: "Copy link", icon: <Link2 className="h-4 w-4" /> },
  ];

  if (result) {
    return (
      <Modal open onClose={onClose} title="Documents shared"
        footer={<>
          {result.whatsapp_url && <Button variant="success" icon={<MessageCircle className="h-4 w-4" />} onClick={() => window.open(result.whatsapp_url, "_blank")}>Open WhatsApp</Button>}
          <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copy(result.message)}>Copy message</Button>
          <Button onClick={onClose}>Done</Button>
        </>}>
        {result.emailed_to && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Email queued to {result.emailed_to}</p>}
        <ul className="space-y-2">
          {(result.links as Row[]).map((l) => (
            <li key={l.id} className="rounded-lg border border-border p-2.5">
              <p className="text-sm font-medium text-slate-800">{l.title}</p>
              <div className="mt-1 flex items-center gap-2">
                <Input readOnly value={l.url} className="h-8 text-xs" onFocus={(e) => e.target.select()} />
                <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(l.url)}>Copy</Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Links expire in {days} day{days === 1 ? "" : "s"}.</p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Share documents"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={share.isPending} icon={<Share2 className="h-4 w-4" />} onClick={submit}>Share</Button></>}>
      <div className="space-y-4">
        <Field label="Channel">
          <div className="grid grid-cols-3 gap-2">
            {channels.map((c) => (
              <button key={c.v} type="button" onClick={() => setChannel(c.v)}
                className={cn("flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
                  channel === c.v ? "border-primary bg-primary-soft text-primary" : "border-border text-slate-600 hover:bg-slate-50")}>
                {c.icon}<span className="hidden sm:inline">{c.label}</span>
              </button>
            ))}
          </div>
        </Field>
        {!leadId && !clientId && (
          <Field label="Lead" required={channel !== "link"} hint={channel === "link" ? "Optional – links are logged against the lead" : undefined}>
            <LeadPicker value={lead} onChange={setLead} />
          </Field>
        )}
        {pickDocs ? (
          <Field label={`Documents${picked.length ? ` (${picked.length} selected)` : ""}`} required>
            {candidates.isLoading ? <Loading /> : !groups.length ? <p className="text-sm text-muted">No uploaded documents available.</p> : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {groups.map(([cat, docs]) => {
                  const ids = docs.map((d) => d.id as number);
                  const all = ids.every((i) => picked.includes(i));
                  return (
                    <div key={cat}>
                      <label className="sticky top-0 flex cursor-pointer items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={all}
                          onChange={() => setPicked(all ? picked.filter((x) => !ids.includes(x)) : Array.from(new Set([...picked, ...ids])))} />
                        {cat} <span className="font-normal text-muted">({docs.length})</span>
                      </label>
                      {docs.map((d) => (
                        <label key={d.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={picked.includes(d.id)}
                            onChange={() => setPicked(picked.includes(d.id) ? picked.filter((x) => x !== d.id) : [...picked, d.id])} />
                          <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          {d.project_name && <span className="hidden truncate text-xs text-muted sm:inline">{d.project_name}</span>}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </Field>
        ) : <p className="text-sm text-slate-600">{picked.length} document{picked.length === 1 ? "" : "s"} selected.</p>}
        {channel !== "link" && (
          <Field label="Message" hint="Optional – links are appended automatically">
            <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hello, please find the documents…" />
          </Field>
        )}
        <Field label="Link valid for">
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}
            options={[1, 3, 7, 15, 30].map((n) => ({ value: n, label: `${n} day${n === 1 ? "" : "s"}` }))} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Row actions (preview / download / share / versions / edit / delete) ────────
export function DocumentActions({ doc, compact }: { doc: Row; compact?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [modal, setModal] = useState<"" | "edit" | "versions" | "share" | "shares">("");
  const close = () => setModal("");
  const remove = async () => {
    if (!(await confirm({ title: "Delete document?", message: <>“{doc.title}” will be removed.</> }))) return;
    await api.del(`/api/documents/${doc.id}`);
    toast.success("Document deleted");
    invalidateDocs(qc);
  };
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {doc.has_file && <IconButton title="Preview" onClick={() => window.open(previewUrl(doc.id), "_blank")}><Eye className="h-3.5 w-3.5" /></IconButton>}
      {doc.has_file && can("documents", "download") && <IconButton title="Download" onClick={() => downloadDocument(doc)}><Download className="h-3.5 w-3.5" /></IconButton>}
      {!compact && doc.has_file && can("documents", "share") && <IconButton title="Share" tone="green" onClick={() => setModal("share")}><Share2 className="h-3.5 w-3.5" /></IconButton>}
      <Menu width="w-48" trigger={(t) => <IconButton title="More" onClick={t}><MoreHorizontal className="h-4 w-4" /></IconButton>}>
        {(c) => <>
          {compact && doc.has_file && can("documents", "share") && <MenuItem icon={<Share2 className="h-4 w-4" />} onClick={() => { c(); setModal("share"); }}>Share</MenuItem>}
          <MenuItem icon={<History className="h-4 w-4" />} onClick={() => { c(); setModal("versions"); }}>Versions (v{doc.version})</MenuItem>
          <MenuItem icon={<Link2 className="h-4 w-4" />} onClick={() => { c(); setModal("shares"); }}>Share history</MenuItem>
          {can("documents", "edit") && <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { c(); setModal("edit"); }}>Edit details</MenuItem>}
          {can("documents", "delete") && <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { c(); remove(); }}>Delete</MenuItem>}
        </>}
      </Menu>
      <DocumentEditModal doc={modal === "edit" ? doc : null} onClose={close} />
      <DocumentVersionsModal doc={modal === "versions" ? doc : null} onClose={close} />
      <DocumentSharesModal doc={modal === "shares" ? doc : null} onClose={close} />
      <DocumentShareModal open={modal === "share"} onClose={close} documentIds={[doc.id]}
        leadId={doc.lead_id || undefined} clientId={doc.client_id || undefined} />
    </div>
  );
}

export function DocStatus({ doc }: { doc: Row }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill value={doc.status} />
      {doc.is_sensitive && <Badge tone="violet">Sensitive</Badge>}
    </span>
  );
}
