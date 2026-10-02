"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Bookmark, CalendarClock, ChevronDown, ChevronUp, Columns3, Download, Filter, Flame, Kanban, List, Plus, Search, Tag, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, fromLocalInput, fromNow, money, tomorrowAt } from "@/lib/utils";
import { DataTable, opts, useList, type Column } from "@/components/data";
import { AssignModal, LeadFormModal, LeadQuickActions, StatusModal } from "@/components/lead-actions";
import { LeadPanel } from "@/components/lead-panel";
import {
  Avatar, Badge, Button, Checkbox, Drawer, Empty, Field, Input, Menu, MenuItem, Modal, PageHeader, Pagination,
  Select, useConfirm,
} from "@/components/ui";

const STICKY_KEY = "crm.leads.filters";
const COLS_KEY = "crm.leads.columns";
const FILTER_KEYS = ["source_id", "project_id", "assigned_to_id", "priority", "followup", "created_from", "created_to",
  "company_id", "process_id", "property_type", "is_duplicate", "converted", "import_job_id", "team_id"];

type ColDef = { key: string; label: string; group: string; render: (r: Row) => React.ReactNode; sortable?: boolean; default?: boolean; mobile?: "title" | "footer" | "hide" };

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

function PriorityInline({ lead }: { lead: Row }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (p: string) => api.patch(`/api/leads/${lead.id}`, { priority: p }), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/leads"] }) });
  const tone = lead.priority === "Hot" ? "text-red-600 bg-red-50" : lead.priority === "Cold" ? "text-blue-600 bg-blue-50" : "text-amber-700 bg-amber-50";
  if (!can("leads", "edit")) return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", tone)}>{lead.priority}</span>;
  return (
    <select value={lead.priority} onClick={(e) => e.stopPropagation()} onChange={(e) => m.mutate(e.target.value)}
      className={cn("cursor-pointer rounded border-0 px-1.5 py-0.5 text-xs font-medium outline-none", tone)}>
      {["Hot", "Warm", "Cold"].map((p) => <option key={p}>{p}</option>)}
    </select>
  );
}

function FollowUpCell({ v }: { v?: string }) {
  if (!v) return <span className="text-xs text-amber-600">Not set</span>;
  const d = new Date(v);
  const overdue = d < new Date();
  return <span className={cn("text-xs", overdue ? "font-medium text-danger" : "text-slate-700")} title={fmtDateTime(v)}>{fmtDateTime(v)}{overdue ? " (overdue)" : ""}</span>;
}

