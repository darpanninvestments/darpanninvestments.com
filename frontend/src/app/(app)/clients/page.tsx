"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { Download, Plus, Search, UserSquare2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, money } from "@/lib/utils";
import { Avatar, Button, Empty, Input, Loading, PageHeader, Pagination, Select, StatusPill, Tabs } from "@/components/ui";
import { DataTable, RowLink, useList, type Column } from "@/components/data";
import { CLIENT_STAGES, ClientFormModal, ProgressBar } from "@/components/clients";
import { dayEndISO, dayStartISO } from "@/components/scheduling";

const columns: Column[] = [
  { key: "code", label: "Code", sortable: true, render: (r) => <RowLink href={`/clients/${r.id}`}>{r.code}</RowLink> },
  { key: "name", label: "Client", sortable: true, render: (r) => (
    <div className="flex items-center gap-2"><Avatar name={r.name} size={26} /><span className="font-medium text-slate-800">{r.name}</span></div>) },
  { key: "mobile", label: "Mobile", render: (r) => <a href={`tel:${r.mobile}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary">{r.mobile}</a> },
  { key: "project_name", label: "Project / property", render: (r) => (
    <div><div>{r.project_name || "—"}</div>{r.property_code && <div className="text-xs text-muted">{r.property_code}</div>}</div>) },
  { key: "stage", label: "Stage", sortable: true, render: (r) => <StatusPill value={r.stage} /> },
  { key: "assigned_to_name", label: "Agent" },
  { key: "booking_date", label: "Booking date", sortable: true, render: (r) => fmtDate(r.booking_date) },
  { key: "deal_value", label: "Deal value", sortable: true, className: "text-right", headClass: "text-right",
    render: (r) => r.deal_value_masked ? <span className="tracking-widest text-slate-400" title="Hidden for your role">•••</span> : money(r.deal_value) },
  { key: "document_completion", label: "Documents", render: (r) => (
    <div className="w-28">
      <div className="mb-1 flex justify-between text-[11px] text-muted"><span>{r.documents_done}/{r.documents_total}</span><span>{r.document_completion}%</span></div>
      <ProgressBar value={r.document_completion} />
    </div>) },
];

function ClientsBoard() {
  const { can, me, meta } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [stage, setStage] = useState("");
  const [company, setCompany] = useState("");
  const [project, setProject] = useState(sp.get("project_id") || "");
  const [agent, setAgent] = useState(sp.get("assigned_to_id") || "");
  const [dateField, setDateField] = useState("booking_date");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("-id");
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const canAdd = can("clients", "add");
  const urlNew = sp.get("new") === "1";
  const addOpen = adding || (urlNew && canAdd);
  const closeAdd = () => { setAdding(false); if (urlNew) router.replace(pathname); };

  const filters = {
    q: dq, company_id: company, project_id: project, assigned_to_id: agent,
    [`${dateField}__gte`]: dayStartISO(from), [`${dateField}__lte`]: dayEndISO(to),
  };
  const list = useList("/api/clients", { ...filters, stage, page, page_size: pageSize, sort });
  const counts = useQueries({
    queries: ["", ...CLIENT_STAGES].map((s) => ({
      queryKey: ["/api/clients", { ...filters, stage: s, page_size: 1 }],
      queryFn: () => api.get<Paged<unknown>>("/api/clients", { ...filters, stage: s, page_size: 1 }),
      staleTime: 30_000,
    })),
  });
  const setF = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const doExport = async () => {
    try { await api.download("/api/exports/clients", { format: "xlsx", filters: { ...filters, stage } }, "clients.xlsx"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const active = !!(dq || company || project || agent || from || to);

  return (
    <div>
      <PageHeader title="Clients" subtitle="Converted leads, onboarding and document progress" actions={<>
        {can("clients", "export") && <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={doExport}>Export</Button>}
        {canAdd && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add client</Button>}
      </>} />
      <div className="card">
        <Tabs className="px-3" value={stage} onChange={setF(setStage)}
          tabs={["", ...CLIENT_STAGES].map((s, i) => ({ value: s, label: s || "All", count: counts[i]?.data?.total }))} />
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search name, mobile, email, code…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {me?.is_global && (
            <Select className="w-auto min-w-[140px]" value={company} placeholder="All companies"
              options={(meta?.companies || []).map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setF(setCompany)(e.target.value)} />
          )}
          <Select className="w-auto min-w-[130px]" value={project} placeholder="All projects"
            options={(meta?.projects || []).map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setF(setProject)(e.target.value)} />
          <Select className="w-auto min-w-[130px]" value={agent} placeholder="All agents"
            options={(meta?.users || []).map((u) => ({ value: u.id, label: u.name }))} onChange={(e) => setF(setAgent)(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
            <Select className="w-auto" value={dateField} options={[{ value: "booking_date", label: "Booking date" }, { value: "created_at", label: "Converted on" }]}
              onChange={(e) => setF(setDateField)(e.target.value)} />
            <Input type="date" className="w-auto" aria-label="From date" value={from} onChange={(e) => setF(setFrom)(e.target.value)} />
            <span>to</span>
            <Input type="date" className="w-auto" aria-label="To date" value={to} onChange={(e) => setF(setTo)(e.target.value)} />
          </div>
          {active && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setCompany(""); setProject(""); setAgent(""); setFrom(""); setTo(""); setPage(1); }}>Clear</Button>}
        </div>
        <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort}
          onRowClick={(r) => router.push(`/clients/${r.id}`)}
          empty={<Empty icon={<UserSquare2 className="h-6 w-6" />} title="No clients found"
            text={active || stage ? "Try clearing the filters." : "Clients appear here when a lead is converted."}
            action={canAdd ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add client</Button> : undefined} />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      {addOpen && <ClientFormModal initial={{}} onClose={closeAdd} onSaved={(r) => router.push(`/clients/${r.id}`)} />}
    </div>
  );
}

export default function ClientsPage() {
  return <Suspense fallback={<Loading />}><ClientsBoard /></Suspense>;
}
