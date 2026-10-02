"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ResourceForm, ResourcePage, RowLink, companyField, defaultsOf, opts, type ResourceConfig } from "@/components/data";
import { Badge } from "@/components/ui";

function ProcessesInner() {
  const { me, can } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();

  const cfg = useMemo<ResourceConfig>(() => ({
    title: "Processes",
    subtitle: "Sales verticals that group your projects",
    endpoint: "/api/processes",
    module: "processes",
    defaultSort: "name",
    searchPlaceholder: "Search processes…",
    showCompanyFilter: true,
    columns: [
      { key: "name", label: "Process", sortable: true, render: (r) => <RowLink href={`/projects?process_id=${r.id}`}>{r.name}</RowLink> },
      { key: "type", label: "Type", sortable: true, render: (r) => r.type ? <Badge tone="blue">{r.type}</Badge> : <span className="text-slate-300">—</span> },
      ...(me?.is_global ? [{ key: "company_name", label: "Company" }] : []),
      { key: "project_count", label: "Projects", render: (r: Row) => <span className="font-medium">{r.project_count}</span> },
      { key: "lead_count", label: "Leads", render: (r: Row) => <span className="font-medium">{r.lead_count}</span> },
      { key: "description", label: "Description", className: "max-w-xs truncate text-slate-500" },
      { key: "is_active", label: "Status", sortable: true, render: (r: Row) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    ],
    filters: [
      { key: "type", label: "All types", options: opts.lookup("process_type") },
      { key: "is_active", label: "Any status", options: [{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }] },
    ],
    fields: [
      companyField,
      { key: "name", label: "Name", required: true },
      { key: "type", label: "Type", type: "select", options: opts.lookup("process_type") },
      { key: "description", label: "Description", type: "textarea" },
      { key: "is_active", label: "Active", type: "checkbox", default: true, placeholder: "Active" },
    ],
    rowActions: (r) => can("projects") ? (
      <Link href={`/projects?process_id=${r.id}`} title="View projects" aria-label="View projects"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-blue-600 transition hover:bg-blue-50">
        <FolderKanban className="h-3.5 w-3.5" />
      </Link>
    ) : null,
  }), [me?.is_global, can]);

  const isNew = sp.get("new") === "1" && can("processes", "add");
  const closeNew = () => router.replace(pathname);
  const create = useMutation({
    mutationFn: (data: Row) => api.post("/api/processes", data),
    onSuccess: () => {
      toast.success("Process created");
      qc.invalidateQueries({ queryKey: ["/api/processes"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      closeNew();
    },
  });
  const newValue = useMemo(() => (isNew ? defaultsOf(cfg.fields) : null), [isNew, cfg.fields]);

  return (
    <>
      <ResourcePage cfg={cfg} />
      <ResourceForm cfg={cfg} value={newValue} onClose={closeNew} onSave={(v) => create.mutate(v)} saving={create.isPending} />
    </>
  );
}

export default function ProcessesPage() {
  return <Suspense><ProcessesInner /></Suspense>;
}
