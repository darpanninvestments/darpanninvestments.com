"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, FileText, LayoutGrid, List, MapPin, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, money } from "@/lib/utils";
import { DataTable, RowLink, opts, useList, type Column } from "@/components/data";
import { Badge, Button, Empty, IconButton, Input, Loading, PageHeader, Pagination, Select, useConfirm } from "@/components/ui";
import { InventoryBar, ProjectFormModal } from "@/components/projects";

const STATUS_TONE: Record<string, "green" | "blue" | "amber" | "violet" | "slate" | "red"> = {
  Active: "green", "Ready to Move": "blue", Upcoming: "violet", "Pre-Launch": "amber", "Sold Out": "slate", "On Hold": "red",
};
const priceRange = (r: Row) =>
  r.price_min || r.price_max ? `${money(r.price_min)}${r.price_max ? ` – ${money(r.price_max)}` : "+"}` : "—";
const place = (r: Row) => [r.area_name, r.city_name].filter(Boolean).join(", ");

function ProjectsInner() {
  const { can, meta, lookup, me } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [view, setView] = useState<"grid" | "table">("grid");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [processId, setProcessId] = useState(sp.get("process_id") || "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name");
  const [editing, setEditing] = useState<Row | null>(sp.get("new") === "1" && can("projects", "add") ? {} : null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const params = { q: debounced, process_id: processId, status, page, page_size: 24, sort };
  const list = useList("/api/projects", params);
  const rows = list.data?.items || [];

  const closeForm = () => {
    setEditing(null);
    if (sp.get("new")) { const p = new URLSearchParams(sp.toString()); p.delete("new"); router.replace(`${pathname}${p.size ? `?${p}` : ""}`); }
  };
  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete project?", message: <>“{r.name}” will be removed. Leads and properties stay linked to it.</> }))) return;
    await api.del(`/api/projects/${r.id}`);
    toast.success("Project deleted");
    qc.invalidateQueries({ queryKey: ["/api/projects"] });
    qc.invalidateQueries({ queryKey: ["meta"] });
  };

  const actions = (r: Row) => (
    <div className="flex gap-0.5" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
      {can("projects", "edit") && <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
      {can("projects", "delete") && <IconButton title="Delete" tone="red" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
    </div>
  );

  const columns: Column[] = [
    { key: "name", label: "Project", sortable: true, render: (r) => (
      <div><RowLink href={`/projects/${r.id}`}>{r.name}</RowLink>{r.code && <div className="text-xs text-muted">{r.code}</div>}</div>
    ) },
    ...(me?.is_global ? [{ key: "company_name", label: "Company" }] : []),
    { key: "process_name", label: "Process" },
    { key: "location", label: "Location", render: (r) => place(r) || <span className="text-slate-300">—</span> },
    { key: "status", label: "Status", sortable: true, render: (r) => <Badge tone={STATUS_TONE[r.status] || "slate"}>{r.status}</Badge> },
    { key: "price_min", label: "Price range", sortable: true, render: priceRange },
    { key: "inventory", label: "Inventory", render: (r) => <div className="w-44"><InventoryBar inv={r.inventory} /></div> },
    { key: "lead_count", label: "Leads", className: "text-center", headClass: "text-center" },
    { key: "document_count", label: "Docs", className: "text-center", headClass: "text-center" },
    { key: "_a", label: "", render: actions },
  ];

  return (
    <div>
      <PageHeader title="Projects" subtitle="Developments, their inventory and sales collateral"
        actions={can("projects", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ process_id: processId ? Number(processId) : undefined })}>Add project</Button>} />

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Search name, code, developer…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto min-w-[150px]" value={processId} placeholder="All processes" options={opts.processes(meta)}
          onChange={(e) => { setProcessId(e.target.value); setPage(1); }} />
        <Select className="w-auto min-w-[140px]" value={status} placeholder="Any status"
          options={lookup("project_status").map((l) => ({ value: l.value, label: l.name }))} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)}
          options={[{ value: "name", label: "Name A–Z" }, { value: "-created_at", label: "Newest" }, { value: "price_min", label: "Price: low to high" }, { value: "-price_min", label: "Price: high to low" }]} />
        <div className="ml-auto flex rounded-lg border border-border p-0.5">
          {([["grid", LayoutGrid], ["table", List]] as const).map(([v, Icon]) => (
            <button key={v} type="button" title={v === "grid" ? "Card view" : "List view"} onClick={() => setView(v)}
              className={cn("rounded-md p-1.5 transition", view === v ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-100")}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="card">
          <DataTable columns={columns} rows={rows} loading={list.isFetching} sort={sort} onSort={setSort}
            onRowClick={(r) => router.push(`/projects/${r.id}`)} empty={<Empty title="No projects found" />} />
        </div>
      ) : list.isLoading ? <Loading /> : !rows.length ? (
        <div className="card"><Empty icon={<Building2 className="h-6 w-6" />} title="No projects found"
          text={can("projects", "add") ? "Create your first project to start tracking inventory." : undefined} /></div>
      ) : (
        <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", list.isFetching && "opacity-70")}>
          {rows.map((r) => (
            <Link key={r.id} href={`/projects/${r.id}`} className="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-primary">{r.name}</h3>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {[r.code, r.process_name, me?.is_global ? r.company_name : null].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[r.status] || "slate"}>{r.status}</Badge>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-slate-600">
                <p className="flex items-center gap-1.5 truncate"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />{place(r) || "Location not set"}</p>
                <p className="font-semibold text-slate-900">{priceRange(r)}</p>
                {r.developer && <p className="truncate text-xs text-muted">by {r.developer}</p>}
              </div>
              <div className="mt-3"><InventoryBar inv={r.inventory} /></div>
              <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600" style={{ marginTop: 12 }}>
                <div className="flex gap-3">
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-slate-400" />{r.lead_count} leads</span>
                  <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-slate-400" />{r.document_count} docs</span>
                </div>
                {actions(r)}
              </div>
            </Link>
          ))}
        </div>
      )}
      {list.data && list.data.total > 0 && (
        <div className="card mt-3">
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />
        </div>
      )}
      <ProjectFormModal value={editing} onClose={closeForm} />
    </div>
  );
}

export default function ProjectsPage() {
  return <Suspense><ProjectsInner /></Suspense>;
}
