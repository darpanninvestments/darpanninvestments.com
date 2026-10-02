"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { Badge, Button, Empty, IconButton, Input, Loading, PageHeader, Pagination, Select, useConfirm } from "@/components/ui";
import { DataTable, ResourceForm, useList, type Column, type FieldDef } from "@/components/data";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

const fields: FieldDef[] = [
  { key: "name", label: "Company name", required: true },
  { key: "code", label: "Code", placeholder: "Auto-generated if blank", hint: "Short unique code, e.g. DARPANN" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "address", label: "Address", type: "textarea" },
  { key: "logo_url", label: "Logo URL", type: "url", span: 2, placeholder: "https://…" },
  { key: "timezone", label: "Timezone", type: "select", options: TIMEZONES.map((t) => ({ value: t, label: t })), default: "Asia/Kolkata" },
  { key: "currency", label: "Currency", type: "select", options: ["INR", "USD", "AED", "GBP", "EUR", "SGD"].map((c) => ({ value: c, label: c })), default: "INR" },
  { key: "is_active", label: "Active", type: "checkbox", default: true, placeholder: "Users can sign in", hidden: (_f, c) => !c.isGlobal },
];

export default function CompaniesPage() {
  return <Suspense fallback={<Loading />}><Companies /></Suspense>;
}

function Companies() {
  const { can, me } = useAuth();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("name");
  const [active, setActive] = useState("");
  const defaults = Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
  const [editing, setEditing] = useState<Row | null>(() => (sp.get("new") === "1" ? defaults : null));
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const list = useList("/api/companies", { q: debounced, page, page_size: pageSize, sort, is_active: active });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/companies"] }); qc.invalidateQueries({ queryKey: ["meta"] }); qc.invalidateQueries({ queryKey: ["me"] }); };
  const canAdd = can("companies", "add") && !!me?.is_global;
  const canEdit = can("companies", "edit");
  const canDelete = can("companies", "delete");

  const save = useMutation({
    mutationFn: (d: Row) => {
      const body = Object.fromEntries(fields.map((f) => [f.key, d[f.key] === "" ? null : d[f.key]]).filter(([, v]) => v !== undefined));
      return d.id ? api.patch(`/api/companies/${d.id}`, body) : api.post("/api/companies", body);
    },
    onSuccess: (_r, v) => { toast.success(v.id ? "Company updated" : "Company created"); setEditing(null); refresh(); },
  });
  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete company?", message: <>“{r.name}” will be deactivated and hidden. Its {r.user_count} users will no longer be able to sign in.</>, confirmText: "Delete" }))) return;
    await api.del(`/api/companies/${r.id}`);
    toast.success("Company deleted"); refresh();
  };

  const columns: Column[] = [
    { key: "name", label: "Company", sortable: true, render: (r) => (
      <div className="flex items-center gap-2.5">
        {r.logo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={r.logo_url} alt="" className="h-8 w-8 rounded-lg border border-border object-contain" />
          : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary"><Building2 className="h-4 w-4" /></span>}
        <div>
          <div className="font-medium text-slate-800">{r.name}</div>
          <div className="font-mono text-[11px] text-muted">{r.code}</div>
        </div>
      </div>
    ) },
    { key: "email", label: "Email", sortable: true },
    { key: "phone", label: "Phone" },
    { key: "timezone", label: "Timezone", render: (r) => <span className="text-xs">{r.timezone} · {r.currency}</span> },
    { key: "user_count", label: "Users", render: (r) => <Badge tone="blue">{r.user_count}</Badge> },
    { key: "lead_count", label: "Leads", render: (r) => <Badge tone="violet">{r.lead_count}</Badge> },
    { key: "is_active", label: "Status", render: (r) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "created_at", label: "Created", sortable: true, render: (r) => <span className="text-xs text-muted">{fmtDate(r.created_at)}</span> },
    ...((canEdit || canDelete) ? [{ key: "_a", label: "", className: "text-right", render: (r: Row) => (
      <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {canEdit && <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
        {canDelete && <IconButton title="Delete" tone="red" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
      </div>
    ) }] : []),
  ];

  if (!can("companies")) return <Empty title="No access" text="You do not have permission to view companies." />;
  return (
    <div>
      <PageHeader title="Companies" subtitle="Tenant companies using this CRM"
        actions={canAdd && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(defaults)}>Add company</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto min-w-[120px]" placeholder="Any status" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}
            options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} />
        </div>
        <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort}
          onRowClick={canEdit ? (r) => setEditing(r) : undefined} empty={<Empty title="No companies found" />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      <ResourceForm cfg={{ fields, title: "Companies", noun: "Company", modalSize: "lg" }} value={editing} onClose={() => setEditing(null)}
        onSave={(v) => save.mutate(v)} saving={save.isPending} />
    </div>
  );
}
