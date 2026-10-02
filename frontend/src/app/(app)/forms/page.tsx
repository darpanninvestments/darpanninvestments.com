"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Code2, Copy, Inbox, Link2, MessageCircle, MoreVertical, Pencil, Plus, QrCode, Search, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { humanize, waLink } from "@/lib/utils";
import { DataTable, RowLink, useList, type Column } from "@/components/data";
import {
  Badge, Button, Empty, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, Pagination, Select, Toggle, useConfirm,
} from "@/components/ui";
import { FORM_TYPES, copyText, type FormField } from "@/components/forms-kit";

const EP = "/api/forms";

const STARTER: Record<string, FormField[]> = {
  lead: [
    { key: "name", label: "Full name", type: "text", required: true, map_to: "name" },
    { key: "mobile", label: "Mobile number", type: "tel", required: true, map_to: "mobile" },
    { key: "email", label: "Email", type: "email", map_to: "email" },
  ],
  client: [
    { key: "name", label: "Full name", type: "text", required: true, map_to: "name" },
    { key: "mobile", label: "Mobile", type: "tel", required: true, map_to: "mobile" },
    { key: "email", label: "Email", type: "email", map_to: "email" },
  ],
  none: [{ key: "name", label: "Your name", type: "text", required: true }],
};

function FormsPage() {
  const { can, me, meta } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<Row | null>(null);
  const [qr, setQr] = useState<Row | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const wantNew = sp.get("new") === "1";
  const [handledNew, setHandledNew] = useState(false);
  if (wantNew && !handledNew && can("forms", "add")) {
    setHandledNew(true);
    setCreating({ name: "", form_type: "lead_capture", destination: "lead" });
  }
  useEffect(() => { if (wantNew && handledNew) router.replace("/forms"); }, [wantNew, handledNew, router]);

  const list = useList(EP, { q: debounced, page, page_size: 25, sort: "-id", ...filters });
  const refresh = () => qc.invalidateQueries({ queryKey: [EP] });

  const toggle = useMutation({
    mutationFn: (r: Row) => api.patch(`${EP}/${r.id}`, { is_active: !r.is_active }),
    onSuccess: (r) => { toast.success(r.is_active ? "Form activated" : "Form deactivated"); refresh(); },
  });
  const create = useMutation({
    mutationFn: (d: Row) => api.post(EP, { ...d, fields: STARTER[d.destination] || [], is_active: true }),
    onSuccess: (r) => { toast.success("Form created"); refresh(); setCreating(null); router.push(`/forms/${r.id}`); },
  });
  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete form?", message: <>“{r.name}” will stop accepting submissions and its public link will no longer work.</> }))) return;
    try { await api.del(`${EP}/${r.id}`); toast.success("Form deleted"); refresh(); } catch (e) { toast.error((e as Error).message); }
  };

  const columns: Column[] = [
    {
      key: "name", label: "Form", sortable: true,
      render: (r) => (
        <div className="min-w-[180px]">
          <RowLink href={`/forms/${r.id}`}>{r.name}</RowLink>
          <div className="text-xs text-muted">/f/{r.slug}</div>
        </div>
      ),
    },
    { key: "form_type", label: "Type", sortable: true, render: (r) => <Badge>{humanize(r.form_type)}</Badge> },
    {
      key: "destination", label: "Creates",
      render: (r) => r.destination === "lead" ? <Badge tone="blue">Lead</Badge> : r.destination === "client" ? <Badge tone="violet">Client</Badge> : <Badge>None</Badge>,
    },
    { key: "project_name", label: "Project", render: (r) => r.project_name || <span className="text-slate-300">—</span> },
    { key: "submission_count", label: "Submissions", className: "text-right tabular-nums", headClass: "text-right" },
    { key: "views", label: "Views", sortable: true, className: "text-right tabular-nums", headClass: "text-right", render: (r) => r.views || 0 },
    {
      key: "conversion_rate", label: "Conv.", className: "text-right tabular-nums", headClass: "text-right",
      render: (r) => r.conversion_rate === null || r.conversion_rate === undefined ? <span className="text-slate-300">—</span> : `${r.conversion_rate}%`,
    },
    {
      key: "is_active", label: "Active",
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          {can("forms", "edit")
            ? <Toggle checked={!!r.is_active} onChange={() => toggle.mutate(r)} />
            : r.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
        </div>
      ),
    },
    { key: "version", label: "Ver.", className: "tabular-nums text-muted", render: (r) => `v${r.version || 1}` },
    {
      key: "_a", label: "", className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconButton title="Copy public link" onClick={() => copyText(r.public_url, "Link copied")}><Link2 className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Share on WhatsApp" tone="green" onClick={() => window.open(waLink("", `${r.name}: ${r.public_url}`), "_blank", "noopener")}>
            <MessageCircle className="h-3.5 w-3.5" />
          </IconButton>
          <Menu trigger={(t) => <IconButton title="More actions" onClick={t}><MoreVertical className="h-3.5 w-3.5" /></IconButton>}>
            {(close) => <>
              <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { close(); router.push(`/forms/${r.id}`); }}>
                {can("forms", "edit") ? "Open builder" : "View form"}
              </MenuItem>
              <MenuItem icon={<Inbox className="h-4 w-4" />} onClick={() => { close(); router.push(`/forms/${r.id}?tab=submissions`); }}>View submissions</MenuItem>
              <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => { close(); copyText(r.public_url, "Link copied"); }}>Copy public link</MenuItem>
              <MenuItem icon={<Code2 className="h-4 w-4" />} onClick={() => { close(); copyText(r.embed_code, "Embed code copied"); }}>Copy embed code</MenuItem>
              <MenuItem icon={<QrCode className="h-4 w-4" />} onClick={() => { close(); setQr(r); }}>Show QR code</MenuItem>
              {can("forms", "delete") && (
                <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); remove(r); }}>Delete</MenuItem>
              )}
            </>}
          </Menu>
        </div>
      ),
    },
  ];

  const companyOpts = (meta?.companies || []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <div>
      <PageHeader title="Forms" subtitle="Hosted lead capture, onboarding and enquiry forms"
        actions={can("forms", "add") && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />}
            onClick={() => setCreating({ name: "", form_type: "lead_capture", destination: "lead" })}>New form</Button>
        )} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search forms…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto min-w-[160px]" placeholder="All types" value={filters.form_type || ""}
            options={FORM_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            onChange={(e) => { setFilters({ ...filters, form_type: e.target.value }); setPage(1); }} />
          <Select className="w-auto min-w-[140px]" placeholder="Any destination" value={filters.destination || ""}
            options={[{ value: "lead", label: "Creates lead" }, { value: "client", label: "Updates client" }, { value: "none", label: "No record" }]}
            onChange={(e) => { setFilters({ ...filters, destination: e.target.value }); setPage(1); }} />
          {me?.is_global && (
            <Select className="w-auto min-w-[150px]" placeholder="All companies" value={filters.company_id || ""} options={companyOpts}
              onChange={(e) => { setFilters({ ...filters, company_id: e.target.value }); setPage(1); }} />
          )}
        </div>
        <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching}
          onRowClick={(r) => router.push(`/forms/${r.id}`)}
          empty={<Empty title="No forms yet" text="Create a form to capture leads from your website, ads or QR codes."
            action={can("forms", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating({ name: "", form_type: "lead_capture", destination: "lead" })}>New form</Button>} />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} />
        )}
      </div>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="New form" size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setCreating(null)}>Cancel</Button>
          <Button loading={create.isPending} disabled={!creating?.name?.trim() || (me?.is_global && !creating?.company_id)}
            onClick={() => creating && create.mutate(creating)}>Create & open builder</Button>
        </>}>
        {creating && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (creating.name?.trim()) create.mutate(creating); }}>
            <Field label="Form name" required>
              <Input autoFocus value={creating.name} placeholder="e.g. Diwali Offer – Villa Enquiry"
                onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            </Field>
            {me?.is_global && (
              <Field label="Company" required>
                <Select placeholder="Select…" options={companyOpts} value={creating.company_id ?? ""}
                  onChange={(e) => setCreating({ ...creating, company_id: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            )}
            <Field label="Form type">
              <Select options={FORM_TYPES.map((t) => ({ value: t, label: humanize(t) }))} value={creating.form_type}
                onChange={(e) => {
                  const t = e.target.value;
                  setCreating({ ...creating, form_type: t, destination: t === "client_onboarding" || t === "document_collection" ? "client" : t === "feedback" || t === "event" ? "none" : "lead" });
                }} />
            </Field>
            <Field label="Submissions create" hint="Lead forms create a lead in the CRM; client forms update the client who opened their personal link.">
              <Select value={creating.destination}
                options={[{ value: "lead", label: "A new lead" }, { value: "client", label: "Client onboarding data" }, { value: "none", label: "Nothing (store submission only)" }]}
                onChange={(e) => setCreating({ ...creating, destination: e.target.value })} />
            </Field>
            <button type="submit" className="hidden" />
          </form>
        )}
      </Modal>

      <Modal open={!!qr} onClose={() => setQr(null)} title="QR code" size="sm">
        {qr && (
          <div className="flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr.public_url)}`}
              alt={`QR code for ${qr.name}`} width={220} height={220} className="rounded-lg border border-border p-2" />
            <div>
              <p className="text-sm font-medium text-slate-800">{qr.name}</p>
              <p className="break-all text-xs text-muted">{qr.public_url}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => copyText(qr.public_url, "Link copied")}>Copy link</Button>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover"
                href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=png&data=${encodeURIComponent(qr.public_url)}`}
                target="_blank" rel="noopener noreferrer">Open printable QR</a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Suspense><FormsPage /></Suspense>;
}
