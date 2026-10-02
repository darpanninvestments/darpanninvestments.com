"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, RotateCcw, Save, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDateTime, humanize } from "@/lib/utils";
import { DataTable, useList, type Column } from "@/components/data";
import {
  Badge, Button, Card, Checkbox, Empty, Field, IconButton, Input, Modal, PageHeader, Pagination, Select, StatusPill, Tabs,
  Toggle, useConfirm,
} from "@/components/ui";

const IMP = "/api/imports";
const EXPORT_MODULES = ["leads", "clients", "projects", "properties", "visits", "meetings", "followups", "documents", "users"];

function ImportsPage() {
  const { can } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState(sp.get("tab") === "exports" ? "exports" : "imports");
  const [wizard, setWizard] = useState(false);
  const wantNew = sp.get("new") === "1";
  const [handledNew, setHandledNew] = useState(false);
  if (wantNew && !handledNew && can("imports", "import")) {
    setHandledNew(true);
    setWizard(true);
  }
  useEffect(() => { if (wantNew && handledNew) router.replace("/imports"); }, [wantNew, handledNew, router]);

  return (
    <div>
      <PageHeader title="Import / Export" subtitle="Bulk-load leads and properties, and export CRM data"
        actions={can("imports", "import") && (
          <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setWizard(true)}>New import</Button>
        )} />
      <Tabs className="mb-4" value={tab} onChange={setTab}
        tabs={[{ value: "imports", label: "Import history" }, { value: "exports", label: can("exports") ? "Export data & history" : "Export data" }]} />
      {tab === "imports" ? <ImportList onNew={() => setWizard(true)} /> : <ExportsTab />}
      {wizard && <ImportWizard onClose={() => setWizard(false)} />}
    </div>
  );
}

