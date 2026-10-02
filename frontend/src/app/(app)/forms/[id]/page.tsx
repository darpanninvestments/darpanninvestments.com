"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowUp, CheckCheck, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Eye, GripVertical,
  Plus, Save, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDateTime, humanize } from "@/lib/utils";
import { DataTable, RowLink, useList, type Column } from "@/components/data";
import {
  Badge, Button, Checkbox, Empty, Field, IconButton, Input, Loading, PageHeader, Pagination, Select, StatusPill, Tabs,
  Textarea, Toggle,
} from "@/components/ui";
import {
  CLIENT_MAP, FIELD_TYPES, FORM_TYPES, FormFieldInput, LEAD_MAP, copyText, downloadCSV, parseOptions, slugify,
  type FieldValue, type FormField,
} from "@/components/forms-kit";

const EP = "/api/forms";
type Draft = FormField & { _uid: string; _keyTouched?: boolean; _opt?: string };

let uidSeq = 0;
const uid = () => `f${Date.now().toString(36)}${(uidSeq++).toString(36)}`;
const toDraft = (f: FormField): Draft => ({ ...f, _uid: uid(), _keyTouched: true, _opt: (f.options || []).join("\n") });
const fromDraft = (d: Draft): FormField => {
  const { _uid, _keyTouched, _opt, ...f } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
  const out: FormField = { ...f };
  if (d.type === "select" || d.type === "radio") out.options = parseOptions(_opt);
  else delete out.options;
  if (!out.map_to) delete out.map_to;
  if (d.type !== "file") delete out.category;
  if (d.type === "section") { delete out.required; delete out.map_to; }
  return out;
};

const SETTINGS_KEYS = ["name", "description", "slug", "form_type", "destination", "project_id", "process_id", "source_id",
  "assign_to_id", "success_message", "is_active"] as const;

