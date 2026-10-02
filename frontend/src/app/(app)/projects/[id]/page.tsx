"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Building2, ExternalLink, FileText, Folder, FolderOpen, Home, Pencil, Phone, Plus, Trash2, Upload, Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, money } from "@/lib/utils";
import { DataTable, RowLink, useList, type Column } from "@/components/data";
import {
  Avatar, Badge, Button, Card, Empty, IconButton, Input, KeyValue, Loading, Pagination, PriorityBadge, Select, Stat,
  StatusPill, Tabs, Textarea,
} from "@/components/ui";
import { AVAILABILITY, InventoryBar, ProjectFormModal, PropertyFormModal } from "@/components/projects";
import { DocStatus, DocumentActions, DocumentUploadModal, fileSize } from "@/components/documents";

type Faq = { q: string; a: string };

export default function ProjectProfilePage() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState<Row | null>(null);
  const q = useQuery({
    queryKey: ["/api/projects", "detail", pid],
    queryFn: () => api.get(`/api/projects/${pid}`),
    enabled: !!pid,
  });
  const p = q.data;
  if (q.isLoading) return <Loading />;
  if (!p) return <Empty title="Project not found" action={<Button variant="outline" onClick={() => router.push("/projects")}>Back to projects</Button>} />;
  const inv = (p.inventory || {}) as Record<string, number>;

  return (
    <div>
      <Link href="/projects" className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" />Projects</Link>
      <div className="card mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Building2 className="h-6 w-6" /></span>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
                {p.name}<Badge tone="blue">{p.status}</Badge>{!p.is_active && <Badge>Inactive</Badge>}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {[p.code, p.process_name, p.developer && `by ${p.developer}`, [p.area_name, p.city_name].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {p.price_min || p.price_max ? `${money(p.price_min)}${p.price_max ? ` – ${money(p.price_max)}` : "+"}` : "Price on request"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.map_link && <a href={p.map_link} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" icon={<ExternalLink className="h-4 w-4" />}>Map</Button></a>}
            {can("leads", "add") && <Link href={`/leads?new=1&project_id=${p.id}`}><Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />}>Add lead</Button></Link>}
            {can("projects", "edit") && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)}>Edit</Button>}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads" value={p.lead_count} icon={<Users className="h-5 w-5" />} onClick={() => setTab("leads")} />
        <Stat label="Units" value={p.property_count} tone="violet" icon={<Home className="h-5 w-5" />} onClick={() => setTab("inventory")}
          sub={`${inv.Available || 0} available · ${inv.Hold || 0} hold`} />
        <Stat label="Booked / Sold" value={`${inv.Booked || 0} / ${inv.Sold || 0}`} tone="green" icon={<Home className="h-5 w-5" />} onClick={() => setTab("inventory")}
          sub={`${(inv.Reserved || 0) + (inv.Blocked || 0)} reserved / blocked`} />
        <Stat label="Documents" value={p.document_count} tone="amber" icon={<FileText className="h-5 w-5" />} onClick={() => setTab("documents")} />
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: "overview", label: "Overview" },
        { value: "inventory", label: "Inventory", count: p.property_count },
        { value: "documents", label: "Documents", count: p.document_count },
        { value: "leads", label: "Leads", count: p.lead_count },
        { value: "team", label: "Team", count: (p.team_user_ids || []).length },
      ]} />

      {tab === "overview" && <Overview p={p} />}
      {tab === "inventory" && <Inventory p={p} />}
      {tab === "documents" && <Documents p={p} />}
      {tab === "leads" && <Leads p={p} />}
      {tab === "team" && <Team p={p} onEdit={() => setEditing(p)} />}
      <ProjectFormModal value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────────
