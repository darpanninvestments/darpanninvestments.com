"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, humanize } from "@/lib/utils";
import { Badge, Button, Checkbox, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Toggle, useConfirm } from "@/components/ui";
import { opts, useList } from "@/components/data";
import type { SectionProps } from "./shared";

const EP = "/api/lead-statuses";
const CATEGORY_TONE: Record<string, "blue" | "green" | "red" | "slate"> = { open: "blue", won: "green", lost: "red", invalid: "slate" };

export function StatusesSection({ companyId, canConfigure }: SectionProps) {
  const { me, meta } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isGlobal = !!me?.is_global;
  const list = useList(EP, { page_size: 0, sort: "sort_order" });
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = list.data?.items || [];
  const editable = (r: Row) => canConfigure && (isGlobal || r.company_id != null);
  const refresh = () => { qc.invalidateQueries({ queryKey: [EP] }); qc.invalidateQueries({ queryKey: ["meta"] }); };
  const nameOf = (id: number) => rows.find((r) => r.id === id)?.name;

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id as number);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setBusy(true);
    try { await api.post(`${EP}/reorder`, { ids }); refresh(); } finally { setBusy(false); }
  };
  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete status?", message: <>“{r.name}” and its sub-statuses will be permanently deleted.</>, confirmText: "Delete" }))) return;
    await api.del(`${EP}/${r.id}`);
    toast.success("Status deleted"); refresh();
  };

  return (
    <div>
      <PageHeader title="Lead Statuses" subtitle="Order defines the pipeline (use the arrows). Each status can have sub-statuses and restrict which statuses can follow it."
        actions={canConfigure && <Button size="sm" icon={<Plus className="h-4 w-4" />}
          onClick={() => setEditing({ color: "#3B82F6", category: "open", is_active: true, requires_reason: false, allowed_next_ids: [], company_id: companyId })}>Add status</Button>} />
      <div className="card overflow-hidden">
        {list.isLoading ? <Loading /> : !rows.length ? <Empty title="No statuses yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                  <th className="w-16 px-2 py-2">Order</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Rules</th>
                  <th className="px-3 py-2">Allowed next</th>
                  <th className="px-3 py-2">Leads</th>
                  {isGlobal && <th className="px-3 py-2">Applies to</th>}
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const canEdit = editable(r);
                  const expanded = open === r.id;
                  const next: number[] = r.allowed_next_ids || [];
                  return [
                    <tr key={r.id} className={cn("border-b border-slate-100 hover:bg-slate-50/70", !r.is_active && "opacity-60")}>
                      <td className="px-2 py-2">
                        <div className="flex">
                          <IconButton title="Move up" disabled={!canEdit || busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                          <IconButton title="Move down" disabled={!canEdit || busy || i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen(expanded ? null : r.id)}>
                          {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10" style={{ background: r.color }} />
                          <span className="font-medium text-slate-800">{r.name}</span>
                          <span className="text-xs text-muted">{r.sub_statuses?.length || 0} sub</span>
                          {r.company_id == null && !isGlobal && <Lock className="h-3 w-3 text-slate-400" aria-label="System status" />}
                        </button>
                      </td>
                      <td className="px-3 py-2"><Badge tone={CATEGORY_TONE[r.category] || "slate"}>{humanize(r.category)}</Badge></td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div className="flex flex-wrap gap-1">
                          {r.requires_reason && <Badge tone="amber">Reason required</Badge>}
                          {r.auto_followup_hours ? <Badge tone="violet">Follow-up in {r.auto_followup_hours}h</Badge> : null}
                          {!r.requires_reason && !r.auto_followup_hours && <span className="text-slate-300">—</span>}
                        </div>
                      </td>
                      <td className="max-w-[260px] px-3 py-2 text-xs">
                        {next.length ? <span className="line-clamp-2 whitespace-normal text-slate-600">{next.map(nameOf).filter(Boolean).join(", ")}</span> : <span className="text-muted">Any</span>}
                      </td>
                      <td className="px-3 py-2"><Badge>{r.lead_count}</Badge></td>
                      {isGlobal && <td className="px-3 py-2 text-xs">{r.company_id ? meta?.companies.find((c) => c.id === r.company_id)?.name || `#${r.company_id}` : <Badge tone="blue">System</Badge>}</td>}
                      <td className="px-3 py-2"><Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        {canEdit && (
                          <div className="flex justify-end gap-0.5">
                            <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                            <IconButton title={r.lead_count ? "Move leads out of this status before deleting" : "Delete"} tone="red" disabled={!!r.lead_count} onClick={() => remove(r)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        )}
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`${r.id}-subs`} className="border-b border-slate-100 bg-slate-50/50">
                        <td />
                        <td colSpan={isGlobal ? 8 : 7} className="px-3 py-3">
                          <SubStatusEditor key={JSON.stringify(r.sub_statuses)} status={r} readOnly={!canEdit} onSaved={refresh} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!isGlobal && <p className="mt-2 text-xs text-muted"><Lock className="mr-1 inline h-3 w-3" />System statuses are shared by all companies and can only be changed by CRM admins.</p>}
      {editing && <StatusForm key={editing.id ?? "new"} initial={editing} all={rows} onClose={() => setEditing(null)} onSaved={refresh} isGlobal={isGlobal} companies={opts.companies(meta)} />}
    </div>
  );
}

type Sub = { id?: number; name: string; is_active: boolean; _k: string };

function SubStatusEditor({ status, readOnly, onSaved }: { status: Row; readOnly: boolean; onSaved: () => void }) {
  const [items, setItems] = useState<Sub[]>(() => (status.sub_statuses || []).map((s: Row) => ({ id: s.id, name: s.name, is_active: s.is_active !== false, _k: String(s.id) })));
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const change = (fn: (x: Sub[]) => Sub[]) => { setItems(fn); setDirty(true); };
  const move = (i: number, d: number) => change((x) => { const y = [...x]; [y[i], y[i + d]] = [y[i + d], y[i]]; return y; });
  const add = () => { if (!draft.trim()) return; change((x) => [...x, { name: draft.trim(), is_active: true, _k: `n${Date.now()}` }]); setDraft(""); };
  const save = useMutation({
    mutationFn: () => api.put(`${EP}/${status.id}/sub-statuses`, { items: items.map(({ id, name, is_active }) => ({ id, name, is_active })) }),
    onSuccess: () => { toast.success(`Sub-statuses of ${status.name} saved`); setDirty(false); onSaved(); },
  });
  return (
    <div className="max-w-xl">
      <p className="mb-2 text-xs font-medium text-slate-600">Sub-statuses of “{status.name}”</p>
      {!items.length && <p className="mb-2 text-xs text-muted">No sub-statuses.</p>}
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={s._k} className="flex items-center gap-1.5">
            <Input className="h-8 py-1" value={s.name} disabled={readOnly}
              onChange={(e) => change((x) => x.map((y) => (y._k === s._k ? { ...y, name: e.target.value } : y)))} />
            {!readOnly && <>
              <Toggle checked={s.is_active} onChange={(v) => change((x) => x.map((y) => (y._k === s._k ? { ...y, is_active: v } : y)))} />
              <IconButton title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
              <IconButton title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
              <IconButton title="Remove" tone="red" onClick={() => change((x) => x.filter((y) => y._k !== s._k))}><X className="h-3.5 w-3.5" /></IconButton>
            </>}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form className="flex flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input className="h-8 py-1" placeholder="New sub-status" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} disabled={!draft.trim()}>Add</Button>
          </form>
          <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save sub-statuses</Button>
        </div>
      )}
    </div>
  );
}

