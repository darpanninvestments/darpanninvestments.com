"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Database, FileText, ListChecks, MessageSquareText, Plug, Tags, TextCursorInput } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Empty, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { opts } from "@/components/data";
import { StatusesSection } from "./statuses";
import { CustomFieldsSection, LookupsSection, SourcesSection, TemplatesSection } from "./masters";
import { AutomationSection } from "./automation";
import { IntegrationsSection } from "./integrations";

import type { SectionProps } from "./shared";

const SECTIONS: { value: string; label: string; icon: ReactNode; desc: string }[] = [
  { value: "statuses", label: "Lead Statuses", icon: <ListChecks className="h-4 w-4" />, desc: "Pipeline stages, sub-statuses and allowed transitions" },
  { value: "sources", label: "Lead Sources", icon: <Tags className="h-4 w-4" />, desc: "Where leads come from" },
  { value: "masters", label: "Masters", icon: <Database className="h-4 w-4" />, desc: "Dropdown values used across the CRM" },
  { value: "custom_fields", label: "Custom Fields", icon: <TextCursorInput className="h-4 w-4" />, desc: "Extra fields on leads, clients, projects and properties" },
  { value: "templates", label: "Message Templates", icon: <MessageSquareText className="h-4 w-4" />, desc: "WhatsApp, email and SMS templates" },
  { value: "automation", label: "Automation", icon: <Bot className="h-4 w-4" />, desc: "Assignment, duplicates, follow-ups, escalation, checklist" },
  { value: "integrations", label: "Integrations", icon: <Plug className="h-4 w-4" />, desc: "Lead webhook, API key, email & WhatsApp" },
];

export default function SettingsPage() {
  return <Suspense fallback={<Loading />}><SettingsHub /></Suspense>;
}

function SettingsHub() {
  const { me, meta, can } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const initial = sp.get("tab");
  const [tab, setTabState] = useState(SECTIONS.some((s) => s.value === initial) ? initial! : "statuses");
  const [company, setCompany] = useState("");
  const setTab = (t: string) => { setTabState(t); router.replace(`/settings?tab=${t}`, { scroll: false }); };
  if (!me) return <Loading />;
  if (!can("settings")) return <Empty title="No access" text="You do not have permission to view settings." />;
  const props: SectionProps = { companyId: company ? Number(company) : null, canConfigure: can("settings", "configure") };
  const current = SECTIONS.find((s) => s.value === tab)!;

  return (
    <div>
      <PageHeader title="Settings" subtitle={current.desc}
        actions={me.is_global && (
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">Editing</span>
            <Select className="w-auto min-w-[200px]" value={company} onChange={(e) => setCompany(e.target.value)}
              placeholder="Global defaults (all companies)" options={opts.companies(meta)} />
          </div>
        )} />
      {!props.canConfigure && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <FileText className="h-4 w-4 shrink-0" />You have read-only access to settings.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Tabs className="lg:hidden" value={tab} onChange={setTab} tabs={SECTIONS.map((s) => ({ value: s.value, label: s.label }))} />
        <nav className="card hidden h-fit p-2 lg:block">
          {SECTIONS.map((s) => (
            <button key={s.value} type="button" onClick={() => setTab(s.value)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition",
                tab === s.value ? "bg-primary-soft text-primary" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
              <span className={tab === s.value ? "text-primary" : "text-slate-400"}>{s.icon}</span>{s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === "statuses" && <StatusesSection {...props} />}
          {tab === "sources" && <SourcesSection {...props} />}
          {tab === "masters" && <LookupsSection {...props} />}
          {tab === "custom_fields" && <CustomFieldsSection {...props} />}
          {tab === "templates" && <TemplatesSection {...props} />}
          {tab === "automation" && <AutomationSection {...props} />}
          {tab === "integrations" && <IntegrationsSection {...props} />}
        </div>
      </div>
    </div>
  );
}
