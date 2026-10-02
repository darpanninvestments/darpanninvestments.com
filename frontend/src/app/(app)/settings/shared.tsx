"use client";

import type { Row } from "@/lib/api";
import type { Meta } from "@/lib/auth";
import { Badge } from "@/components/ui";
import { opts, type Column, type FieldDef } from "@/components/data";

export type SectionProps = { companyId: number | null; canConfigure: boolean };

/** "Applies to" column for masters that can be system-wide (company_id null) or company specific. */
export function scopeColumn(meta: Meta | undefined): Column {
  return {
    key: "company_id", label: "Applies to",
    render: (r: Row) => r.company_id
      ? <span className="text-xs text-slate-600">{meta?.companies.find((c) => c.id === r.company_id)?.name || `Company #${r.company_id}`}</span>
      : <Badge tone="blue">System</Badge>,
  };
}

/** Company picker on create for CRM admins; blank = system row visible to every company. */
export function scopeField(companyId: number | null): FieldDef {
  return {
    key: "company_id", label: "Applies to", type: "select", options: opts.companies, placeholder: "All companies (system)",
    hidden: (_f, c) => !c.isGlobal || c.editing, default: companyId ?? undefined,
    hint: "System rows are shared by every company and can only be edited by CRM admins.",
  };
}

export const editableRow = (isGlobal: boolean) => (r: Row) => isGlobal || r.company_id != null;