function StatusForm({ initial, all, onClose, onSaved, isGlobal, companies }:
  { initial: Row; all: Row[]; onClose: () => void; onSaved: () => void; isGlobal: boolean; companies: { value: number | string; label: string }[] }) {
  const [f, setF] = useState<Row>({ ...initial, allowed_next_ids: initial.allowed_next_ids || [] });
  const [err, setErr] = useState("");
  const set = (p: Row) => setF((x) => ({ ...x, ...p }));
  const next: number[] = f.allowed_next_ids;
  const others = all.filter((s) => s.id !== f.id);
  const save = useMutation({
    mutationFn: () => {
      const body: Row = {
        name: f.name.trim(), color: f.color, category: f.category, requires_reason: !!f.requires_reason,
        auto_followup_hours: f.auto_followup_hours === "" || f.auto_followup_hours == null ? null : Number(f.auto_followup_hours),
        allowed_next_ids: next.length ? next : null, is_active: !!f.is_active,
      };
      if (!f.id) {
        body.sort_order = Math.max(0, ...all.map((s) => s.sort_order || 0)) + 1;
        if (isGlobal) body.company_id = f.company_id || null;
      }
      return f.id ? api.patch(`${EP}/${f.id}`, body) : api.post(EP, body);
    },
    onSuccess: () => { toast.success(f.id ? "Status updated" : "Status created"); onSaved(); onClose(); },
  });
  const submit = () => { if (!f.name?.trim()) return setErr("Name is required"); setErr(""); save.mutate(); };
  return (
    <Modal open onClose={onClose} title={f.id ? `Edit status – ${initial.name}` : "New lead status"} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{f.id ? "Save changes" : "Create status"}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Name" required error={err}><Input autoFocus value={f.name || ""} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Color">
          <div className="flex gap-2">
            <input type="color" className="h-9 w-12 rounded border border-border" value={f.color || "#3B82F6"} onChange={(e) => set({ color: e.target.value })} />
            <Input value={f.color || ""} onChange={(e) => set({ color: e.target.value })} />
          </div>
        </Field>
        <Field label="Category" hint="Won = converted, Lost/Invalid = closed. Used by reports and dashboards.">
          <Select value={f.category} onChange={(e) => set({ category: e.target.value })}
            options={["open", "won", "lost", "invalid"].map((c) => ({ value: c, label: humanize(c) }))} />
        </Field>
        <Field label="Auto follow-up (hours)" hint="Create a follow-up this many hours after moving a lead here. Blank = none.">
          <Input type="number" min={0} value={f.auto_followup_hours ?? ""} onChange={(e) => set({ auto_followup_hours: e.target.value })} />
        </Field>
        {isGlobal && !f.id && (
          <Field label="Applies to" hint="Blank = system status for every company">
            <Select placeholder="All companies (system)" options={companies} value={f.company_id ?? ""} onChange={(e) => set({ company_id: e.target.value ? Number(e.target.value) : null })} />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-6 sm:col-span-2">
          <Toggle checked={!!f.requires_reason} onChange={(v) => set({ requires_reason: v })} label="Require a reason when moving here" />
          <Toggle checked={!!f.is_active} onChange={(v) => set({ is_active: v })} label="Active" />
        </div>
        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Allowed next statuses</span>
            <span className="text-xs text-muted">{next.length ? `${next.length} selected` : "None selected = any status allowed"}</span>
          </div>
          <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
            {others.map((s) => (
              <Checkbox key={s.id} checked={next.includes(s.id)}
                onChange={(e) => set({ allowed_next_ids: e.target.checked ? [...next, s.id] : next.filter((x) => x !== s.id) })}
                label={<span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>} />
            ))}
          </div>
          {!!next.length && <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => set({ allowed_next_ids: [] })}>Clear – allow any</button>}
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