function Overview({ p }: { p: Row }) {
  const inv = (p.inventory || {}) as Record<string, number>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Project details">
          <KeyValue items={[
            ["Code", p.code], ["Process", p.process_name], ["Developer", p.developer], ["Status", p.status],
            ["City", p.city_name], ["Area", p.area_name], ["Address", p.address],
            ["Map", p.map_link ? <a href={p.map_link} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open map</a> : null],
            ["Min price", money(p.price_min)], ["Max price", money(p.price_max)],
            ["Contact", p.contact_name], ["Contact phone", p.contact_phone ? <a className="text-primary hover:underline" href={`tel:${p.contact_phone}`}>{p.contact_phone}</a> : null],
            ["Created", fmtDate(p.created_at)], ["Updated", fmtDate(p.updated_at)],
          ]} />
          {p.description && <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-700">{p.description}</p>}
        </Card>
        <FaqEditor p={p} />
      </div>
      <div className="space-y-4">
        <Card title="Sales notes">
          {p.sales_notes ? <p className="whitespace-pre-line text-sm text-slate-700">{p.sales_notes}</p> : <p className="text-sm text-muted">No sales notes yet.</p>}
        </Card>
        <Card title="Inventory">
          <InventoryBar inv={inv} />
          <ul className="mt-3 space-y-1 text-sm">
            {AVAILABILITY.map((a) => (
              <li key={a} className="flex justify-between"><StatusPill value={a} /><span className="font-medium">{inv[a] || 0}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function FaqEditor({ p }: { p: Row }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const saved: Faq[] = Array.isArray(p.faqs) ? p.faqs : [];
  const [draft, setDraft] = useState<Faq[] | null>(null);
  const save = useMutation({
    mutationFn: (faqs: Faq[]) => api.patch(`/api/projects/${p.id}`, { faqs }),
    onSuccess: () => { toast.success("FAQs saved"); setDraft(null); qc.invalidateQueries({ queryKey: ["/api/projects"] }); },
  });
  const editable = can("projects", "edit");
  return (
    <Card title={`FAQs (${saved.length})`} actions={editable && !draft && (
      <Button size="xs" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setDraft(saved.length ? saved : [{ q: "", a: "" }])}>Edit</Button>
    )}>
      {draft ? (
        <div className="space-y-3">
          {draft.map((f, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <Input placeholder="Question" value={f.q} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                <IconButton title="Remove" tone="red" className="mt-1" onClick={() => setDraft(draft.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </div>
              <Textarea className="mt-2" rows={2} placeholder="Answer" value={f.a} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft([...draft, { q: "", a: "" }])}>Add question</Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate(draft.filter((f) => f.q.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() })))}>Save FAQs</Button>
            </div>
          </div>
        </div>
      ) : saved.length ? (
        <div className="divide-y divide-slate-100">
          {saved.map((f, i) => (
            <details key={i} className="group py-2" open={i === 0}>
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-800 marker:hidden">
                <span className="mr-1 text-primary">Q.</span>{f.q}
              </summary>
              <p className="mt-1 whitespace-pre-line pl-5 text-sm text-slate-600">{f.a || "—"}</p>
            </details>
          ))}
        </div>
      ) : <p className="text-sm text-muted">No FAQs yet. Add common buyer questions so agents can answer quickly.</p>}
    </Card>
  );
}

// ── Inventory ──────────────────────────────────────────────────────────────────
function Inventory({ p }: { p: Row }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [avail, setAvail] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const list = useList("/api/properties", { project_id: p.id, availability: avail, page_size: 0, sort: "code" });
  const change = useMutation({
    mutationFn: ({ id, availability }: { id: number; availability: string }) => api.patch(`/api/properties/${id}`, { availability }),
    onSuccess: () => { toast.success("Availability updated"); qc.invalidateQueries({ queryKey: ["/api/properties"] }); qc.invalidateQueries({ queryKey: ["/api/projects"] }); },
  });
  const columns: Column[] = [
    { key: "code", label: "Code", render: (r) => <span className="font-medium text-slate-800">{r.code}</span> },
    { key: "unit_no", label: "Unit" },
    { key: "property_type", label: "Type" },
    { key: "size", label: "Size", render: (r) => r.size ? `${Number(r.size).toLocaleString("en-IN")} ${r.size_unit || ""}` : "—" },
    { key: "facing", label: "Facing" },
    { key: "beds", label: "Bed/Bath", render: (r) => r.bedrooms || r.bathrooms ? `${r.bedrooms ?? "–"} / ${r.bathrooms ?? "–"}` : "—" },
    { key: "base_price", label: "Base", render: (r) => money(r.base_price) },
    { key: "offer_price", label: "Offer", render: (r) => r.offer_price ? <span className="font-medium text-emerald-700">{money(r.offer_price)}</span> : "—" },
    { key: "availability", label: "Availability", render: (r) => can("properties", "edit") ? (
      <div onClick={(e) => e.stopPropagation()}>
        <Select className="h-8 w-32 py-1 text-xs" value={r.availability} options={AVAILABILITY.map((a) => ({ value: a, label: a }))}
          onChange={(e) => change.mutate({ id: r.id, availability: e.target.value })} />
      </div>
    ) : <StatusPill value={r.availability} /> },
    ...(can("properties", "edit") ? [{ key: "_a", label: "", render: (r: Row) => <IconButton title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(r); }}><Pencil className="h-3.5 w-3.5" /></IconButton> }] : []),
  ];
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Select className="w-auto min-w-[150px]" value={avail} placeholder="All availability" options={AVAILABILITY.map((a) => ({ value: a, label: a }))} onChange={(e) => setAvail(e.target.value)} />
        <Link href={`/properties?project_id=${p.id}`} className="text-xs text-primary hover:underline">Open in inventory</Link>
        {can("properties", "add") && <Button size="sm" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ project_id: p.id })}>Add property</Button>}
      </div>
      <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} dense
        onRowClick={can("properties", "edit") ? setEditing : undefined}
        empty={<Empty icon={<Home className="h-6 w-6" />} title="No properties" text="Add units, plots or villas to track availability." />} />
      <PropertyFormModal value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────────
