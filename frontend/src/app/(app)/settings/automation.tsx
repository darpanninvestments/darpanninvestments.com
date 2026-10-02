"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, qs, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Checkbox, Field, IconButton, Input, Loading, Select, Toggle } from "@/components/ui";
import type { SectionProps } from "./shared";

type Opt = { value: string | number; label: string };
type Rule = { field: string; value: string; user_ids: number[] };

const DEFAULT_CHECKLIST = [
  { category: "KYC", title: "PAN Card", required: true },
  { category: "KYC", title: "Aadhaar Card", required: true },
  { category: "Booking", title: "Booking Form", required: true },
  { category: "Payment", title: "Booking Payment Receipt", required: true },
  { category: "Address Proof", title: "Address Proof", required: false },
];

export function AutomationSection({ companyId, canConfigure }: SectionProps) {
  const q = useQuery({
    queryKey: ["/api/settings", companyId],
    queryFn: () => api.get("/api/settings", { company_id: companyId || undefined }),
  });
  const users = useQuery({
    queryKey: ["/api/users/options", companyId],
    queryFn: () => api.get<Row[]>("/api/users/options", { company_id: companyId || undefined }),
  });
  if (!q.data) return <Loading />;
  const userOpts = (users.data || []).map((u) => ({ value: u.id, label: u.role ? `${u.name} · ${u.role}` : u.name }));
  const p = { companyId, ro: !canConfigure, userOpts };
  return (
    <div key={companyId ?? "global"} className="space-y-4">
      <AssignmentCard {...p} initial={q.data.assignment_rules} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DuplicateCard {...p} initial={q.data.duplicate_rules} />
        <FollowupCard {...p} initial={q.data.followup} />
        <EscalationCard {...p} initial={q.data.escalation} />
      </div>
      <ChecklistCard {...p} initial={q.data.client_checklist} />
    </div>
  );
}

type CardProps = { companyId: number | null; ro: boolean; userOpts: Opt[]; initial: Row | null };

function useSave(key: string, companyId: number | null, label: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: Row) => api.put(`/api/settings/${key}${qs({ company_id: companyId || undefined })}`, value),
    onSuccess: () => { toast.success(`${label} saved`); qc.invalidateQueries({ queryKey: ["/api/settings"] }); },
  });
}

function SettingCard({ title, desc, children, onSave, saving, ro }:
  { title: string; desc: ReactNode; children: ReactNode; onSave: () => void; saving: boolean; ro: boolean }) {
  return (
    <Card title={title} actions={!ro && <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={onSave}>Save</Button>}>
      <p className="mb-4 text-xs text-muted">{desc}</p>
      <fieldset disabled={ro} className="min-w-0">{children}</fieldset>
    </Card>
  );
}

