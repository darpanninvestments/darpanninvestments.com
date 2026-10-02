"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Search, Share2, Upload, X } from "lucide-react";
import { type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate } from "@/lib/utils";
import { DataTable, RowLink, opts, useList, type Column } from "@/components/data";
import { Badge, Button, Empty, IconButton, Input, PageHeader, Pagination, Select, Tabs } from "@/components/ui";
import {
  DOC_STATUSES, DocStatus, DocumentActions, DocumentShareModal, DocumentUploadModal, fileSize, previewUrl,
} from "@/components/documents";

function DocumentsInner() {
  const { can, meta, lookup } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [scope, setScope] = useState("project");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [projectId, setProjectId] = useState(sp.get("project_id") || "");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("-created_at");
  const [selected, setSelected] = useState<number[]>([]);
  const [uploading, setUploading] = useState(sp.get("new") === "1" && can("documents", "add"));
  const [sharing, setSharing] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const list = useList("/api/documents", {
    scope: scope === "all" ? undefined : scope, q: debounced, project_id: projectId, category, status, page, page_size: pageSize, sort,
  });
  const rows = list.data?.items || [];
  const closeUpload = () => {
    setUploading(false);
    if (sp.get("new")) { const p = new URLSearchParams(sp.toString()); p.delete("new"); router.replace(`${pathname}${p.size ? `?${p}` : ""}`); }
  };
  const reset = () => { setPage(1); setSelected([]); };

  const columns: Column[] = [
    { key: "title", label: "Title", sortable: true, render: (r) => (
      <div className="max-w-[260px]">
        {r.has_file ? <a href={previewUrl(r.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="block truncate font-medium text-slate-800 hover:text-primary hover:underline">{r.title}</a>
          : <span className="block truncate font-medium text-slate-800">{r.title}</span>}
      </div>
    ) },
    { key: "file_name", label: "File", render: (r) => r.file_name ? <span className="block max-w-[200px] truncate text-xs text-muted" title={r.file_name}>{r.file_name}</span> : <Badge tone="amber">Not uploaded</Badge> },
    { key: "category", label: "Category", sortable: true, render: (r) => <Badge>{r.category}</Badge> },
    { key: "linked", label: "Project / Client", render: (r) => (
      <div className="text-xs">
        {r.project_name && <RowLink href={`/projects/${r.project_id}`}>{r.project_name}</RowLink>}
        {r.client_name && <div><RowLink href={`/clients/${r.client_id}`}>{r.client_name}</RowLink></div>}
        {!r.project_name && !r.client_name && (r.lead_id ? <RowLink href={`/leads/${r.lead_id}`}>Lead #{r.lead_id}</RowLink> : <span className="text-slate-300">—</span>)}
      </div>
    ) },
    { key: "version", label: "Ver.", sortable: true, render: (r) => <span className="text-xs">v{r.version}</span> },
    { key: "size_bytes", label: "Size", sortable: true, render: (r) => <span className="text-xs text-muted">{fileSize(r.size_bytes)}</span> },
    { key: "uploaded_by_name", label: "Uploaded by", render: (r) => <span className="text-xs">{r.uploaded_by_name || "—"}</span> },
    { key: "created_at", label: "Date", sortable: true, render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</span> },
    { key: "expires_at", label: "Expiry", sortable: true, render: (r) => r.expires_at
      ? <span className={cn("whitespace-nowrap text-xs", r.is_expired ? "font-semibold text-danger" : "text-slate-600")}>{r.is_expired ? "Expired " : ""}{fmtDate(r.expires_at)}</span>
      : <span className="text-slate-300">—</span> },
    { key: "status", label: "Status", sortable: true, render: (r: Row) => <DocStatus doc={r} /> },
    { key: "_a", label: "", render: (r) => <DocumentActions doc={r} /> },
  ];

  return (
    <div>
      <PageHeader title="Documents" subtitle="Project collateral and client paperwork in one place" actions={
        can("documents", "add") && <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>Upload</Button>
      } />
      <Tabs className="mb-3" value={scope} onChange={(v) => { setScope(v); reset(); }} tabs={[
        { value: "project", label: "Project Documents" },
        { value: "client", label: "Client Documents" },
        { value: "all", label: "All" },
      ]} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search title or file name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto min-w-[150px]" value={projectId} placeholder="All projects" options={opts.projects(meta)} onChange={(e) => { setProjectId(e.target.value); reset(); }} />
          <Select className="w-auto min-w-[140px]" value={category} placeholder="All categories"
            options={lookup("document_category").map((l) => ({ value: l.value, label: l.name }))} onChange={(e) => { setCategory(e.target.value); reset(); }} />
          <Select className="w-auto min-w-[120px]" value={status} placeholder="Any status" options={DOC_STATUSES.map((s) => ({ value: s, label: s }))} onChange={(e) => { setStatus(e.target.value); reset(); }} />
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/50 px-3 py-2 text-sm">
            <span className="font-medium text-primary">{selected.length} selected</span>
            <IconButton title="Clear selection" onClick={() => setSelected([])}><X className="h-3.5 w-3.5" /></IconButton>
            {can("documents", "share") && <Button size="sm" variant="success" icon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(true)}>Share</Button>}
          </div>
        )}
        <DataTable columns={columns} rows={rows} loading={list.isFetching} sort={sort} onSort={setSort} dense
          selectable={can("documents", "share")} selected={selected} onSelect={setSelected}
          empty={<Empty icon={<FileText className="h-6 w-6" />} title="No documents found" text={can("documents", "add") ? "Upload brochures, price lists, agreements and KYC files." : undefined} />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      <DocumentUploadModal open={uploading} onClose={closeUpload} />
      <DocumentShareModal open={sharing} onClose={() => { setSharing(false); setSelected([]); }} documentIds={selected} />
    </div>
  );
}

export default function DocumentsPage() {
  return <Suspense><DocumentsInner /></Suspense>;
}