function Documents({ p }: { p: Row }) {
  const { can, lookup } = useAuth();
  const [folder, setFolder] = useState("");
  const [uploading, setUploading] = useState(false);
  const list = useList("/api/documents", { project_id: p.id, scope: "project", page_size: 0 });
  const docs = useMemo(() => list.data?.items || [], [list.data]);
  const folders = useMemo(() => {
    const counts: Record<string, number> = {};
    docs.forEach((d) => { counts[d.category] = (counts[d.category] || 0) + 1; });
    const names = lookup("document_category").map((l) => l.value);
    Object.keys(counts).forEach((c) => { if (!names.includes(c)) names.push(c); });
    return names.map((n) => ({ name: n, count: counts[n] || 0 }));
  }, [docs, lookup]);
  const shown = folder ? docs.filter((d) => d.category === folder) : docs;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <div className="card h-max p-2">
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {[{ name: "", count: docs.length }, ...folders].map((f) => (
            <button key={f.name || "all"} type="button" onClick={() => setFolder(f.name)}
              className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                folder === f.name ? "bg-primary-soft font-medium text-primary" : "text-slate-600 hover:bg-slate-50",
                !f.count && f.name && "opacity-60")}>
              {folder === f.name ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
              <span className="flex-1 truncate">{f.name || "All documents"}</span>
              <span className="text-xs text-muted">{f.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h3 className="text-sm font-semibold text-slate-800">{folder || "All documents"}</h3>
          {can("documents", "add") && <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>Upload</Button>}
        </div>
        {list.isLoading ? <Loading /> : !shown.length ? (
          <Empty icon={<FileText className="h-6 w-6" />} title="No documents in this folder" text="Upload brochures, price lists, floor plans and approvals." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold uppercase text-slate-500">
                  {(d.file_name || "").split(".").pop()?.slice(0, 4) || "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{d.title} {d.version > 1 && <Badge tone="blue">v{d.version}</Badge>}</p>
                  <p className="truncate text-xs text-muted">
                    {!folder && `${d.category} · `}{fileSize(d.size_bytes)} · {d.uploaded_by_name || "—"} · {fmtDate(d.created_at)}
                    {d.expires_at && <span className={cn(d.is_expired && "font-medium text-danger")}> · {d.is_expired ? "Expired" : "Expires"} {fmtDate(d.expires_at)}</span>}
                  </p>
                </div>
                <DocStatus doc={d} />
                <DocumentActions doc={d} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <DocumentUploadModal open={uploading} onClose={() => setUploading(false)} projectId={p.id} defaultCategory={folder || undefined} />
    </div>
  );
}

// ── Leads ──────────────────────────────────────────────────────────────────────
function Leads({ p }: { p: Row }) {
  const [page, setPage] = useState(1);
  const list = useList("/api/leads", { project_id: p.id, page_size: 20, page, sort: "-created_at" });
  const columns: Column[] = [
    { key: "name", label: "Lead", render: (r) => <div><RowLink href={`/leads/${r.id}`}>{r.name}</RowLink><div className="text-xs text-muted">{r.code}</div></div> },
    { key: "mobile", label: "Mobile", render: (r) => <a href={`tel:${r.mobile}`} className="inline-flex items-center gap-1 text-slate-700 hover:text-primary" onClick={(e) => e.stopPropagation()}><Phone className="h-3 w-3" />{r.mobile}</a> },
    { key: "status_name", label: "Status", render: (r) => r.status_name ? <Badge color={r.status_color}>{r.status_name}</Badge> : "—" },
    { key: "priority", label: "Priority", render: (r) => <PriorityBadge value={r.priority} /> },
    { key: "assigned_to_name", label: "Assigned to" },
    { key: "next_followup_at", label: "Next follow-up", render: (r) => <span className="text-xs">{fmtDateTime(r.next_followup_at)}</span> },
    { key: "created_at", label: "Created", render: (r) => <span className="text-xs text-muted">{fmtDate(r.created_at)}</span> },
  ];
  return (
    <div className="card">
      <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} empty={<Empty title="No leads for this project yet" />} />
      {list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

// ── Team ───────────────────────────────────────────────────────────────────────
function Team({ p, onEdit }: { p: Row; onEdit: () => void }) {
  const { meta, can } = useAuth();
  const ids = ((p.team_user_ids || []) as number[]).map(Number);
  const users = (meta?.users || []).filter((u) => ids.includes(u.id));
  const teams = Object.fromEntries((meta?.teams || []).map((t) => [t.id, t.name]));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Project team" actions={can("projects", "edit") && <Button size="xs" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Manage</Button>}>
        {!users.length ? <Empty icon={<Users className="h-6 w-6" />} title="No team members assigned" /> : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <Avatar name={u.name} size={34} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{u.name}</p>
                  <p className="truncate text-xs text-muted">{u.team_id ? teams[u.team_id] || "—" : "No team"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {ids.length > users.length && <p className="mt-2 text-xs text-muted">{ids.length - users.length} member(s) are inactive or outside your scope.</p>}
      </Card>
      <Card title="Developer contact">
        <KeyValue cols={1} items={[["Name", p.contact_name], ["Phone", p.contact_phone ? <a className="text-primary hover:underline" href={`tel:${p.contact_phone}`}>{p.contact_phone}</a> : null], ["Developer", p.developer]]} />
      </Card>
    </div>
  );
}
