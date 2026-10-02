"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, humanize } from "@/lib/utils";
import { Badge, Button, Input } from "@/components/ui";
import { ResourcePage, type Column, type ResourceConfig } from "@/components/data";
import { editableRow, scopeColumn, scopeField, type SectionProps } from "./shared";

const swatch = (r: Row) => r.color
  ? <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded border border-black/10" style={{ background: r.color }} /><span className="font-mono text-[11px] text-muted">{r.color}</span></span>
  : <span className="text-slate-300">—</span>;
const activeCol: Column = { key: "is_active", label: "Active", render: (r) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge> };

function useBase(companyId: number | null) {
  const { me, meta } = useAuth();
  const isGlobal = !!me?.is_global;
  return { isGlobal, meta, scopeCols: isGlobal ? [scopeColumn(meta)] : [], editable: editableRow(isGlobal), scope: scopeField(companyId) };
}

export function SourcesSection({ companyId }: SectionProps) {
  const b = useBase(companyId);
  const cfg = useMemo<ResourceConfig>(() => ({
    title: "Lead Sources", subtitle: "Shown in lead forms, imports and the public webhook (matched by name).",
    endpoint: "/api/lead-sources", module: "settings", writeAction: "configure", noun: "Source", defaultSort: "name",
    showCompanyFilter: true, editable: b.editable,
    columns: [
      { key: "name", label: "Name", sortable: true, render: (r) => <span className="inline-flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color || "#94a3b8" }} />{r.name}</span> },
      { key: "code", label: "Code", render: (r) => r.code ? <span className="font-mono text-xs">{r.code}</span> : <span className="text-slate-300">—</span> },
      { key: "color", label: "Color", render: swatch },
      ...b.scopeCols, activeCol,
    ],
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "code", label: "Code", placeholder: "e.g. META_ADS", hint: "Optional short code for integrations" },
      { key: "color", label: "Color", type: "color" },
      b.scope,
      { key: "is_active", label: "Active", type: "checkbox", default: true },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [companyId, b.isGlobal, b.meta]);
  return <ResourcePage cfg={cfg} />;
}

const KNOWN_TYPES = ["property_type", "purpose", "priority", "loss_reason", "document_category", "client_stage", "process_type",
  "project_status", "visit_status", "meeting_status", "meeting_type", "followup_outcome", "activity_type", "facing"];

export function LookupsSection({ companyId }: SectionProps) {
  const b = useBase(companyId);
  const [extra, setExtra] = useState<string[]>([]);
  const [type, setType] = useState(KNOWN_TYPES[0]);
  const [newType, setNewType] = useState("");
  const types = Array.from(new Set([...KNOWN_TYPES, ...Object.keys(b.meta?.lookups || {}), ...extra]));
  const addType = () => {
    const t = newType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!t) return;
    setExtra((x) => [...x, t]); setType(t); setNewType("");
  };
  const cfg = useMemo<ResourceConfig>(() => ({
    title: humanize(type), subtitle: `Values for the “${type}” dropdown. Lower sort order shows first.`,
    endpoint: "/api/lookups", module: "settings", writeAction: "configure", noun: "Value", defaultSort: "sort_order",
    baseParams: { type }, showCompanyFilter: true, editable: b.editable,
    columns: [
      { key: "name", label: "Label", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "value", label: "Stored value", render: (r) => <span className="font-mono text-xs text-muted">{r.value || r.name}</span> },
      { key: "color", label: "Color", render: swatch },
      { key: "sort_order", label: "Order", sortable: true },
      ...b.scopeCols, activeCol,
    ],
    fields: [
      { key: "type", label: "Type", hidden: () => true, default: type },
      { key: "name", label: "Label", required: true },
      { key: "value", label: "Stored value", placeholder: "Defaults to label", hint: "Change only if reports/imports need a different value" },
      { key: "color", label: "Color", type: "color" },
      { key: "sort_order", label: "Sort order", type: "number", default: 0 },
      b.scope,
      { key: "is_active", label: "Active", type: "checkbox", default: true },
    ],
    transformOut: (f) => ({ ...f, type: f.type || type }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [type, companyId, b.isGlobal, b.meta]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <div className="card h-fit p-2">
        <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted">Master type</p>
        <div className="flex gap-1 overflow-x-auto xl:max-h-[480px] xl:flex-col xl:overflow-y-auto">
          {types.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cn("flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition",
                t === type ? "bg-primary-soft font-medium text-primary" : "text-slate-600 hover:bg-slate-50")}>
              {humanize(t)}
              {!!b.meta?.lookups?.[t]?.length && <span className="text-[11px] text-muted">{b.meta.lookups[t].length}</span>}
            </button>
          ))}
        </div>
        <form className="mt-2 flex gap-1 border-t border-border p-1 pt-2" onSubmit={(e) => { e.preventDefault(); addType(); }}>
          <Input className="h-8 py-1 text-xs" placeholder="New type, e.g. amenity" value={newType} onChange={(e) => setNewType(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} disabled={!newType.trim()}>Add</Button>
        </form>
      </div>
      <div className="min-w-0"><ResourcePage key={type} cfg={cfg} /></div>
    </div>
  );
}

const FIELD_TYPES = ["text", "number", "date", "select", "textarea", "checkbox"];

export function CustomFieldsSection({ companyId }: SectionProps) {
  const b = useBase(companyId);
  const cfg = useMemo<ResourceConfig>(() => ({
    title: "Custom Fields", subtitle: "Extra fields that appear on forms and detail pages.",
    endpoint: "/api/custom-fields", module: "settings", writeAction: "configure", noun: "Field", defaultSort: "sort_order",
    showCompanyFilter: true, editable: b.editable,
    filters: [{ key: "module", label: "All modules", options: ["lead", "client", "project", "property"].map((m) => ({ value: m, label: humanize(m) })) }],
    columns: [
      { key: "label", label: "Label", sortable: true, render: (r) => <span className="font-medium">{r.label}{r.required && <span className="text-danger"> *</span>}</span> },
      { key: "key", label: "Key", render: (r) => <span className="font-mono text-xs">{r.key}</span> },
      { key: "module", label: "Module", sortable: true, render: (r) => <Badge tone="violet">{humanize(r.module)}</Badge> },
      { key: "field_type", label: "Type", render: (r) => <span className="text-xs">{humanize(r.field_type)}</span> },
      { key: "options", label: "Options", render: (r) => Array.isArray(r.options) && r.options.length ? <span className="text-xs text-muted">{r.options.join(", ")}</span> : <span className="text-slate-300">—</span> },
      { key: "sort_order", label: "Order", sortable: true },
      ...b.scopeCols, activeCol,
    ],
    fields: [
      { key: "module", label: "Module", type: "select", required: true, default: "lead", options: ["lead", "client", "project", "property"].map((m) => ({ value: m, label: humanize(m) })) },
      { key: "label", label: "Label", required: true,
        onChange: (v, f) => (f.id || f._keyTouched ? {} : { key: String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") }) },
      { key: "key", label: "Key", required: true, hint: "snake_case identifier stored on the record", onChange: () => ({ _keyTouched: true }) },
      { key: "field_type", label: "Field type", type: "select", required: true, default: "text", options: FIELD_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
      { key: "options", label: "Options", span: 2, placeholder: "Option A, Option B, Option C", hint: "Comma separated", hidden: (f) => f.field_type !== "select" },
      { key: "sort_order", label: "Sort order", type: "number", default: 0 },
      { key: "required", label: "Required", type: "checkbox", default: false },
      b.scope,
      { key: "is_active", label: "Active", type: "checkbox", default: true },
    ],
    transformOut: (f) => {
      const { _keyTouched, ...rest } = f;
      void _keyTouched;
      const o = rest.options;
      return {
        ...rest,
        key: String(rest.key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        options: rest.field_type === "select" ? (Array.isArray(o) ? o : String(o || "").split(",").map((s) => s.trim()).filter(Boolean)) : null,
      };
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [companyId, b.isGlobal, b.meta]);
  return <ResourcePage cfg={cfg} />;
}

const CHANNEL_TONE: Record<string, "green" | "blue" | "amber"> = { whatsapp: "green", email: "blue", sms: "amber" };

export function TemplatesSection({ companyId }: SectionProps) {
  const b = useBase(companyId);
  const cfg = useMemo<ResourceConfig>(() => ({
    title: "Message Templates", subtitle: "Placeholders {name}, {agent} and {project} are replaced when the template is used.",
    endpoint: "/api/message-templates", module: "settings", writeAction: "configure", noun: "Template", defaultSort: "name",
    showCompanyFilter: true, editable: b.editable, modalSize: "lg",
    filters: [{ key: "channel", label: "All channels", options: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }] }],
    columns: [
      { key: "name", label: "Name", sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
      { key: "channel", label: "Channel", render: (r) => <Badge tone={CHANNEL_TONE[r.channel] || "slate"}>{r.channel === "whatsapp" ? "WhatsApp" : r.channel?.toUpperCase()}</Badge> },
      { key: "body", label: "Message", render: (r) => <span className="line-clamp-2 max-w-md whitespace-normal text-xs text-muted">{r.subject ? <b className="text-slate-700">{r.subject} – </b> : null}{r.body}</span> },
      ...b.scopeCols, activeCol,
    ],
    fields: [
      { key: "channel", label: "Channel", type: "select", required: true, default: "whatsapp",
        options: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }] },
      { key: "name", label: "Name", required: true, placeholder: "e.g. Site visit reminder" },
      { key: "subject", label: "Subject", span: 2, hidden: (f) => f.channel !== "email" },
      { key: "body", label: "Message body", type: "textarea", required: true,
        placeholder: "Hi {name}, this is {agent} from Darpann Investments regarding {project}…",
        hint: "Placeholders: {name} = lead/client name · {agent} = your name · {project} = project name" },
      b.scope,
      { key: "is_active", label: "Active", type: "checkbox", default: true },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [companyId, b.isGlobal, b.meta]);
  return <ResourcePage cfg={cfg} />;
}
