"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth, type Meta } from "@/lib/auth";
import { cn, fromLocalInput, toLocalInput } from "@/lib/utils";
import {
  Button, Checkbox, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Pagination, Select, Textarea,
  Toggle, useConfirm,
} from "./ui";

// ── DataTable ──────────────────────────────────────────────────────────────────
export type Column<T = Row> = {
  key: string;
  label: ReactNode;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  headClass?: string;
  /** phone layout: "title" = card heading, "footer" = actions row, "hide" = omit (default: detail grid) */
  mobile?: "title" | "footer" | "hide";
};

const isFooter = (c: { key: string; mobile?: Column["mobile"] }) => c.mobile === "footer" || (c.mobile === undefined && (c.key === "_actions" || c.key === "actions"));

export function DataTable<T extends Row>({
  columns, rows, loading, sort, onSort, selectable, selected, onSelect, onRowClick, empty, rowClass, dense,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean; sort?: string; onSort?: (s: string) => void;
  selectable?: boolean; selected?: number[]; onSelect?: (ids: number[]) => void; onRowClick?: (row: T) => void;
  empty?: ReactNode; rowClass?: (row: T) => string; dense?: boolean;
}) {
  const allIds = rows.map((r) => r.id as number);
  const allSelected = selectable && rows.length > 0 && allIds.every((id) => selected?.includes(id));
  const toggle = (id: number) =>
    onSelect?.(selected?.includes(id) ? selected.filter((x) => x !== id) : [...(selected || []), id]);
  if (loading && !rows.length) return <Loading />;
  if (!rows.length) return <>{empty ?? <Empty />}</>;
  const pad = dense ? "px-3 py-2" : "px-3 py-2.5";
  const titleCol = columns.find((c) => c.mobile === "title") || columns.find((c) => !isFooter(c) && c.mobile !== "hide");
  const detailCols = columns.filter((c) => c !== titleCol && !isFooter(c) && c.mobile !== "hide").slice(0, 6);
  const footerCols = columns.filter(isFooter);
  const cell = (c: Column<T>, r: T) => (c.render ? c.render(r) : (r[c.key] ?? <span className="text-slate-300">—</span>));
  return (
    <>
    {/* phones: card list */}
    <ul className={cn("divide-y divide-slate-100 md:hidden", loading && "opacity-60")}>
      {rows.map((r) => (
        <li key={r.id} onClick={() => onRowClick?.(r)}
          className={cn("flex gap-3 px-4 py-3.5 active:bg-slate-50", onRowClick && "cursor-pointer", selected?.includes(r.id) && "bg-primary-soft/60", rowClass?.(r))}>
          {selectable && (
            <input type="checkbox" aria-label="Select" className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]" checked={!!selected?.includes(r.id)}
              onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} />
          )}
          <div className="min-w-0 flex-1">
            {titleCol && <div className="min-w-0 text-[15px] font-medium text-slate-900">{cell(titleCol, r)}</div>}
            {detailCols.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {detailCols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</dt>
                    <dd className="mt-0.5 min-w-0 break-words text-slate-700">{cell(c, r)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {footerCols.map((c) => (
              <div key={c.key} className="-mx-1 mt-2.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2" onClick={(e) => e.stopPropagation()}>{cell(c, r)}</div>
            ))}
          </div>
        </li>
      ))}
    </ul>
    {/* tablet & desktop: table */}
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-slate-50/80 text-left text-xs font-medium text-slate-500">
            {selectable && (
              <th className="w-9 px-3 py-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={!!allSelected}
                  onChange={() => onSelect?.(allSelected ? (selected || []).filter((x) => !allIds.includes(x)) : Array.from(new Set([...(selected || []), ...allIds])))} />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.replace("-", "") === c.key;
              return (
                <th key={c.key} className={cn("whitespace-nowrap px-3 py-2", c.headClass)}>
                  {c.sortable && onSort ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-slate-800"
                      onClick={() => onSort(active && !sort?.startsWith("-") ? `-${c.key}` : c.key)}>
                      {c.label}
                      {active && (sort?.startsWith("-") ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={cn(loading && "opacity-60")}>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onRowClick?.(r)}
              className={cn("border-b border-slate-100 transition last:border-0 hover:bg-slate-50/70", onRowClick && "cursor-pointer",
                selected?.includes(r.id) && "bg-primary-soft/60", rowClass?.(r))}>
              {selectable && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={!!selected?.includes(r.id)} onChange={() => toggle(r.id)} />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={cn(pad, "align-middle", c.className)}>
                  {c.render ? c.render(r) : (r[c.key] ?? <span className="text-slate-300">—</span>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

// ── List hook ──────────────────────────────────────────────────────────────────
export function useList<T = Row>(endpoint: string, params: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: [endpoint, params],
    queryFn: () => api.get<Paged<T>>(endpoint, params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// ── Dynamic form fields ────────────────────────────────────────────────────────
export type Opt = { value: string | number; label: string };
export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "email" | "tel" | "textarea" | "select" | "checkbox" | "date" | "datetime" | "color" | "url" | "password";
  options?: Opt[] | ((meta: Meta | undefined, form: Row) => Opt[]);
  required?: boolean;
  span?: 1 | 2;
  placeholder?: string;
  hint?: string;
  hidden?: (form: Row, ctx: { isGlobal: boolean; editing: boolean }) => boolean;
  default?: unknown;
  onChange?: (value: unknown, form: Row) => Row;
};

export function FormFields({ fields, value, onChange, errors }:
  { fields: FieldDef[]; value: Row; onChange: (v: Row) => void; errors?: Record<string, string> }) {
  const { meta, me } = useAuth();
  const set = (f: FieldDef, v: unknown) => {
    let next = { ...value, [f.key]: v };
    if (f.onChange) next = { ...next, ...f.onChange(v, next) };
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.filter((f) => !f.hidden?.(value, { isGlobal: !!me?.is_global, editing: !!value.id })).map((f) => {
        const v = value[f.key];
        const opts = typeof f.options === "function" ? f.options(meta, value) : f.options || [];
        const common = { id: f.key, required: f.required, placeholder: f.placeholder };
        let control: ReactNode;
        switch (f.type) {
          case "textarea":
            control = <Textarea {...common} value={v ?? ""} onChange={(e) => set(f, e.target.value)} />;
            break;
          case "select":
            control = <Select {...common} value={v ?? ""} placeholder={f.placeholder ?? "Select…"} options={opts}
              onChange={(e) => set(f, e.target.value === "" ? null : (isNaN(Number(e.target.value)) || typeof opts[0]?.value === "string" ? e.target.value : Number(e.target.value)))} />;
            break;
          case "checkbox":
            control = <div className="pt-1"><Toggle checked={!!v} onChange={(c) => set(f, c)} label={f.placeholder} /></div>;
            break;
          case "datetime":
            control = <Input type="datetime-local" {...common} value={toLocalInput(v)} onChange={(e) => set(f, fromLocalInput(e.target.value))} />;
            break;
          case "date":
            control = <Input type="date" {...common} value={(v || "").slice(0, 10)} onChange={(e) => set(f, e.target.value ? `${e.target.value}T00:00:00Z` : null)} />;
            break;
          case "color":
            control = <div className="flex gap-2"><input type="color" className="h-9 w-12 rounded border border-border" value={v || "#3b82f6"} onChange={(e) => set(f, e.target.value)} /><Input value={v ?? ""} onChange={(e) => set(f, e.target.value)} /></div>;
            break;
          case "number":
            control = <Input type="number" step="any" {...common} value={v ?? ""} onChange={(e) => set(f, e.target.value === "" ? null : Number(e.target.value))} />;
            break;
          default:
            control = <Input type={f.type || "text"} {...common} value={v ?? ""} onChange={(e) => set(f, e.target.value)} />;
        }
        return (
          <Field key={f.key} htmlFor={f.key} label={f.label} required={f.required} error={errors?.[f.key]} hint={f.hint}
            className={f.span === 2 || f.type === "textarea" ? "sm:col-span-2" : ""}>{control}</Field>
        );
      })}
    </div>
  );
}

/** Mount a modal's body only while open, so its state initialises fresh each time it opens. */
export function whenOpen<P extends { open: boolean }>(Body: React.ComponentType<P>) {
  function WhenOpen(props: P) {
    return props.open ? <Body {...props} /> : null;
  }
  return WhenOpen;
}

export function defaultsOf(fields: FieldDef[]): Row {
  return Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
}

// ── Generic resource page ──────────────────────────────────────────────────────
export type FilterDef = { key: string; label: string; options: Opt[] | ((meta: Meta | undefined) => Opt[]) };

export type ResourceConfig = {
  title: string;
  subtitle?: string;
  endpoint: string;
  module: string;
  writeAction?: string; // e.g. "configure" for masters guarded by settings.configure
  columns: Column[];
  fields: FieldDef[];
  filters?: FilterDef[];
  baseParams?: Record<string, unknown>;
  defaultSort?: string;
  searchPlaceholder?: string;
  rowLink?: (row: Row) => string;
  rowActions?: (row: Row, refresh: () => void) => ReactNode;
  headerActions?: ReactNode;
  exportModule?: string;
  noun?: string;
  modalSize?: "sm" | "md" | "lg" | "xl";
  transformOut?: (form: Row) => Row;
  editable?: (row: Row) => boolean;
  showCompanyFilter?: boolean;
};

export function ResourcePage({ cfg }: { cfg: ResourceConfig }) {
  const { can, me, meta } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState(cfg.defaultSort || "");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const params = { ...cfg.baseParams, q: debounced, page, page_size: pageSize, sort, ...filters };
  const list = useList(cfg.endpoint, params);
  const wa = cfg.writeAction;
  const canAdd = can(cfg.module, wa || "add");
  const canEdit = can(cfg.module, wa || "edit");
  const canDelete = can(cfg.module, wa || "delete");
  const noun = cfg.noun || cfg.title.replace(/s$/, "");
  const refresh = () => { qc.invalidateQueries({ queryKey: [cfg.endpoint] }); qc.invalidateQueries({ queryKey: ["meta"] }); };

  const save = useMutation({
    mutationFn: (data: Row) => {
      const body = cfg.transformOut ? cfg.transformOut(data) : data;
      return data.id ? api.patch(`${cfg.endpoint}/${data.id}`, body) : api.post(cfg.endpoint, body);
    },
    onSuccess: (_r, v) => { toast.success(`${noun} ${v.id ? "updated" : "created"}`); setEditing(null); refresh(); },
  });
  const remove = async (row: Row) => {
    if (!(await confirm({ title: `Delete ${noun.toLowerCase()}?`, message: <>“{row.name || row.title || row.code || row.label}” will be removed.</> }))) return;
    try { await api.del(`${cfg.endpoint}/${row.id}`); toast.success("Deleted"); refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  const bulkDelete = async () => {
    if (!(await confirm({ title: `Delete ${selected.length} records?` }))) return;
    const r = await api.post(`${cfg.endpoint}/bulk-delete`, { ids: selected });
    toast.success(`Deleted ${r.deleted}`); setSelected([]); refresh();
  };
  const exportFile = async (format: "xlsx" | "csv") => {
    try { await api.download(`/api/exports/${cfg.exportModule}`, { format, filters: { ...cfg.baseParams, q: debounced, ...filters } }); }
    catch (e) { toast.error((e as Error).message); }
  };

  const cols: Column[] = useMemo(() => [
    ...cfg.columns,
    ...((canEdit || canDelete || cfg.rowActions) ? [{
      key: "_actions", label: "", headClass: "w-24", className: "text-right",
      render: (r: Row) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {cfg.rowActions?.(r, refresh)}
          {canEdit && (cfg.editable?.(r) ?? true) && <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
          {canDelete && (cfg.editable?.(r) ?? true) && <IconButton title="Delete" tone="red" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
        </div>
      ),
    }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cfg, canEdit, canDelete]);

  const allFilters: FilterDef[] = [
    ...(cfg.showCompanyFilter && me?.is_global ? [{ key: "company_id", label: "All companies", options: (m: Meta | undefined) => (m?.companies || []).map((c) => ({ value: c.id, label: c.name })) }] : []),
    ...(cfg.filters || []),
  ];

  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} actions={<>
        {cfg.headerActions}
        {cfg.exportModule && can(cfg.exportModule, "export") && (
          <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => exportFile("xlsx")}>Export</Button>
        )}
        {canAdd && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(defaultsOf(cfg.fields))}>Add {noun}</Button>}
      </>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder={cfg.searchPlaceholder || "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {allFilters.map((f) => {
            const opts = typeof f.options === "function" ? f.options(meta) : f.options;
            return (
              <Select key={f.key} className="w-auto min-w-[140px]" value={filters[f.key] || ""} placeholder={f.label} options={opts}
                onChange={(e) => { setFilters({ ...filters, [f.key]: e.target.value }); setPage(1); }} />
            );
          })}
          {selected.length > 0 && canDelete && (
            <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={bulkDelete}>Delete {selected.length}</Button>
          )}
        </div>
        <DataTable columns={cols} rows={list.data?.items || []} loading={list.isFetching} sort={sort}
          onSort={(s) => setSort(s)} selectable={canDelete} selected={selected} onSelect={setSelected}
          onRowClick={cfg.rowLink ? undefined : canEdit ? (r) => (cfg.editable?.(r) ?? true) && setEditing(r) : undefined}
          empty={<Empty title={`No ${cfg.title.toLowerCase()} found`} text={canAdd ? `Click “Add ${noun}” to create one.` : undefined} />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      <ResourceForm cfg={cfg} value={editing} onClose={() => setEditing(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} />
    </div>
  );
}

type ResourceFormProps = { cfg: Pick<ResourceConfig, "fields" | "noun" | "title" | "modalSize">; value: Row | null; onClose: () => void; onSave: (v: Row) => void; saving?: boolean };

export function ResourceForm(props: ResourceFormProps) {
  return props.value ? <ResourceFormBody key={props.value.id ?? "new"} {...props} /> : null;
}

function ResourceFormBody({ cfg, value, onClose, onSave, saving }: ResourceFormProps) {
  const [form, setForm] = useState<Row>(value || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { me } = useAuth();
  const noun = cfg.noun || cfg.title.replace(/s$/, "");
  const submit = () => {
    const errs: Record<string, string> = {};
    cfg.fields.forEach((f) => {
      if (f.required && !f.hidden?.(form, { isGlobal: !!me?.is_global, editing: !!form.id }) && (form[f.key] === undefined || form[f.key] === null || form[f.key] === ""))
        errs[f.key] = `${f.label} is required`;
    });
    setErrors(errs);
    if (!Object.keys(errs).length) onSave(form);
  };
  return (
    <Modal open={!!value} onClose={onClose} title={`${form.id ? "Edit" : "New"} ${noun.toLowerCase()}`} size={cfg.modalSize}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={submit}>{form.id ? "Save changes" : `Create ${noun.toLowerCase()}`}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormFields fields={cfg.fields} value={form} onChange={setForm} errors={errors} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// ── Shared option builders ─────────────────────────────────────────────────────
export const opts = {
  companies: (m?: Meta) => (m?.companies || []).map((c) => ({ value: c.id, label: c.name })),
  users: (m?: Meta) => (m?.users || []).map((u) => ({ value: u.id, label: u.name })),
  projects: (m?: Meta) => (m?.projects || []).map((p) => ({ value: p.id, label: p.name })),
  processes: (m?: Meta) => (m?.processes || []).map((p) => ({ value: p.id, label: p.name })),
  sources: (m?: Meta) => (m?.sources || []).map((s) => ({ value: s.id, label: s.name })),
  statuses: (m?: Meta) => (m?.statuses || []).map((s) => ({ value: s.id, label: s.name })),
  teams: (m?: Meta) => (m?.teams || []).map((t) => ({ value: t.id, label: t.name })),
  lookup: (type: string) => (m?: Meta) => (m?.lookups?.[type] || []).map((l) => ({ value: l.value, label: l.name })),
  list: (...vals: string[]) => vals.map((v) => ({ value: v, label: v })),
};

export const companyField: FieldDef = {
  key: "company_id", label: "Company", type: "select", options: opts.companies, required: true,
  hidden: (_f, c) => !c.isGlobal || c.editing,
};

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{children}</Link>;
}

export { Checkbox };
