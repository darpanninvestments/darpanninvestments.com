"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDateTime, fromNow, humanize } from "@/lib/utils";
import { Avatar, Badge, Button, Empty, Input, Loading, PageHeader, Pagination, Select } from "@/components/ui";
import { opts, useList } from "@/components/data";

const ACTIONS = ["create", "update", "delete", "bulk_delete", "bulk_update", "status_change", "assign", "convert", "restore",
  "complete", "reschedule", "upload", "download", "share", "import", "export", "rollback", "configure", "permission_change",
  "login", "logout", "logout_all", "password_change", "password_reset", "webhook"];
const ENTITIES = ["leads", "followups", "clients", "visits", "meetings", "processes", "projects", "properties", "locations",
  "documents", "forms", "imports", "exports", "users", "roles", "companies", "settings", "lead_statuses"];
const TONE: Record<string, "green" | "blue" | "red" | "amber" | "violet" | "slate"> = {
  create: "green", update: "blue", delete: "red", bulk_delete: "red", status_change: "violet", assign: "violet", convert: "green",
  permission_change: "amber", configure: "amber", password_reset: "amber", password_change: "amber", login: "slate", logout: "slate",
};

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export default function AuditPage() {
  const { can, meta } = useAuth();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [f, setF] = useState({ action: "", entity: "", user_id: "", from: "", to: "" });
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setPage(1); };
  const list = useList("/api/audit", {
    q: debounced, page, page_size: pageSize, sort: "-id", action: f.action, entity: f.entity, user_id: f.user_id,
    created_at__gte: dayStart(f.from), created_at__lte: dayEnd(f.to),
  });
  const rows = list.data?.items || [];
  const filtered = Object.values(f).some(Boolean) || !!q;

  if (!can("audit")) return <Empty title="No access" text="You do not have permission to view the audit log." />;
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who changed what, and when. Click a row to see field-level changes." />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search summary…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto min-w-[130px]" placeholder="All actions" value={f.action} onChange={(e) => set({ action: e.target.value })}
            options={ACTIONS.map((a) => ({ value: a, label: humanize(a) }))} />
          <Select className="w-auto min-w-[130px]" placeholder="All entities" value={f.entity} onChange={(e) => set({ entity: e.target.value })}
            options={ENTITIES.map((a) => ({ value: a, label: humanize(a) }))} />
          <Select className="w-auto min-w-[140px]" placeholder="All users" value={f.user_id} onChange={(e) => set({ user_id: e.target.value })} options={opts.users(meta)} />
          <div className="flex w-full items-center gap-1 sm:w-auto">
            <Input type="date" className="w-auto" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
            <span className="text-xs text-muted">to</span>
            <Input type="date" className="w-auto" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
          </div>
          {filtered && <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setQ(""); set({ action: "", entity: "", user_id: "", from: "", to: "" }); }}>Clear</Button>}
        </div>
        {list.isLoading ? <Loading /> : !rows.length ? <Empty title="No audit entries" text={filtered ? "Try different filters." : undefined} /> : (
          <div className="overflow-x-auto">
            <table className={cn("w-full min-w-max text-sm", list.isFetching && "opacity-60")}>
              <thead>
                <tr className="border-b border-border bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Summary</th>
                  <th className="px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const has = r.changes && typeof r.changes === "object" && Object.keys(r.changes).length > 0;
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr onClick={() => has && setOpen(isOpen ? null : r.id)}
                        className={cn("border-b border-slate-100 hover:bg-slate-50/70", has && "cursor-pointer", isOpen && "bg-slate-50")}>
                        <td className="px-2 py-2 text-slate-400">{has && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <div className="text-xs text-slate-700">{fmtDateTime(r.created_at)}</div>
                          <div className="text-[11px] text-muted">{fromNow(r.created_at)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2"><Avatar name={r.user_name} size={22} /><span className="text-xs">{r.user_name}</span></span>
                        </td>
                        <td className="px-3 py-2"><Badge tone={TONE[r.action] || "slate"}>{humanize(r.action)}</Badge></td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{humanize(r.entity)}{r.entity_id ? <span className="text-muted"> #{r.entity_id}</span> : null}</td>
                        <td className="max-w-[420px] whitespace-normal px-3 py-2 text-xs text-slate-700">{r.summary || "—"}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted">{r.ip || "—"}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td />
                          <td colSpan={6} className="px-3 py-3"><Changes changes={r.changes} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
    </div>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? <span className="text-slate-300">empty</span>
  : typeof v === "object" ? <code className="break-all text-[11px]">{JSON.stringify(v)}</code> : String(v));

function Changes({ changes }: { changes: Row }) {
  const entries = Object.entries(changes);
  const isDiff = entries.every(([, v]) => v && typeof v === "object" && !Array.isArray(v) && ("from" in v || "to" in v));
  if (!isDiff) {
    return <pre className="max-h-72 max-w-3xl overflow-auto rounded-lg bg-white p-3 text-[11px] text-slate-700 ring-1 ring-border">{JSON.stringify(changes, null, 2)}</pre>;
  }
  return (
    <table className="max-w-3xl overflow-hidden rounded-lg bg-white text-xs ring-1 ring-border">
      <thead>
        <tr className="bg-slate-50 text-left text-slate-500">
          <th className="px-3 py-1.5 font-medium">Field</th><th className="px-3 py-1.5 font-medium">From</th><th className="px-3 py-1.5 font-medium">To</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-t border-slate-100 align-top">
            <td className="px-3 py-1.5 font-medium text-slate-700">{humanize(k)}</td>
            <td className="max-w-[280px] whitespace-normal px-3 py-1.5 text-red-700/80 line-through decoration-red-300">{show(v.from)}</td>
            <td className="max-w-[280px] whitespace-normal px-3 py-1.5 text-emerald-700">{show(v.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