// ── Import history ─────────────────────────────────────────────────────────────
function ImportList({ onNew }: { onNew: () => void }) {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const params = { page, page_size: 25 };
  const list = useQuery({
    queryKey: [IMP, params],
    queryFn: () => api.get<Paged<Row>>(IMP, params),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "Processing") ? 3000 : false),
  });

  const rollback = async (r: Row) => {
    const ok = await confirm({
      title: `Roll back import #${r.id}?`, confirmText: "Roll back",
      message: <>All <b>{r.live_records}</b> leads still linked to “{r.file_name}” will be removed from the CRM. Leads updated (not created) by this import are not reverted.</>,
    });
    if (!ok) return;
    try {
      const res = await api.post(`${IMP}/${r.id}/rollback`);
      toast.success(`Rolled back – ${res.deleted} leads removed`);
      qc.invalidateQueries({ queryKey: [IMP] });
    } catch (e) { toast.error((e as Error).message); }
  };
  const errorsCsv = async (r: Row) => {
    try { await api.download(`${IMP}/${r.id}/errors.csv`, undefined, `import-${r.id}-errors.csv`); }
    catch (e) { toast.error((e as Error).message); }
  };

  const columns: Column[] = [
    {
      key: "file_name", label: "File",
      render: (r) => (
        <div className="flex min-w-[180px] items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-800">{r.file_name}</div>
            <div className="text-xs text-muted">#{r.id} · {humanize(r.module)}</div>
          </div>
        </div>
      ),
    },
    ...(me?.is_global ? [{ key: "company_name", label: "Company" }] : []),
    { key: "uploaded_by_name", label: "Uploaded by" },
    { key: "created_at", label: "Date", render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: "mode", label: "Mode", render: (r) => <Badge>{humanize(r.mode)}{r.match_key ? ` · ${r.match_key}` : ""}</Badge> },
    { key: "total_rows", label: "Rows", className: "text-right tabular-nums", headClass: "text-right" },
    { key: "success_count", label: "Success", className: "text-right tabular-nums text-emerald-700", headClass: "text-right" },
    { key: "failed_count", label: "Failed", className: "text-right tabular-nums", headClass: "text-right",
      render: (r) => <span className={r.failed_count ? "font-medium text-red-600" : "text-slate-400"}>{r.failed_count}</span> },
    { key: "duplicate_count", label: "Dupes", className: "text-right tabular-nums", headClass: "text-right",
      render: (r) => <span className={r.duplicate_count ? "text-amber-700" : "text-slate-400"}>{r.duplicate_count}</span> },
    { key: "live_records", label: "Live", className: "text-right tabular-nums", headClass: "text-right",
      render: (r) => r.module === "leads" ? r.live_records : <span className="text-slate-300">—</span> },
    {
      key: "status", label: "Status",
      render: (r) => r.status === "Processing"
        ? <span className="inline-flex items-center gap-1 text-xs text-blue-700"><Loader2 className="h-3 w-3 animate-spin" />Processing</span>
        : <StatusPill value={r.status} />,
    },
    {
      key: "_a", label: "", className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-0.5">
          {r.error_count > 0 && <IconButton title="Download error rows (CSV)" tone="amber" onClick={() => errorsCsv(r)}><Download className="h-3.5 w-3.5" /></IconButton>}
          {r.module === "leads" && r.live_records > 0 && can("leads") && (
            <Link href={`/leads?import_job_id=${r.id}`} title="View leads from this import" aria-label="View leads from this import"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"><Users className="h-3.5 w-3.5" /></Link>
          )}
          {r.module === "leads" && can("imports", "delete") && r.live_records > 0 && r.status !== "Processing" && (
            <IconButton title="Roll back import" tone="red" onClick={() => rollback(r)}><RotateCcw className="h-3.5 w-3.5" /></IconButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="card">
      <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching && !list.data}
        empty={<Empty icon={<FileUp className="h-6 w-6" />} title="No imports yet" text="Upload a CSV or Excel file to bulk-create leads or properties."
          action={can("imports", "import") && <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={onNew}>New import</Button>} />} />
      {list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

// ── Import wizard ──────────────────────────────────────────────────────────────
type Preview = { token: string; file_name: string; headers: string[]; total_rows: number; sample: string[][]; suggested_mapping: Record<string, string | null> };
type Template = { name: string; module: string; mapping: Record<string, string> };
const STEPS = ["Upload", "Map columns", "Options", "Import"];

function ImportWizard({ onClose }: { onClose: () => void }) {
  const { me, meta } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [module, setModule] = useState<"leads" | "properties">("leads");
  const [companyId, setCompanyId] = useState<number | null>(me?.user.company_id ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [tplName, setTplName] = useState("");
  const [opts, setOpts] = useState<Row>({ mode: "append", match_key: "mobile", replace_job_id: "", skip_duplicates: false });
  const [defaults, setDefaults] = useState<Row>({});
  const [jobId, setJobId] = useState<number | null>(null);

  const fieldsQ = useQuery({
    queryKey: [IMP, "fields", module],
    queryFn: () => api.get<{ fields: Record<string, string>; templates: Template[] }>(`${IMP}/fields`, { module }),
  });
  const targets = fieldsQ.data?.fields || {};
  const prevJobs = useQuery({
    queryKey: [IMP, "replaceable", module, companyId],
    queryFn: () => api.get<Paged<Row>>(IMP, { module, page_size: 100, company_id: companyId || undefined, status: "Completed" }),
    enabled: step === 2 && opts.mode === "replace",
  });
  const job = useQuery({
    queryKey: [IMP, "job", jobId],
    queryFn: () => api.get(`${IMP}/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "Processing" || !q.state.data ? 2000 : false),
  });
  useEffect(() => {
    if (job.data && job.data.status !== "Processing") qc.invalidateQueries({ queryKey: [IMP] });
  }, [job.data, qc]);

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      return api.upload<Preview>(`${IMP}/preview?module=${module}`, fd);
    },
    onSuccess: (p) => {
      setPreview(p);
      setMapping(Object.fromEntries(p.headers.map((h) => [h, p.suggested_mapping[h] || ""])));
      setStep(1);
    },
  });
  const saveTpl = useMutation({
    mutationFn: () => api.post(`${IMP}/templates`, { name: tplName.trim(), module, mapping }),
    onSuccess: () => { toast.success("Mapping template saved"); setTplName(""); qc.invalidateQueries({ queryKey: [IMP, "fields", module] }); },
  });
  const run = useMutation({
    mutationFn: () => {
      const d = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== "" && v !== null && v !== undefined));
      if (module === "leads" && opts.skip_duplicates && opts.mode !== "update") d.skip_duplicates = true;
      return api.post(`${IMP}/run`, {
        token: preview!.token, file_name: preview!.file_name, total_rows: preview!.total_rows, module, mapping,
        company_id: companyId, mode: opts.mode, match_key: opts.mode === "update" ? opts.match_key : null,
        replace_job_id: opts.mode === "replace" ? Number(opts.replace_job_id) : null, defaults: d,
      });
    },
    onSuccess: (j) => { setJobId(j.id); setStep(3); qc.invalidateQueries({ queryKey: [IMP] }); },
  });

  const mappedTargets = Object.values(mapping).filter(Boolean);
  const dupTargets = mappedTargets.filter((t, i) => mappedTargets.indexOf(t) !== i);
  const missing = module === "leads" ? ["name", "mobile"].filter((k) => !mappedTargets.includes(k)) : [];
  const hasProject = mappedTargets.includes("project") || !!defaults.project_id;
  const optsInvalid = (opts.mode === "replace" && !opts.replace_job_id) || (module === "properties" && !hasProject);
  const companies = meta?.companies || [];
  const byCompany = <T extends { company_id?: number }>(arr: T[]) => arr.filter((x) => !companyId || !x.company_id || x.company_id === companyId);
  const projects = byCompany((meta?.projects || []) as { id: number; name: string; company_id?: number; process_id?: number }[]);
  const users = byCompany((meta?.users || []) as { id: number; name: string; company_id?: number }[]);
  const busy = job.data?.status === "Processing" || (!!jobId && !job.data);
  const setD = (k: string, v: unknown) => setDefaults((d) => ({ ...d, [k]: v }));
  const numOrNull = (v: string) => (v ? Number(v) : "");

  const footer = (
    <>
      {step > 0 && step < 3 && <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(step - 1)}>Back</Button>}
      <div className="flex-1" />
      {step < 3 && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
      {step === 0 && (
        <Button loading={upload.isPending} disabled={!file || (me?.is_global && !companyId)} icon={<ArrowRight className="h-4 w-4" />}
          onClick={() => upload.mutate()}>Upload & preview</Button>
      )}
      {step === 1 && <Button disabled={missing.length > 0 || dupTargets.length > 0} onClick={() => setStep(2)}>Continue</Button>}
      {step === 2 && <Button loading={run.isPending} disabled={optsInvalid} icon={<Upload className="h-4 w-4" />} onClick={() => run.mutate()}>
        Start import ({preview?.total_rows.toLocaleString()} rows)
      </Button>}
      {step === 3 && <Button variant={busy ? "outline" : "primary"} onClick={onClose}>{busy ? "Run in background" : "Done"}</Button>}
    </>
  );

  return (
    <Modal open onClose={onClose} title="Import data" size="xl" footer={footer}>
      <ol className="mb-5 flex items-center gap-2 overflow-x-auto text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-2">
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full font-semibold",
              i < step ? "bg-emerald-100 text-emerald-700" : i === step ? "bg-primary text-white" : "bg-slate-100 text-slate-400")}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("font-medium", i === step ? "text-slate-900" : "text-slate-500")}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What are you importing?">
            <div className="grid grid-cols-2 gap-2">
              {(["leads", "properties"] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setModule(m); setDefaults({}); }}
                  className={cn("rounded-lg border px-3 py-2.5 text-left text-sm transition",
                    module === m ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-slate-50")}>
                  <span className="block font-medium">{humanize(m)}</span>
                  <span className="text-xs text-muted">{m === "leads" ? "Name + mobile required" : "Project required"}</span>
                </button>
              ))}
            </div>
          </Field>
          {me?.is_global ? (
            <Field label="Company" required>
              <Select placeholder="Select company…" value={companyId ?? ""} options={companies.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)} />
            </Field>
          ) : <div />}
          <label className="sm:col-span-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-10 text-center transition hover:border-primary hover:bg-primary-soft/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
            <FileUp className="h-8 w-8 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">{file ? file.name : "Drop a CSV or Excel file here, or click to browse"}</span>
            <span className="text-xs text-muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : ".csv or .xlsx · up to 20 MB · first row must be headers"}</span>
            <input type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}

      {step === 1 && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="text-sm text-slate-600"><b>{preview.file_name}</b> · {preview.total_rows.toLocaleString()} rows · {preview.headers.length} columns</div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!!fieldsQ.data?.templates.length && (
                <Select className="w-auto" placeholder="Load template…" value="" options={fieldsQ.data.templates.map((t) => ({ value: t.name, label: t.name }))}
                  onChange={(e) => {
                    const t = fieldsQ.data!.templates.find((x) => x.name === e.target.value);
                    if (!t) return;
                    setMapping(Object.fromEntries(preview.headers.map((h) => [h, t.mapping[h] ?? mapping[h] ?? ""])));
                    toast.success(`Applied “${t.name}”`);
                  }} />
              )}
              <Input className="w-40" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
              <Button size="sm" variant="outline" icon={<Save className="h-4 w-4" />} disabled={!tplName.trim()} loading={saveTpl.isPending}
                onClick={() => saveTpl.mutate()}>Save mapping</Button>
            </div>
          </div>
          {(missing.length > 0 || dupTargets.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {missing.length > 0 && <span>Map the required {missing.map((m) => targets[m] || m).join(" and ")} column{missing.length > 1 ? "s" : ""}. </span>}
              {dupTargets.length > 0 && <span>Each CRM field can be mapped once ({Array.from(new Set(dupTargets)).map((t) => targets[t] || t).join(", ")}).</span>}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="px-3 py-2">File column</th><th className="px-3 py-2">CRM field</th><th className="px-3 py-2">Sample values</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((h, i) => (
                  <tr key={h} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800">{h}</td>
                    <td className="px-3 py-1.5">
                      <Select className={cn("min-w-[200px]", !mapping[h] && "text-slate-400")} placeholder="— Skip column —" value={mapping[h] || ""}
                        options={Object.entries(targets).map(([k, label]) => ({ value: k, label }))}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })} />
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-xs text-muted">
                      {preview.sample.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">Preview first {preview.sample.length} rows</summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-max text-xs">
                <thead><tr className="bg-slate-50 text-left text-slate-500">{preview.headers.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>{preview.sample.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="max-w-[200px] truncate px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <p className="label">Import mode</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ["append", "Append", "Add every row as a new record"],
                ...(module === "leads" ? [["update", "Update existing", "Match rows to existing leads and update them"],
                  ["replace", "Replace previous import", "Remove leads from an earlier import, then import"]] : []),
              ] as [string, string, string][]).map(([v, l, d]) => (
                <button key={v} type="button" onClick={() => setOpts({ ...opts, mode: v })}
                  className={cn("rounded-lg border px-3 py-2.5 text-left transition", opts.mode === v ? "border-primary bg-primary-soft" : "border-border hover:bg-slate-50")}>
                  <span className={cn("block text-sm font-medium", opts.mode === v ? "text-primary" : "text-slate-800")}>{l}</span>
                  <span className="text-xs text-muted">{d}</span>
                </button>
              ))}
            </div>
          </div>
          {opts.mode === "update" && (
            <Field label="Match existing leads by" hint="Rows without a match are added as new leads">
              <Select className="sm:max-w-xs" value={opts.match_key} options={[{ value: "mobile", label: "Mobile" }, { value: "email", label: "Email" }, { value: "external_id", label: "External ID" }]}
                onChange={(e) => setOpts({ ...opts, match_key: e.target.value })} />
            </Field>
          )}
          {opts.mode === "replace" && (
            <Field label="Import to replace" required hint="Leads created by that import are removed as soon as this import starts.">
              <Select className="sm:max-w-md" placeholder={prevJobs.isLoading ? "Loading…" : "Select a previous import…"} value={opts.replace_job_id}
                options={(prevJobs.data?.items || []).map((j) => ({ value: j.id, label: `#${j.id} · ${j.file_name} · ${fmtDateTime(j.created_at)} (${j.live_records} live)` }))}
                onChange={(e) => setOpts({ ...opts, replace_job_id: e.target.value })} />
            </Field>
          )}
          <div>
            <p className="label">Defaults for empty / unmapped values</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {module === "leads" ? <>
                <Field label="Source"><Select placeholder="—" value={defaults.source_id ?? ""} options={(meta?.sources || []).map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setD("source_id", numOrNull(e.target.value))} /></Field>
                <Field label="Project"><Select placeholder="—" value={defaults.project_id ?? ""} options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) => {
                    const p = projects.find((x) => x.id === Number(e.target.value));
                    setDefaults((d) => ({ ...d, project_id: numOrNull(e.target.value), ...(p?.process_id && !d.process_id ? { process_id: p.process_id } : {}) }));
                  }} /></Field>
                <Field label="Process"><Select placeholder="—" value={defaults.process_id ?? ""} options={(meta?.processes || []).map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setD("process_id", numOrNull(e.target.value))} /></Field>
                <Field label="Assign to" hint="Empty = assignment rules"><Select placeholder="—" value={defaults.assigned_to_id ?? ""} options={users.map((u) => ({ value: u.id, label: u.name }))} onChange={(e) => setD("assigned_to_id", numOrNull(e.target.value))} /></Field>
                <Field label="Priority"><Select placeholder="—" value={defaults.priority ?? ""} options={["Hot", "Warm", "Cold"].map((p) => ({ value: p, label: p }))} onChange={(e) => setD("priority", e.target.value)} /></Field>
              </> : (
                <Field label="Project" required={!mappedTargets.includes("project")} hint={mappedTargets.includes("project") ? "Used when the Project column is empty" : "No Project column mapped – choose one"}>
                  <Select placeholder="—" value={defaults.project_id ?? ""} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setD("project_id", numOrNull(e.target.value))} />
                </Field>
              )}
            </div>
          </div>
          {module === "leads" && opts.mode !== "update" && (
            <Toggle checked={!!opts.skip_duplicates} onChange={(v) => setOpts({ ...opts, skip_duplicates: v })}
              label={<span>Skip duplicates <span className="text-xs text-muted">(rows whose mobile/email already exists are not imported)</span></span>} />
          )}
        </div>
      )}

      {step === 3 && (
        <div className="py-2">
          {busy ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-slate-800">Importing {preview?.total_rows.toLocaleString()} rows…</p>
              <p className="text-xs text-muted">{job.data ? `${(job.data.success_count || 0) + (job.data.failed_count || 0)} processed so far` : "Starting"} · you can close this window, we&apos;ll notify you when it&apos;s done.</p>
            </div>
          ) : job.data && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {job.data.status === "Failed" ? <AlertTriangle className="h-8 w-8 text-danger" /> : <CheckCircle2 className="h-8 w-8 text-success" />}
                <div>
                  <p className="text-base font-semibold text-slate-900">Import {job.data.status.toLowerCase()}</p>
                  <p className="text-xs text-muted">#{job.data.id} · {job.data.file_name}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Rows", job.data.total_rows, "text-slate-900"], ["Imported", job.data.success_count, "text-emerald-700"],
                  ["Failed", job.data.failed_count, "text-red-600"], ["Duplicates", job.data.duplicate_count, "text-amber-700"]].map(([l, v, c]) => (
                  <div key={l} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">{l}</p>
                    <p className={cn("text-xl font-semibold tabular-nums", c)}>{Number(v || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              {!!job.data.errors?.length && (
                <div className="rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-xs font-medium text-slate-600">Rows needing attention</span>
                    <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />}
                      onClick={() => api.download(`${IMP}/${job.data!.id}/errors.csv`, undefined, `import-${job.data!.id}-errors.csv`).catch((e) => toast.error(e.message))}>Error file</Button>
                  </div>
                  <ul className="max-h-48 overflow-y-auto text-xs">
                    {(job.data.errors as Row[]).slice(0, 50).map((e, i) => (
                      <li key={i} className="flex gap-3 border-b border-slate-100 px-3 py-1.5 last:border-0">
                        <span className="w-14 shrink-0 text-muted">Row {e.row}</span><span className="text-slate-700">{e.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {module === "leads" && job.data.success_count > 0 && (
                <Link href={`/leads?import_job_id=${job.data.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  View imported leads <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Exports ────────────────────────────────────────────────────────────────────
function ExportsTab() {
  const { can } = useAuth();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <ExportCard />
      {can("exports") ? <ExportHistory /> : <div />}
    </div>
  );
}

function ExportCard() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const allowed = EXPORT_MODULES.filter((m) => can(m, "export") || (m === "followups" && can("leads", "export")));
  const [module, setModule] = useState(allowed[0] || "leads");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const colsQ = useQuery({
    queryKey: ["/api/exports", "columns", module],
    queryFn: () => api.get<{ columns: string[] }>(`/api/exports/${module}/columns`),
    enabled: allowed.includes(module),
  });
  const columns = useMemo(() => colsQ.data?.columns || [], [colsQ.data]);
  const selected = picked[module] ?? columns;
  const setSel = (cols: string[]) => setPicked((p) => ({ ...p, [module]: cols }));
  const exp = useMutation({
    mutationFn: () => api.download(`/api/exports/${module}`, { format, columns: selected }, `${module}.${format}`),
    onSuccess: () => { toast.success("Export ready"); qc.invalidateQueries({ queryKey: ["/api/exports"] }); },
  });

  if (!allowed.length) return <Card title="Export data"><p className="text-sm text-muted">You don&apos;t have export permission for any module.</p></Card>;
  return (
    <Card title="Export data" bodyClass="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Module">
          <Select value={module} options={allowed.map((m) => ({ value: m, label: humanize(m) }))} onChange={(e) => setModule(e.target.value)} />
        </Field>
        <Field label="Format">
          <Select value={format} options={[{ value: "xlsx", label: "Excel (.xlsx)" }, { value: "csv", label: "CSV" }]} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")} />
        </Field>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Columns ({selected.length}/{columns.length})</span>
          <span className="flex gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => setSel(columns)}>All</button>
            <button type="button" className="text-primary hover:underline" onClick={() => setSel([])}>None</button>
          </span>
        </div>
        <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {colsQ.isLoading && <span className="text-xs text-muted">Loading…</span>}
          {columns.map((c) => (
            <Checkbox key={c} label={<span className="truncate text-xs">{humanize(c)}</span>} checked={selected.includes(c)}
              onChange={(e) => setSel(e.target.checked ? columns.filter((x) => x === c || selected.includes(x)) : selected.filter((x) => x !== c))} />
          ))}
        </div>
      </div>
      <Button className="w-full" icon={<Download className="h-4 w-4" />} loading={exp.isPending} disabled={!selected.length} onClick={() => exp.mutate()}>
        Export {humanize(module)}
      </Button>
      <p className="text-[11px] text-muted">Exports respect your data access scope and are logged.</p>
    </Card>
  );
}

function ExportHistory() {
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  const list = useList("/api/exports", { page, page_size: 25 });
  const columns: Column[] = [
    { key: "created_at", label: "Date", render: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: "user_name", label: "User" },
    { key: "module", label: "Module", render: (r) => humanize(r.module) },
    { key: "record_count", label: "Records", className: "text-right tabular-nums", headClass: "text-right" },
    { key: "format", label: "Format", render: (r) => <Badge>{String(r.format || "").toUpperCase()}</Badge> },
    { key: "columns", label: "Columns", className: "text-muted", render: (r) => (r.columns || []).length },
    {
      key: "filters", label: "Filters",
      render: (r) => {
        const f = Object.entries(r.filters || {}).filter(([k]) => k !== "page_size");
        return f.length ? <span className="text-xs text-muted">{f.map(([k, v]) => `${k}=${v}`).join(", ")}</span> : <span className="text-slate-300">—</span>;
      },
    },
  ];
  return (
    <Card title={me?.is_global ? "Export history (all companies)" : "Export history"} bodyClass="p-0">
      <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} dense empty={<Empty title="No exports yet" />} />
      {list.data && list.data.total > 0 && <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
    </Card>
  );
}

export default function Page() {
  return <Suspense><ImportsPage /></Suspense>;
}
