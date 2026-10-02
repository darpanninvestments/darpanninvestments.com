"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Home, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/utils";
import { DataTable, RowLink, opts, useList, type Column } from "@/components/data";
import { Button, Empty, IconButton, Input, PageHeader, Pagination, Select, StatusPill, useConfirm } from "@/components/ui";
import { AVAILABILITY, PropertyFormModal } from "@/components/projects";

function PropertiesInner() {
  const { can, meta, lookup } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [projectId, setProjectId] = useState(sp.get("project_id") || "");
  const [availability, setAvailability] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState("code");
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkAvail, setBulkAvail] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [editing, setEditing] = useState<Row | null>(
    sp.get("new") === "1" && can("properties", "add") ? { project_id: sp.get("project_id") ? Number(sp.get("project_id")) : undefined } : null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const filters = { q: debounced, project_id: projectId, availability, property_type: type };
  const list = useList("/api/properties", { ...filters, page, page_size: pageSize, sort });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/properties"] }); qc.invalidateQueries({ queryKey: ["/api/projects"] }); };

  const bulk = useMutation({
    mutationFn: (data: Row) => api.post("/api/properties/bulk-update", { ids: selected, data }),
    onSuccess: (r) => { toast.success(`Updated ${r.updated} properties`); setSelected([]); setBulkAvail(""); setBulkPrice(""); refresh(); },
  });
  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete property?", message: <>“{r.code}” will be removed.</> }))) return;
    await api.del(`/api/properties/${r.id}`);
    toast.success("Property deleted");
    refresh();
  };
  const bulkDelete = async () => {
    if (!(await confirm({ title: `Delete ${selected.length} properties?` }))) return;
    const r = await api.post("/api/properties/bulk-delete", { ids: selected });
    toast.success(`Deleted ${r.deleted}`); setSelected([]); refresh();
  };
  const exportFile = async () => {
    try { await api.download("/api/exports/properties", { format: "xlsx", filters }, "properties.xlsx"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const closeForm = () => {
    setEditing(null);
    if (sp.get("new")) { const p = new URLSearchParams(sp.toString()); p.delete("new"); router.replace(`${pathname}${p.size ? `?${p}` : ""}`); }
  };
  const canEdit = can("properties", "edit");
  const canDelete = can("properties", "delete");

  const columns: Column[] = [
    { key: "code", label: "Code", sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.code}</span> },
    { key: "project_name", label: "Project", render: (r) => <RowLink href={`/projects/${r.project_id}`}>{r.project_name}</RowLink> },
    { key: "unit_no", label: "Unit", sortable: true },
    { key: "property_type", label: "Type", sortable: true },
    { key: "size", label: "Size", sortable: true, render: (r) => r.size ? `${Number(r.size).toLocaleString("en-IN")} ${r.size_unit || ""}` : "—" },
    { key: "facing", label: "Facing" },
    { key: "bedrooms", label: "Bed / Bath", render: (r) => r.bedrooms || r.bathrooms ? `${r.bedrooms ?? "–"} / ${r.bathrooms ?? "–"}` : "—" },
    { key: "base_price", label: "Base price", sortable: true, render: (r) => money(r.base_price) },
    { key: "offer_price", label: "Offer price", sortable: true, render: (r) => r.offer_price ? <span className="font-medium text-emerald-700">{money(r.offer_price)}</span> : "—" },
    { key: "price_status", label: "Price status" },
    { key: "availability", label: "Availability", sortable: true, render: (r) => <StatusPill value={r.availability} /> },
    ...(canEdit || canDelete ? [{
      key: "_a", label: "", className: "text-right", render: (r: Row) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
          {canDelete && <IconButton title="Delete" tone="red" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
        </div>
      ),
    }] : []),
  ];
  const availOpts = AVAILABILITY.map((a) => ({ value: a, label: a }));

  return (
    <div>
      <PageHeader title="Properties" subtitle="Unit-level inventory across all projects" actions={<>
        {can("properties", "export") && <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportFile}>Export</Button>}
        {can("properties", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ project_id: projectId ? Number(projectId) : undefined })}>Add property</Button>}
      </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search code, unit, type…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto min-w-[150px]" value={projectId} placeholder="All projects" options={opts.projects(meta)} onChange={(e) => { setProjectId(e.target.value); setPage(1); }} />
          <Select className="w-auto min-w-[140px]" value={availability} placeholder="Any availability" options={availOpts} onChange={(e) => { setAvailability(e.target.value); setPage(1); }} />
          <Select className="w-auto min-w-[130px]" value={type} placeholder="All types" options={lookup("property_type").map((l) => ({ value: l.value, label: l.name }))} onChange={(e) => { setType(e.target.value); setPage(1); }} />
        </div>
        {selected.length > 0 && (canEdit || canDelete) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/50 px-3 py-2 text-sm">
            <span className="font-medium text-primary">{selected.length} selected</span>
            <IconButton title="Clear selection" onClick={() => setSelected([])}><X className="h-3.5 w-3.5" /></IconButton>
            {canEdit && <>
              <Select className="h-8 w-auto py-1 text-xs" value={bulkAvail} placeholder="Set availability…" options={availOpts} onChange={(e) => setBulkAvail(e.target.value)} />
              <Button size="sm" disabled={!bulkAvail} loading={bulk.isPending && !!bulkAvail} onClick={() => bulk.mutate({ availability: bulkAvail })}>Apply</Button>
              <Input className="h-8 w-40 py-1 text-xs" placeholder="Price status…" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!bulkPrice.trim()} onClick={() => bulk.mutate({ price_status: bulkPrice.trim() })}>Set price status</Button>
            </>}
            {canDelete && <Button size="sm" variant="danger" className="ml-auto" icon={<Trash2 className="h-4 w-4" />} onClick={bulkDelete}>Delete</Button>}
          </div>
        )}
        <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort} dense
          selectable={canEdit || canDelete} selected={selected} onSelect={setSelected}
          onRowClick={canEdit ? setEditing : undefined}
          empty={<Empty icon={<Home className="h-6 w-6" />} title="No properties found" text={can("properties", "add") ? "Click “Add property” to create inventory." : undefined} />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      <PropertyFormModal value={editing} onClose={closeForm} />
    </div>
  );
}

export default function PropertiesPage() {
  return <Suspense><PropertiesInner /></Suspense>;
}