function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = can("forms", "edit");
  const [tab, setTab] = useState(sp.get("tab") || "builder");

  const q = useQuery({ queryKey: [EP, "detail", id], queryFn: () => api.get(`${EP}/${id}`) });
  const [fields, setFields] = useState<Draft[]>([]);
  const [settings, setSettings] = useState<Row>({});
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [synced, setSynced] = useState<Row | null>(null);
  if (q.data && q.data !== synced) { // reset the draft whenever fresh server data arrives
    setSynced(q.data);
    setFields(((q.data.fields || []) as FormField[]).map(toDraft));
    setSettings(Object.fromEntries(SETTINGS_KEYS.map((k) => [k, q.data[k] ?? null])));
    setDirty(false);
  }

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const setF = (next: Draft[]) => { setFields(next); setDirty(true); };
  const updateField = (u: string, patch: Partial<Draft>) =>
    setF(fields.map((f) => {
      if (f._uid !== u) return f;
      const n = { ...f, ...patch };
      if (patch.label !== undefined && !f._keyTouched) n.key = slugify(patch.label) || f.key;
      return n;
    }));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const n = [...fields];
    [n[i], n[j]] = [n[j], n[i]];
    setF(n);
  };
  const addField = (type: FormField["type"]) => {
    const base = type === "section" ? "Section" : `${humanize(type)} field`;
    let key = slugify(base), n = 1;
    while (fields.some((f) => f.key === key)) key = `${slugify(base)}_${++n}`;
    const d: Draft = { key, label: base, type, required: false, _uid: uid(), _keyTouched: false,
      _opt: type === "select" || type === "radio" ? "Option 1\nOption 2" : "" };
    setF([...fields, d]);
    setOpenUid(d._uid);
  };
  const setS = (patch: Row) => { setSettings({ ...settings, ...patch }); setDirty(true); };

  const problems = useMemo(() => {
    const p: string[] = [];
    const keys = fields.filter((f) => f.type !== "section").map((f) => f.key);
    if (keys.some((k) => !k)) p.push("Every field needs a key");
    const dup = keys.filter((k, i) => k && keys.indexOf(k) !== i);
    if (dup.length) p.push(`Duplicate keys: ${Array.from(new Set(dup)).join(", ")}`);
    if (fields.some((f) => (f.type === "select" || f.type === "radio") && !parseOptions(f._opt).length)) p.push("Select/radio fields need options");
    if (settings.destination === "lead") {
      const mapped = new Set(fields.map((f) => f.map_to || f.key));
      if (!mapped.has("name") || !mapped.has("mobile")) p.push("Lead forms must map a Name and a Mobile field");
    }
    if (!String(settings.name || "").trim()) p.push("Form name is required");
    return p;
  }, [fields, settings]);

  const save = useMutation({
    mutationFn: () => api.patch(`${EP}/${id}`, { ...settings, fields: fields.map(fromDraft) }),
    onSuccess: (r) => {
      toast.success(r.version !== q.data?.version ? `Saved – now version ${r.version}` : "Form saved");
      qc.setQueryData([EP, "detail", id], r);
      qc.invalidateQueries({ queryKey: [EP] });
      setDirty(false);
    },
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Empty title="Form not found" action={<Link href="/forms" className="text-sm text-primary">Back to forms</Link>} />;
  const form = q.data;
  const mapOpts = settings.destination === "client" ? CLIENT_MAP : settings.destination === "lead" ? LEAD_MAP : [];

  return (
    <div>
      <PageHeader
        back={<Link href="/forms" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-slate-800"><ArrowLeft className="h-3 w-3" />All forms</Link>}
        title={<span className="flex items-center gap-2">{settings.name || form.name}
          <Badge tone={form.is_active ? "green" : "slate"}>{form.is_active ? "Active" : "Inactive"}</Badge>
          <span className="text-xs font-normal text-muted">v{form.version}</span></span>}
        subtitle={<>{humanize(form.form_type)} · {form.submission_count} submissions · {form.views || 0} views</>}
        actions={<>
          <Button size="sm" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copyText(form.public_url, "Link copied")}>Copy link</Button>
          <a href={`/f/${form.slug}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <ExternalLink className="h-4 w-4" />Open
          </a>
          {canEdit && tab !== "submissions" && (
            <Button size="sm" icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || problems.length > 0}
              title={problems.join("; ")} onClick={() => save.mutate()}>{dirty ? "Save changes" : "Saved"}</Button>
          )}
        </>} />

      <Tabs className="mb-4" value={tab} onChange={(t) => { setTab(t); router.replace(`/forms/${id}${t === "builder" ? "" : `?tab=${t}`}`); }}
        tabs={[{ value: "builder", label: "Builder" }, { value: "settings", label: "Settings" },
          { value: "submissions", label: "Submissions", count: form.submission_count }]} />

      {tab !== "submissions" && problems.length > 0 && dirty && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{problems.join(" · ")}</div>
      )}

      {tab === "builder" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="space-y-2">
            {fields.length === 0 && <div className="card"><Empty title="No fields yet" text="Add fields from the palette below." /></div>}
            {fields.map((f, i) => {
              const open = openUid === f._uid;
              return (
                <div key={f._uid} className={cn("card", open && "ring-2 ring-primary/20")}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenUid(open ? null : f._uid)}>
                      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                      <span className={cn("truncate text-sm", f.type === "section" ? "font-semibold uppercase tracking-wide text-primary" : "font-medium text-slate-800")}>
                        {f.label || <em className="text-slate-400">Untitled</em>}
                      </span>
                      {f.required && <span className="text-danger">*</span>}
                      <Badge className="ml-auto">{f.type}</Badge>
                      {f.map_to && <Badge tone="blue" className="hidden sm:inline-flex">Maps to {f.map_to}</Badge>}
                    </button>
                    {canEdit && <>
                      <IconButton title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton title="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton title="Remove field" tone="red" onClick={() => setF(fields.filter((x) => x._uid !== f._uid))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </>}
                  </div>
                  {open && (
                    <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
                      <Field label={f.type === "section" ? "Section title" : "Label"} className={f.type === "section" ? "sm:col-span-2" : ""}>
                        <Input value={f.label} autoFocus onChange={(e) => updateField(f._uid, { label: e.target.value })} />
                      </Field>
                      {f.type !== "section" && (
                        <Field label="Key" hint="Stored with each submission">
                          <Input value={f.key} className="font-mono text-xs"
                            onChange={(e) => updateField(f._uid, { key: slugify(e.target.value) || e.target.value.toLowerCase(), _keyTouched: true })} />
                        </Field>
                      )}
                      <Field label="Type">
                        <Select value={f.type} options={FIELD_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
                          onChange={(e) => updateField(f._uid, { type: e.target.value as FormField["type"] })} />
                      </Field>
                      {f.type !== "section" && mapOpts.length > 0 && (
                        <Field label={`Map to ${settings.destination} field`}>
                          <Select value={f.map_to || ""} placeholder={`— custom field (${settings.destination === "lead" ? "stored in custom fields" : "onboarding data"}) —`}
                            options={mapOpts.map((m) => ({ value: m, label: humanize(m) }))}
                            onChange={(e) => updateField(f._uid, { map_to: e.target.value || null })} />
                        </Field>
                      )}
                      {f.type === "file" && (
                        <Field label="Document category">
                          <Input value={f.category || ""} placeholder="e.g. KYC, Address Proof" onChange={(e) => updateField(f._uid, { category: e.target.value })} />
                        </Field>
                      )}
                      {(f.type === "select" || f.type === "radio") && (
                        <Field label="Options" hint="One per line or comma separated" className="sm:col-span-2">
                          <Textarea rows={3} value={f._opt || ""} onChange={(e) => updateField(f._uid, { _opt: e.target.value })} />
                        </Field>
                      )}
                      {["text", "email", "tel", "number", "textarea"].includes(f.type) && (
                        <Field label="Placeholder">
                          <Input value={f.placeholder || ""} onChange={(e) => updateField(f._uid, { placeholder: e.target.value || undefined })} />
                        </Field>
                      )}
                      {f.type !== "section" && (
                        <div className="flex items-end pb-2">
                          <Checkbox label="Required" checked={!!f.required} onChange={(e) => updateField(f._uid, { required: e.target.checked })} />
                        </div>
                      )}
                    </fieldset>
                  )}
                </div>
              );
            })}
            {canEdit && (
              <div className="card p-3">
                <p className="mb-2 text-xs font-medium text-slate-500">Add field</p>
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_TYPES.map((t) => (
                    <Button key={t} size="xs" variant="outline" icon={<Plus className="h-3 w-3" />} onClick={() => addField(t)}>{humanize(t)}</Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Preview name={settings.name} description={settings.description} fields={fields} />
        </div>
      )}

      {tab === "settings" && <SettingsTab form={form} settings={settings} setS={setS} canEdit={canEdit} />}
      {tab === "submissions" && <SubmissionsTab formId={id} form={form} />}
    </div>
  );
}

function Preview({ name, description, fields }: { name?: string; description?: string; fields: Draft[] }) {
  const [vals, setVals] = useState<Record<string, FieldValue>>({});
  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500"><Eye className="h-3.5 w-3.5" />Live preview</div>
      <div className="card max-h-[calc(100vh-8rem)] overflow-y-auto bg-slate-50 p-3">
        <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{name || "Untitled form"}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          <div className="mt-4 space-y-4">
            {fields.map((f) => (
              <FormFieldInput key={f._uid} field={{ ...f, options: parseOptions(f._opt) }} value={vals[f.key]}
                onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} />
            ))}
          </div>
          <button type="button" className="mt-5 h-10 w-full rounded-lg bg-primary text-sm font-semibold text-white opacity-90" disabled>Submit</button>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ form, settings, setS, canEdit }: { form: Row; settings: Row; setS: (p: Row) => void; canEdit: boolean }) {
  const { meta } = useAuth();
  const byCompany = <T extends { company_id?: number }>(arr: T[]) => arr.filter((x) => !x.company_id || x.company_id === form.company_id);
  const num = (v: string) => (v ? Number(v) : null);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <fieldset disabled={!canEdit} className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <Field label="Form name" required className="sm:col-span-2">
          <Input value={settings.name || ""} onChange={(e) => setS({ name: e.target.value })} />
        </Field>
        <Field label="Description" hint="Shown under the title on the public form" className="sm:col-span-2">
          <Textarea value={settings.description || ""} onChange={(e) => setS({ description: e.target.value })} />
        </Field>
        <Field label="Public URL slug" hint="Changing the slug breaks previously shared links">
          <div className="flex items-center rounded-lg border border-border bg-slate-50 focus-within:border-primary">
            <span className="pl-3 text-xs text-muted">/f/</span>
            <input className="w-full bg-transparent px-1 py-2 text-sm outline-none" value={settings.slug || ""}
              onChange={(e) => setS({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
          </div>
        </Field>
        <Field label="Form type">
          <Select value={settings.form_type || ""} options={FORM_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            onChange={(e) => setS({ form_type: e.target.value })} />
        </Field>
        <Field label="Submissions create">
          <Select value={settings.destination || "lead"}
            options={[{ value: "lead", label: "A new lead" }, { value: "client", label: "Client onboarding data" }, { value: "none", label: "Nothing (store only)" }]}
            onChange={(e) => setS({ destination: e.target.value })} />
        </Field>
        <Field label="Project">
          <Select placeholder="—" value={settings.project_id ?? ""}
            options={byCompany((meta?.projects || []) as { id: number; name: string; company_id?: number }[]).map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => {
              const pid = num(e.target.value);
              const proc = meta?.projects.find((p) => p.id === pid)?.process_id;
              setS({ project_id: pid, ...(proc && !settings.process_id ? { process_id: proc } : {}) });
            }} />
        </Field>
        <Field label="Process">
          <Select placeholder="—" value={settings.process_id ?? ""} options={(meta?.processes || []).map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => setS({ process_id: num(e.target.value) })} />
        </Field>
        <Field label="Lead source">
          <Select placeholder="—" value={settings.source_id ?? ""} options={(meta?.sources || []).map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => setS({ source_id: num(e.target.value) })} />
        </Field>
        <Field label="Auto-assign leads to" hint="Leave empty to use the company's assignment rules">
          <Select placeholder="Assignment rules" value={settings.assign_to_id ?? ""}
            options={byCompany((meta?.users || []) as { id: number; name: string; company_id?: number }[]).map((u) => ({ value: u.id, label: u.name }))}
            onChange={(e) => setS({ assign_to_id: num(e.target.value) })} />
        </Field>
        <Field label="Success message" className="sm:col-span-2">
          <Textarea rows={2} value={settings.success_message || ""} placeholder="Thank you! We will get in touch shortly."
            onChange={(e) => setS({ success_message: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={!!settings.is_active} onChange={(v) => setS({ is_active: v })}
            label={settings.is_active ? "Active – accepting submissions" : "Inactive – public link shows ‘not available’"} />
        </div>
      </fieldset>
      <div className="space-y-4">
        <div className="card space-y-3 p-4 text-sm">
          <h3 className="font-semibold text-slate-800">Share</h3>
          <div>
            <p className="label">Public link</p>
            <div className="flex gap-2">
              <Input readOnly value={form.public_url} onFocus={(e) => e.target.select()} className="text-xs" />
              <IconButton title="Copy link" className="h-9 w-9" onClick={() => copyText(form.public_url, "Link copied")}><Copy className="h-4 w-4" /></IconButton>
            </div>
          </div>
          <div>
            <p className="label">Embed code</p>
            <Textarea readOnly rows={4} value={form.embed_code} className="font-mono text-[11px]" onFocus={(e) => e.target.select()} />
            <Button size="xs" variant="outline" className="mt-1.5" icon={<Copy className="h-3 w-3" />} onClick={() => copyText(form.embed_code, "Embed code copied")}>Copy embed code</Button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(form.public_url)}`}
            alt="QR code for the public form link" width={160} height={160} className="rounded-lg border border-border p-1.5" />
        </div>
        {form.destination === "client" && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
            Client onboarding forms are sent from a client&apos;s profile – each link carries a personal token so
            submissions update that client and attach their documents.
          </p>
        )}
      </div>
    </div>
  );
}

function cellValue(v: unknown) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function SubmissionsTab({ formId, form }: { formId: string; form: Row }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const ep = `${EP}/${formId}/submissions`;
  const list = useList(ep, { page, page_size: 25 });
  const fields = ((list.data as (Paged<Row> & { fields?: FormField[] }) | undefined)?.fields || form.fields || [])
    .filter((f: FormField) => f.type !== "section") as FormField[];

  const review = useMutation({
    mutationFn: (r: Row) => api.patch(`${EP}/submissions/${r.id}`, { status: "Reviewed" }),
    onSuccess: () => { toast.success("Marked as reviewed"); qc.invalidateQueries({ queryKey: [ep] }); },
  });

  const exportCSV = async () => {
    setExporting(true);
    try {
      const all = await api.get<Paged<Row>>(ep, { page_size: 1000 });
      const headers = ["Submitted At", ...fields.map((f) => f.label || f.key), "Lead", "Client", "Status", "Form Version", "IP"];
      downloadCSV(`${form.slug}-submissions`, headers, all.items.map((r) => [
        r.created_at, ...fields.map((f) => cellValue(r.data?.[f.key])), r.lead_code, r.client_code, r.status, r.form_version, r.ip,
      ]));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column[] = [
    { key: "created_at", label: "Submitted", render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
    ...fields.map((f) => ({
      key: `d_${f.key}`, label: f.label || f.key,
      render: (r: Row) => {
        const v = cellValue(r.data?.[f.key]);
        return v ? <span className="line-clamp-2 max-w-[220px] whitespace-normal">{v}</span> : <span className="text-slate-300">—</span>;
      },
    })),
    {
      key: "record", label: "Record",
      render: (r) => r.lead_id ? <RowLink href={`/leads/${r.lead_id}`}>{r.lead_code || `#${r.lead_id}`}</RowLink>
        : r.client_id ? <RowLink href={`/clients/${r.client_id}`}>{r.client_code || `#${r.client_id}`}</RowLink>
          : <span className="text-slate-300">—</span>,
    },
    { key: "form_version", label: "Ver.", className: "text-muted", render: (r) => `v${r.form_version || 1}` },
    { key: "status", label: "Status", render: (r) => <StatusPill value={r.status} /> },
    {
      key: "_a", label: "", className: "text-right",
      render: (r) => can("forms", "edit") && r.status !== "Reviewed" ? (
        <Button size="xs" variant="outline" icon={<CheckCheck className="h-3.5 w-3.5" />} loading={review.isPending && review.variables?.id === r.id}
          onClick={() => review.mutate(r)}>Mark reviewed</Button>
      ) : null,
    },
  ];

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <span className="text-xs text-muted">Newest first · signatures and files are saved to Documents</span>
        <div className="ml-auto">
          {can("forms", "export") && (
            <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} loading={exporting}
              disabled={!list.data?.total} onClick={exportCSV}>Export CSV</Button>
          )}
        </div>
      </div>
      <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} dense
        empty={<Empty title="No submissions yet" text="Share the public link or embed the form on your website to start collecting responses." />} />
      {list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><FormBuilderPage /></Suspense>;
}