function UserMulti({ value, onChange, options, placeholder = "Add user…" }: { value: number[]; onChange: (v: number[]) => void; options: Opt[]; placeholder?: string }) {
  const label = (id: number) => options.find((o) => Number(o.value) === id)?.label.split(" · ")[0] || `User #${id}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white p-1.5">
      {value.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
          {label(id)}
          <button type="button" className="rounded-full p-0.5 hover:bg-white/60" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <select className="h-7 min-w-[140px] flex-1 rounded border-0 bg-transparent text-xs text-slate-600 outline-none" value=""
        onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)])}>
        <option value="">{value.length ? placeholder : "Anyone – " + placeholder.toLowerCase()}</option>
        {options.filter((o) => !value.includes(Number(o.value))).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function AssignmentCard({ companyId, ro, userOpts, initial }: CardProps) {
  const { meta } = useAuth();
  const [mode, setMode] = useState<string>(initial?.mode || "round_robin");
  const [pool, setPool] = useState<number[]>(initial?.user_ids || []);
  const [rules, setRules] = useState<Rule[]>(() => (initial?.rules || []).map((r: Row) => ({ field: r.field || "source_id", value: String(r.value ?? ""), user_ids: r.user_ids || [] })));
  const save = useSave("assignment_rules", companyId, "Assignment rules");
  const setRule = (i: number, p: Partial<Rule>) => setRules((x) => x.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valueOpts = (field: string): Opt[] | null =>
    field === "source_id" ? (meta?.sources || []).map((s) => ({ value: s.id, label: s.name }))
      : field === "project_id" ? (meta?.projects || []).map((p) => ({ value: p.id, label: p.name })) : null;

  return (
    <SettingCard title="Lead assignment" ro={ro} saving={save.isPending}
      desc="How new leads (manual, import, forms, webhook) are auto-assigned. Rules are checked top to bottom; the first match picks its users, otherwise the default pool is used. An empty pool means all active Sales Agents."
      onSave={() => save.mutate({ mode, user_ids: pool, rules: rules.filter((r) => r.value !== "").map((r) => ({ ...r, value: r.field === "city" ? r.value : Number(r.value) || r.value })) })}>
      {!companyId && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">You are editing the global default. User pools are company specific – pick a company above to set them.</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <Field label="Mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} options={[
            { value: "round_robin", label: "Round robin" }, { value: "least_load", label: "Least open leads" }, { value: "manual", label: "Manual (no auto-assign)" },
          ]} />
        </Field>
        <Field label="Default pool" hint="Users who receive leads when no rule matches">
          <UserMulti value={pool} onChange={setPool} options={userOpts} />
        </Field>
      </div>
      {mode !== "manual" && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Routing rules</span>
            {!ro && <Button size="xs" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRules((x) => [...x, { field: "source_id", value: "", user_ids: [] }])}>Add rule</Button>}
          </div>
          {!rules.length && <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">No rules – every lead goes to the default pool.</p>}
          <div className="space-y-2">
            {rules.map((r, i) => {
              const vo = valueOpts(r.field);
              return (
                <div key={i} className="grid grid-cols-1 items-start gap-2 rounded-lg border border-border bg-slate-50/60 p-2 md:grid-cols-[auto_150px_200px_auto_minmax(0,1fr)_auto]">
                  <span className="pt-2 text-xs font-medium text-slate-500">If</span>
                  <Select value={r.field} onChange={(e) => setRule(i, { field: e.target.value, value: "" })} options={[
                    { value: "source_id", label: "Source" }, { value: "project_id", label: "Project" }, { value: "city", label: "City" },
                  ]} />
                  {vo ? <Select placeholder="Select…" value={r.value} options={vo} onChange={(e) => setRule(i, { value: e.target.value })} />
                    : <Input placeholder="e.g. Pune" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />}
                  <span className="pt-2 text-xs font-medium text-slate-500">assign to</span>
                  <UserMulti value={r.user_ids} onChange={(v) => setRule(i, { user_ids: v })} options={userOpts} />
                  {!ro && <IconButton title="Remove rule" tone="red" className="mt-1" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></IconButton>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SettingCard>
  );
}

function DuplicateCard({ companyId, ro, initial }: CardProps) {
  const [v, setV] = useState({ mobile: initial?.mobile ?? true, email: initial?.email ?? true });
  const save = useSave("duplicate_rules", companyId, "Duplicate rules");
  return (
    <SettingCard title="Duplicate detection" ro={ro} saving={save.isPending} onSave={() => save.mutate(v)}
      desc="When adding a lead, warn if another lead in the company matches on:">
      <div className="space-y-3">
        <Toggle checked={v.mobile} onChange={(mobile) => setV({ ...v, mobile })} label="Mobile number (incl. alternate)" />
        <Toggle checked={v.email} onChange={(email) => setV({ ...v, email })} label="Email address" />
      </div>
    </SettingCard>
  );
}

function FollowupCard({ companyId, ro, initial }: CardProps) {
  const [v, setV] = useState({ default_reminder_minutes: initial?.default_reminder_minutes ?? 15, retry_hours: initial?.retry_hours ?? 2 });
  const save = useSave("followup", companyId, "Follow-up settings");
  return (
    <SettingCard title="Follow-ups" ro={ro} saving={save.isPending} desc="Defaults for reminders and missed calls."
      onSave={() => save.mutate({ default_reminder_minutes: Number(v.default_reminder_minutes) || 0, retry_hours: Number(v.retry_hours) || 0 })}>
      <div className="space-y-3">
        <Field label="Remind before (minutes)"><Input type="number" min={0} value={v.default_reminder_minutes} onChange={(e) => setV({ ...v, default_reminder_minutes: e.target.value })} /></Field>
        <Field label="Retry after no answer (hours)" hint="Auto re-schedule when the outcome is ‘not reachable’">
          <Input type="number" min={0} value={v.retry_hours} onChange={(e) => setV({ ...v, retry_hours: e.target.value })} />
        </Field>
      </div>
    </SettingCard>
  );
}

function EscalationCard({ companyId, ro, initial }: CardProps) {
  const [v, setV] = useState({ enabled: initial?.enabled ?? true, after_hours: initial?.after_hours ?? 4 });
  const save = useSave("escalation", companyId, "Escalation settings");
  return (
    <SettingCard title="Escalation" ro={ro} saving={save.isPending} desc="Notify the team lead / manager when follow-ups stay overdue."
      onSave={() => save.mutate({ enabled: v.enabled, after_hours: Number(v.after_hours) || 1 })}>
      <div className="space-y-3">
        <Toggle checked={v.enabled} onChange={(enabled) => setV({ ...v, enabled })} label="Escalate overdue follow-ups" />
        <Field label="Escalate after (hours overdue)"><Input type="number" min={1} disabled={!v.enabled} value={v.after_hours} onChange={(e) => setV({ ...v, after_hours: e.target.value })} /></Field>
      </div>
    </SettingCard>
  );
}

function ChecklistCard({ companyId, ro, initial }: CardProps) {
  const [items, setItems] = useState<{ category: string; title: string; required: boolean }[]>(() => initial?.items || DEFAULT_CHECKLIST);
  const save = useSave("client_checklist", companyId, "Client checklist");
  const set = (i: number, p: Row) => setItems((x) => x.map((it, j) => (j === i ? { ...it, ...p } : it)));
  return (
    <SettingCard title="Client document checklist" ro={ro} saving={save.isPending}
      desc={<>Pending document requests created automatically when a lead converts to a client.{!initial && " Currently using the built-in default list."}</>}
      onSave={() => save.mutate({ items: items.filter((i) => i.title.trim()).map((i) => ({ ...i, category: i.category.trim() || "General", title: i.title.trim() })) })}>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.5fr_auto_auto] items-center gap-2">
            <Input placeholder="Category" value={it.category} onChange={(e) => set(i, { category: e.target.value })} />
            <Input placeholder="Document title" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
            <Checkbox label="Required" checked={it.required} onChange={(e) => set(i, { required: e.target.checked })} />
            {!ro ? <IconButton title="Remove" tone="red" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></IconButton> : <span />}
          </div>
        ))}
      </div>
      {!ro && <Button className="mt-3" size="xs" variant="outline" icon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => setItems((x) => [...x, { category: "", title: "", required: false }])}>Add document</Button>}
    </SettingCard>
  );
}