function LeadBoard() {
  const { meta, me, can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [statusTab, setStatusTab] = useState<string>("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("-created_at");
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [visibleCols, setVisibleCols] = useState<string[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [bulk, setBulk] = useState<"assign" | "status" | "followup" | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);

  // init after hydration: URL params override sticky (localStorage) filters
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from URL/localStorage, unavailable during SSR */
    const sticky = load<Row>(STICKY_KEY, {});
    const fromUrl: Record<string, string> = {};
    FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) fromUrl[k] = v; });
    setFilters(Object.keys(fromUrl).length ? fromUrl : sticky.filters || {});
    setStatusTab(params.get("status_id") || (Object.keys(fromUrl).length ? "" : sticky.status || ""));
    setView(load(`${STICKY_KEY}.view`, "table"));
    setVisibleCols(load<string[] | null>(COLS_KEY, null));
    if (params.get("new") === "1") setNewOpen(true);
    if (params.get("q")) setQ(params.get("q")!);
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem(STICKY_KEY, JSON.stringify({ filters, status: statusTab })); localStorage.setItem(`${STICKY_KEY}.view`, JSON.stringify(view)); } catch { /* ignore */ }
  }, [filters, statusTab, view, mounted]);

  const baseParams = { q: debounced, ...filters, ...(filters.created_from ? { created_from: fromLocalInput(filters.created_from) } : {}), ...(filters.created_to ? { created_to: fromLocalInput(filters.created_to) } : {}) };
  const listParams = view === "kanban"
    ? { ...baseParams, page: 1, page_size: 300, sort: "-updated_at" }
    : { ...baseParams, status_id: statusTab, page, page_size: pageSize, sort };
  const list = useList("/api/leads", listParams, mounted);
  const stats = useQuery({ queryKey: ["/api/leads", "stats", baseParams], queryFn: () => api.get("/api/leads/stats", baseParams), enabled: mounted });
  const views = useQuery({ queryKey: ["saved-views", "leads"], queryFn: () => api.get<Row[]>("/api/saved-views", { module: "leads" }) });

  const ALL_COLS: ColDef[] = useMemo(() => [
    { key: "name", label: "Lead", group: "Identity", default: true, sortable: true, render: (r) => (
      <div className="flex min-w-[180px] items-center gap-2.5">
        <Avatar name={r.name} size={30} />
        <div className="min-w-0">
          <Link href={`/leads/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-slate-900 hover:text-primary">{r.name}</Link>
          <span className="block text-xs text-muted">{r.mobile} · <span className="font-mono">{r.code}</span>{r.is_duplicate && <Badge tone="amber" className="ml-1">dup</Badge>}</span>
        </div>
      </div>) },
    { key: "actions", label: "Quick actions", group: "Actions", default: true, render: (r) => <LeadQuickActions lead={r} onOpen={() => setPreview(r.id)} /> },
    { key: "source_name", label: "Source", group: "Identity", default: true, render: (r) => <span className="text-xs">{r.source_name || "—"}{r.campaign && <span className="block text-muted">{r.campaign}</span>}</span> },
    { mobile: "hide", key: "created_at", label: "Created", group: "Identity", default: true, sortable: true, render: (r) => <span className="text-xs" title={fmtDateTime(r.created_at)}>{fmtDate(r.created_at, "dd MMM, HH:mm")}</span> },
    { key: "email", label: "Email", group: "Identity", render: (r) => <span className="text-xs">{r.email || "—"}</span> },
    { key: "project_name", label: "Project", group: "Requirement", default: true, render: (r) => <span className="text-xs">{r.project_name || "—"}{r.property_type && <span className="block text-muted">{r.property_type}</span>}</span> },
    { mobile: "hide", key: "budget", label: "Budget", group: "Requirement", default: true, render: (r) => <span className="text-xs">{r.budget_min || r.budget_max ? `${r.budget_min ? money(r.budget_min) : ""}${r.budget_min && r.budget_max ? " – " : ""}${r.budget_max ? money(r.budget_max) : ""}` : "—"}</span> },
    { key: "preferred_location", label: "Location", group: "Requirement", render: (r) => <span className="text-xs">{r.preferred_location || r.city || "—"}</span> },
    { key: "purpose", label: "Purpose", group: "Requirement", render: (r) => <span className="text-xs">{r.purpose || "—"}</span> },
    { key: "assigned_to_name", label: "Agent", group: "Ownership", default: true, render: (r) => r.assigned_to_name ? <span className="flex items-center gap-1.5 text-xs"><Avatar name={r.assigned_to_name} size={20} />{r.assigned_to_name}</span> : <Badge tone="amber">Unassigned</Badge> },
    { mobile: "hide", key: "company_name", label: "Company", group: "Ownership", default: !!me?.is_global, render: (r) => <span className="text-xs">{r.company_name}</span> },
    { key: "status", label: "Status", group: "Pipeline", default: true, render: (r) => (
      <div className="min-w-[120px]"><Badge color={r.status_color}>{r.status_name || "—"}</Badge>{r.sub_status_name && <span className="mt-0.5 block text-[11px] text-muted">{r.sub_status_name}</span>}</div>) },
    { key: "priority", label: "Priority", group: "Pipeline", default: true, sortable: true, render: (r) => <PriorityInline lead={r} /> },
    { key: "last_activity_at", label: "Last activity", group: "Activity", sortable: true, render: (r) => <span className="text-xs text-muted">{fromNow(r.last_activity_at)}</span> },
    { key: "next_followup_at", label: "Next follow-up", group: "Activity", default: true, sortable: true, render: (r) => <FollowUpCell v={r.next_followup_at} /> },
    { key: "next_action", label: "Next action", group: "Activity", render: (r) => <span className="text-xs">{r.next_action || "—"}</span> },
    { key: "conversion", label: "Visits / Meetings", group: "Conversion", render: (r) => <span className="text-xs">{r.visit_count} / {r.meeting_count}{r.client_id && <Badge tone="green" className="ml-1">Booked</Badge>}</span> },
  ], [me]);
  const cols = visibleCols ?? ALL_COLS.filter((c) => c.default).map((c) => c.key);
  const columns: Column[] = ALL_COLS.filter((c) => cols.includes(c.key)).sort((a, b) => cols.indexOf(a.key) - cols.indexOf(b.key))
    .map((c) => ({ key: c.key, label: c.label, render: c.render, sortable: c.sortable, mobile: c.mobile }));
  const toggleCol = (k: string) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k];
    setVisibleCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const moveCol = (k: string, dir: -1 | 1) => {
    const i = cols.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    setVisibleCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const setF = (k: string, v: string) => { setFilters((f) => { const n = { ...f, [k]: v }; if (!v) delete n[k]; return n; }); setPage(1); };
  const activeFilterCount = Object.keys(filters).length;
  const by = stats.data?.by_status || {};
  const tabs = [{ id: "", name: "All", color: "#0f172a", count: stats.data?.total }, ...(meta?.statuses || []).map((s) => ({ id: String(s.id), name: s.name, color: s.color, count: by[String(s.id)] || 0 }))];

  const applyView = (v: Row) => {
    setFilters(v.filters?.filters || {}); setStatusTab(v.filters?.status || ""); setQ(v.filters?.q || "");
    if (v.columns) { setVisibleCols(v.columns); try { localStorage.setItem(COLS_KEY, JSON.stringify(v.columns)); } catch { /* ignore */ } }
    toast.success(`View “${v.name}” applied`);
  };
  const doExport = async () => {
    try { await api.download("/api/exports/leads", { format: "xlsx", filters: { ...baseParams, status_id: statusTab } }); toast.success("Export ready"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const bulkSimple = async (action: string, extra: Row = {}) => {
    if (action === "delete" && !(await confirm({ title: `Delete ${selected.length} leads?` }))) return;
    const r = await api.post("/api/leads/bulk", { action, ids: selected, ...extra });
    toast.success(`Updated ${r.updated} leads`); setSelected([]); qc.invalidateQueries({ queryKey: ["/api/leads"] });
  };

  return (
    <div>
      <PageHeader title="Lead Board" subtitle="Work every lead from one screen – call, WhatsApp, follow up and move it forward."
        actions={<>
          {can("leads", "import") && <Button variant="outline" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => router.push("/imports?new=1")}>Import</Button>}
          {can("leads", "export") && <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={doExport}>Export</Button>}
          {can("leads", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>Add lead</Button>}
        </>} />

      {/* Status tabs */}
      {view === "table" && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => { setStatusTab(t.id); setPage(1); }}
              className={cn("flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition",
                statusTab === t.id ? "border-transparent text-white shadow" : "border-border bg-white text-slate-600 hover:border-slate-300")}
              style={statusTab === t.id ? { background: t.color } : undefined}>
              {t.id && statusTab !== t.id && <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />}
              {t.name}<span className={cn("rounded-full px-1.5 text-[11px]", statusTab === t.id ? "bg-white/25" : "bg-slate-100")}>{t.count ?? "…"}</span>
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Name, mobile, email, ID, campaign…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={filters.followup || ""} onChange={(e) => setF("followup", e.target.value)} placeholder="Any follow-up"
            options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" }, { value: "none", label: "No follow-up" }]} />
          <Select className="w-auto" value={filters.assigned_to_id || ""} onChange={(e) => setF("assigned_to_id", e.target.value)} placeholder="All agents"
            options={[{ value: "none", label: "Unassigned" }, ...opts.users(meta)]} />
          <Button variant={showFilters || activeFilterCount ? "secondary" : "outline"} size="sm" icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters(!showFilters)}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
          {activeFilterCount > 0 && <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => { setFilters({}); setStatusTab(""); setQ(""); }}>Clear</Button>}
          <div className="ml-auto flex items-center gap-1.5">
            <Menu width="w-60" trigger={(t) => <Button variant="outline" size="sm" icon={<Bookmark className="h-4 w-4" />} onClick={t}>Views</Button>}>
              {(close) => (<>
                {(views.data || []).length === 0 && <p className="px-3 py-2 text-xs text-muted">No saved views yet</p>}
                {(views.data || []).map((v) => (
                  <div key={v.id} className="flex items-center justify-between pr-2 hover:bg-slate-50">
                    <MenuItem onClick={() => { close(); applyView(v); }}>{v.name} <span className="text-[10px] text-muted">{v.visibility !== "personal" ? v.visibility : ""}</span></MenuItem>
                    {v.mine && <button type="button" className="text-slate-400 hover:text-danger" title="Delete view" onClick={async () => { await api.del(`/api/saved-views/${v.id}`); views.refetch(); }}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
                <div className="border-t border-border"><MenuItem icon={<Plus className="h-4 w-4" />} onClick={() => { close(); setSaveViewOpen(true); }}>Save current view</MenuItem></div>
              </>)}
            </Menu>
            {view === "table" && (
              <Menu width="w-64" trigger={(t) => <Button variant="outline" size="sm" icon={<Columns3 className="h-4 w-4" />} onClick={t}>Columns</Button>}>
                {() => (
                  <div className="px-3 py-2">
                    {ALL_COLS.map((c) => (
                      <div key={c.key} className="flex items-center justify-between py-0.5">
                        <Checkbox label={<span className="text-xs">{c.label} <span className="text-muted">· {c.group}</span></span>} checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                        {cols.includes(c.key) && <span className="flex text-slate-400"><button type="button" onClick={() => moveCol(c.key, -1)} title="Move up" className="px-1 hover:text-slate-700"><ChevronUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => moveCol(c.key, 1)} title="Move down" className="px-1 hover:text-slate-700"><ChevronDown className="h-3.5 w-3.5" /></button></span>}
                      </div>
                    ))}
                    <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => { setVisibleCols(null); localStorage.removeItem(COLS_KEY); }}>Reset to default</button>
                  </div>
                )}
              </Menu>
            )}
            <div className="flex rounded-lg border border-border p-0.5">
              <button type="button" title="Table view" onClick={() => setView("table")} className={cn("rounded-md p-1.5", view === "table" ? "bg-primary text-white" : "text-slate-500")}><List className="h-4 w-4" /></button>
              <button type="button" title="Kanban view" onClick={() => setView("kanban")} className={cn("rounded-md p-1.5", view === "kanban" ? "bg-primary text-white" : "text-slate-500")}><Kanban className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="grid gap-3 border-b border-border bg-slate-50/60 p-3 sm:grid-cols-3 lg:grid-cols-6">
            {me?.is_global && <Select value={filters.company_id || ""} onChange={(e) => setF("company_id", e.target.value)} placeholder="All companies" options={opts.companies(meta)} />}
            <Select value={filters.source_id || ""} onChange={(e) => setF("source_id", e.target.value)} placeholder="All sources" options={opts.sources(meta)} />
            <Select value={filters.project_id || ""} onChange={(e) => setF("project_id", e.target.value)} placeholder="All projects" options={[{ value: "none", label: "No project" }, ...opts.projects(meta)]} />
            <Select value={filters.process_id || ""} onChange={(e) => setF("process_id", e.target.value)} placeholder="All processes" options={opts.processes(meta)} />
            <Select value={filters.priority || ""} onChange={(e) => setF("priority", e.target.value)} placeholder="Any priority" options={opts.list("Hot", "Warm", "Cold")} />
            <Select value={filters.property_type || ""} onChange={(e) => setF("property_type", e.target.value)} placeholder="Any property type" options={opts.lookup("property_type")(meta)} />
            <Select value={filters.team_id || ""} onChange={(e) => setF("team_id", e.target.value)} placeholder="All teams" options={opts.teams(meta)} />
            <Field label="Created from"><Input type="datetime-local" value={filters.created_from || ""} onChange={(e) => setF("created_from", e.target.value)} /></Field>
            <Field label="Created to"><Input type="datetime-local" value={filters.created_to || ""} onChange={(e) => setF("created_to", e.target.value)} /></Field>
            <Select value={filters.converted || ""} onChange={(e) => setF("converted", e.target.value)} placeholder="Converted & open" options={[{ value: "0", label: "Open (not converted)" }, { value: "1", label: "Converted only" }]} />
            <div className="flex items-end"><Checkbox label="Duplicates only" checked={filters.is_duplicate === "1"} onChange={(e) => setF("is_duplicate", e.target.checked ? "1" : "")} /></div>
            {filters.import_job_id && <div className="flex items-end"><Badge tone="violet">Import #{filters.import_job_id} <button type="button" className="ml-1 inline-flex" onClick={() => setF("import_job_id", "")} aria-label="Remove filter"><X className="h-3 w-3" /></button></Badge></div>}
          </div>
        )}

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-3 py-2 text-sm">
            <span className="font-medium text-primary">{selected.length} selected</span>
            {can("leads", "assign") && <Button size="xs" variant="outline" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setBulk("assign")}>Assign</Button>}
            {can("leads", "edit") && <Button size="xs" variant="outline" icon={<Tag className="h-3.5 w-3.5" />} onClick={() => setBulk("status")}>Status</Button>}
            {can("leads", "edit") && <Button size="xs" variant="outline" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setBulk("followup")}>Follow-up</Button>}
            {can("leads", "edit") && <Menu trigger={(t) => <Button size="xs" variant="outline" icon={<Flame className="h-3.5 w-3.5" />} onClick={t}>Priority</Button>}>
              {(c) => ["Hot", "Warm", "Cold"].map((p) => <MenuItem key={p} onClick={() => { c(); bulkSimple("priority", { priority: p }); }}>{p}</MenuItem>)}
            </Menu>}
            {can("leads", "delete") && <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => bulkSimple("delete")}>Delete</Button>}
            <button type="button" className="ml-auto text-xs text-slate-500 hover:underline" onClick={() => setSelected([])}>Clear selection</button>
          </div>
        )}

        {view === "table" ? (<>
          <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort}
            selectable={can("leads", "edit") || can("leads", "assign")} selected={selected} onSelect={setSelected}
            onRowClick={(r) => setPreview(r.id)}
            rowClass={(r) => (r.next_followup_at && new Date(r.next_followup_at) < new Date() ? "border-l-2 border-l-red-400" : "")}
            empty={<Empty title="No leads match these filters" text="Try clearing filters or add a new lead." action={can("leads", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>Add lead</Button>} />} />
          {list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
        </>) : (
          <KanbanBoard leads={list.data?.items || []} loading={list.isFetching} onOpen={setPreview} />
        )}
      </div>

      <Drawer open={preview !== null} onClose={() => setPreview(null)} width="max-w-3xl" title="Lead preview">
        {preview !== null && <LeadPanel leadId={preview} />}
      </Drawer>
      <LeadFormModal open={newOpen} onClose={() => { setNewOpen(false); if (params.get("new")) router.replace("/leads"); }} onSaved={(l) => setPreview(l.id)} />
      <AssignModal ids={selected} open={bulk === "assign"} onClose={() => { setBulk(null); setSelected([]); }} />
      <BulkStatusModal ids={selected} open={bulk === "status"} onClose={() => { setBulk(null); setSelected([]); }} />
      <BulkFollowupModal ids={selected} open={bulk === "followup"} onClose={() => { setBulk(null); setSelected([]); }} />
      <SaveViewModal open={saveViewOpen} onClose={() => setSaveViewOpen(false)} payload={{ filters: { filters, status: statusTab, q: debounced }, columns: visibleCols }} onSaved={() => views.refetch()} />
    </div>
  );
}

function KanbanBoard({ leads, loading, onOpen }: { leads: Row[]; loading: boolean; onOpen: (id: number) => void }) {
  const { meta, can } = useAuth();
  const qc = useQueryClient();
  const [over, setOver] = useState<number | null>(null);
  const [needsReason, setNeedsReason] = useState<Row | null>(null);
  const move = async (leadId: number, statusId: number) => {
    const lead = leads.find((l) => l.id === leadId);
    const st = meta?.statuses.find((s) => s.id === statusId);
    if (!lead || lead.status_id === statusId) return;
    if (st?.requires_reason || st?.sub_statuses.length) { setNeedsReason({ ...lead, status_id: lead.status_id }); return; }
    try { await api.post(`/api/leads/${leadId}/status`, { status_id: statusId }); toast.success(`Moved to ${st?.name}`); qc.invalidateQueries({ queryKey: ["/api/leads"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className={cn("flex gap-3 overflow-x-auto p-3", loading && "opacity-70")}>
      {(meta?.statuses || []).map((s) => {
        const items = leads.filter((l) => l.status_id === s.id);
        return (
          <div key={s.id} onDragOver={(e) => { if (can("leads", "edit")) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { setOver(null); move(Number(e.dataTransfer.getData("lead")), s.id); }}
            className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-slate-50 transition", over === s.id && "ring-2 ring-primary/40")}>
            <div className="flex items-center justify-between rounded-t-xl border-t-4 px-3 py-2" style={{ borderColor: s.color }}>
              <span className="text-sm font-semibold">{s.name}</span><Badge>{items.length}</Badge>
            </div>
            <div className="max-h-[65vh] space-y-2 overflow-y-auto p-2">
              {items.map((l) => (
                <div key={l.id} draggable={can("leads", "edit")} onDragStart={(e) => e.dataTransfer.setData("lead", String(l.id))} onClick={() => onOpen(l.id)}
                  className="cursor-pointer rounded-lg border border-border bg-white p-3 shadow-sm transition hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{l.name}</p><p className="text-xs text-muted">{l.mobile}</p></div>
                    <PriorityDot p={l.priority} />
                  </div>
                  {l.sub_status_name && <p className="mt-1 text-[11px] text-slate-500">{l.sub_status_name}</p>}
                  <p className="mt-1 truncate text-xs text-slate-600">{l.project_name || "No project"}{l.budget_max ? ` · ${money(l.budget_max)}` : ""}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                    <span>{l.assigned_to_name || "Unassigned"}</span><FollowUpCell v={l.next_followup_at} />
                  </div>
                </div>
              ))}
              {!items.length && <p className="py-6 text-center text-xs text-slate-400">Drop leads here</p>}
            </div>
          </div>
        );
      })}
      {needsReason && <StatusModal lead={needsReason} open onClose={() => setNeedsReason(null)} />}
    </div>
  );
}

function PriorityDot({ p }: { p?: string }) {
  return <span title={p} className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", p === "Hot" ? "bg-red-500" : p === "Cold" ? "bg-blue-400" : "bg-amber-400")} />;
}

function BulkStatusModal({ ids, open, onClose }: { ids: number[]; open: boolean; onClose: () => void }) {
  const { meta } = useAuth();
  const qc = useQueryClient();
  const [statusId, setStatusId] = useState("");
  const [subId, setSubId] = useState("");
  const [reason, setReason] = useState("");
  const st = meta?.statuses.find((s) => String(s.id) === statusId);
  const m = useMutation({
    mutationFn: () => api.post("/api/leads/bulk", { action: "status", ids, status_id: Number(statusId), sub_status_id: subId ? Number(subId) : null, loss_reason: reason || null }),
    onSuccess: (r) => { toast.success(`Updated ${r.updated} leads`); qc.invalidateQueries({ queryKey: ["/api/leads"] }); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Change status of ${ids.length} leads`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!statusId} loading={m.isPending} onClick={() => m.mutate()}>Apply</Button></>}>
      <div className="space-y-3">
        <Field label="Status"><Select value={statusId} onChange={(e) => { setStatusId(e.target.value); setSubId(""); }} placeholder="Select…" options={opts.statuses(meta)} /></Field>
        {!!st?.sub_statuses.length && <Field label="Sub-status"><Select value={subId} onChange={(e) => setSubId(e.target.value)} placeholder="Select…" options={st.sub_statuses.map((s) => ({ value: s.id, label: s.name }))} /></Field>}
        {st?.requires_reason && <Field label="Loss reason"><Select value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Select…" options={opts.lookup("loss_reason")(meta)} /></Field>}
      </div>
    </Modal>
  );
}

function BulkFollowupModal({ ids, open, onClose }: { ids: number[]; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [due, setDue] = useState(tomorrowAt(10));
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/api/leads/bulk", { action: "followup", ids, due_at: fromLocalInput(due), notes }),
    onSuccess: (r) => { toast.success(`Follow-ups created for ${r.updated} leads`); qc.invalidateQueries({ queryKey: ["/api/leads"] }); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Schedule follow-up for ${ids.length} leads`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="space-y-3">
        <Field label="Date & time"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function SaveViewModal({ open, onClose, payload, onSaved }: { open: boolean; onClose: () => void; payload: Row; onSaved: () => void }) {
  const { me } = useAuth();
  const [name, setName] = useState("");
  const [vis, setVis] = useState("personal");
  const m = useMutation({
    mutationFn: () => api.post("/api/saved-views", { module: "leads", name, visibility: vis, ...payload }),
    onSuccess: () => { toast.success("View saved"); onSaved(); onClose(); setName(""); },
  });
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Save current view"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} loading={m.isPending} onClick={() => m.mutate()}>Save view</Button></>}>
      <div className="space-y-3">
        <Field label="View name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My hot leads this week" /></Field>
        {(me?.role.level ?? 0) >= 40 && <Field label="Share with"><Select value={vis} onChange={(e) => setVis(e.target.value)} options={[{ value: "personal", label: "Only me" }, { value: "team", label: "My team" }, { value: "company", label: "Whole company" }]} /></Field>}
      </div>
    </Modal>
  );
}

export default function LeadsPage() {
  return <Suspense><LeadBoard /></Suspense>;
}
