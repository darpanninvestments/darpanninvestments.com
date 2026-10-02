"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download, Printer } from "lucide-react";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fmtDate, fmtDateTime, humanize, money } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, StatusPill } from "@/components/ui";
import { downloadCSV } from "@/components/forms-kit";

// Validated categorical order (dataviz reference palette, light surface) – assigned in fixed order, never cycled.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const GRID = "#e2e8f0";
const INK2 = "#475569";

type Col = { key: string; label: string; num?: boolean; sum?: boolean; fmt?: (v: unknown, r: Row) => ReactNode; csv?: (v: unknown, r: Row) => unknown };
type TableSpec = { title?: string; cols: Col[]; rows: Row[]; totals?: Row | null };
type ChartSpec = { title: string; rows: Row[]; series: { key: string; label: string }[]; stacked?: boolean; category?: string };
type View = { stats?: { label: string; value: ReactNode }[]; charts: ChartSpec[]; tables: TableSpec[]; custom?: ReactNode };

// ── Date presets ───────────────────────────────────────────────────────────────
const PRESETS = [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
  { value: "month", label: "This month" }, { value: "custom", label: "Custom range" }];

function rangeFor(preset: string, cFrom: string, cTo: string, today: string) {
  const end = new Date(`${today}T23:59:59.999`);
  if (preset === "custom") {
    return {
      from: cFrom ? new Date(`${cFrom}T00:00:00`).toISOString() : undefined,
      to: cTo ? new Date(`${cTo}T23:59:59.999`).toISOString() : undefined,
    };
  }
  const start = new Date(`${today}T00:00:00`);
  if (preset === "month") start.setDate(1);
  else start.setDate(start.getDate() - Number(preset) + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const n = (v: unknown) => Number(v || 0);
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const sumRows = (rows: Row[], cols: Col[]) =>
  Object.fromEntries(cols.filter((c) => c.sum).map((c) => [c.key, rows.reduce((s, r) => s + n(r[c.key]), 0)]));
const numCols = (keys: string[], sum = true): Col[] => keys.map((k) => ({ key: k, label: humanize(k), num: true, sum }));
const rateCol: Col = { key: "conversion_rate", label: "Conv. %", num: true, fmt: (v) => `${n(v)}%` };
/** keys present in rows other than the given fixed ones (e.g. dynamic status columns) */
const dynamicKeys = (rows: Row[], fixed: string[]) => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).filter((k) => !fixed.includes(k));

const STATUS_ORDER = ["Scheduled", "Confirmed", "Rescheduled", "Completed", "Cancelled", "No Show", "Available", "Hold", "Reserved", "Booked", "Sold", "Blocked",
  "Pending", "Uploaded", "Verified", "Rejected", "Expired"];
const orderStatuses = (keys: string[]) => [...keys].sort((a, b) => {
  const ia = STATUS_ORDER.indexOf(a), ib = STATUS_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});

function buildView(key: string, d: Row): View {
  const rows: Row[] = d.rows || [];
  switch (key) {
    case "lead-source":
    case "project": {
      const extra = key === "project" ? ["visits", "meetings"] : ["visits"];
      const cols: Col[] = [{ key: "name", label: key === "project" ? "Project" : "Source" },
        ...numCols(["leads", "contacted", "interested", "converted", "lost", ...extra]), rateCol];
      const totals = sumRows(rows, cols);
      totals.conversion_rate = pct(n(totals.converted), n(totals.leads));
      const tables: TableSpec[] = [{ cols, rows, totals }];
      if (d.campaigns?.length) tables.push({ title: "Top campaigns", cols: [{ key: "name", label: "Source / campaign" }, ...numCols(["leads"])], rows: d.campaigns, totals: null });
      return {
        stats: [{ label: "Leads", value: n(totals.leads).toLocaleString() }, { label: "Converted", value: n(totals.converted).toLocaleString() },
          { label: "Conversion rate", value: `${totals.conversion_rate}%` }, { label: "Lost", value: n(totals.lost).toLocaleString() }],
        charts: [{ title: `Leads and conversions by ${key === "project" ? "project" : "source"}`, rows: rows.slice(0, 15),
          series: [{ key: "leads", label: "Leads" }, { key: "converted", label: "Converted" }] }],
        tables,
      };
    }
    case "agent-performance": {
      const cols: Col[] = [{ key: "name", label: "Agent" },
        ...numCols(["assigned", "contacted", "calls", "followups_done", "followups_overdue", "visits", "meetings", "hot", "converted"]), rateCol];
      const totals = sumRows(rows, cols);
      totals.conversion_rate = pct(n(totals.converted), n(totals.assigned));
      return {
        charts: [{ title: "Assigned vs converted by agent", rows: rows.slice(0, 15), series: [{ key: "assigned", label: "Assigned" }, { key: "converted", label: "Converted" }] }],
        tables: [{ cols, rows, totals }],
      };
    }
    case "team": {
      const cols: Col[] = [{ key: "name", label: "Team" }, ...numCols(["agents", "assigned", "contacted", "followups_done", "visits", "meetings", "converted"])];
      return {
        charts: [{ title: "Assigned vs converted by team", rows, series: [{ key: "assigned", label: "Assigned" }, { key: "converted", label: "Converted" }] }],
        tables: [{ cols, rows, totals: sumRows(rows, cols) }],
      };
    }
    case "follow-up": {
      const rs = rows.map((r) => ({ ...r, upcoming: Math.max(n(r.pending) - n(r.overdue), 0) }));
      const cols: Col[] = [{ key: "name", label: "Agent" }, ...numCols(["total", "completed", "pending", "overdue", "rescheduled"]),
        { key: "rate", label: "Done %", num: true, fmt: (_v, r) => `${pct(n(r.completed), n(r.total))}%`, csv: (_v, r) => pct(n(r.completed), n(r.total)) }];
      const totals = sumRows(rs, cols);
      return {
        stats: [{ label: "Follow-ups due", value: n(totals.total).toLocaleString() }, { label: "Completed", value: n(totals.completed).toLocaleString() },
          { label: "Overdue", value: n(totals.overdue).toLocaleString() }, { label: "Completion", value: `${pct(n(totals.completed), n(totals.total))}%` }],
        charts: [{ title: "Follow-up status by agent", rows: rs, stacked: true,
          series: [{ key: "completed", label: "Completed" }, { key: "upcoming", label: "Pending (not yet due)" }, { key: "overdue", label: "Overdue" }] }],
        tables: [{ cols, rows: rs, totals }],
      };
    }
    case "visit":
    case "meeting": {
      const fixed = ["name", "total", "converted_after"];
      const sts = orderStatuses(dynamicKeys(rows, fixed));
      const cols: Col[] = [{ key: "name", label: key === "visit" ? "Agent" : "Host" }, ...sts.map((s) => ({ key: s, label: s, num: true, sum: true })),
        ...numCols(["total"]), ...(key === "visit" ? [{ key: "converted_after", label: "Converted after visit", num: true, sum: true }] : [])];
      const tables: TableSpec[] = [{ cols, rows, totals: sumRows(rows, cols) }];
      if (d.outcomes?.length) tables.push({ title: "Outcomes", cols: [{ key: "name", label: "Outcome" }, ...numCols(["count"])], rows: d.outcomes, totals: null });
      return {
        charts: [{ title: `${key === "visit" ? "Site visits" : "Meetings"} by status`, rows, stacked: true, series: sts.slice(0, 8).map((s) => ({ key: s, label: s })) }],
        tables,
      };
    }
    case "property": {
      const fixed = ["name", "total", "value"];
      const av = orderStatuses(dynamicKeys(rows, fixed));
      const cols: Col[] = [{ key: "name", label: "Project" }, ...av.map((s) => ({ key: s, label: s, num: true, sum: true })), ...numCols(["total"]),
        { key: "value", label: "Inventory value", num: true, sum: true, fmt: (v) => money(n(v)) }];
      return {
        charts: [{ title: "Inventory by availability", rows, stacked: true, series: av.slice(0, 8).map((s) => ({ key: s, label: s })) }],
        tables: [{ cols, rows, totals: sumRows(rows, cols) }],
      };
    }
    case "lost-lead": {
      const byReason: Record<string, number> = {};
      rows.forEach((r) => { byReason[r.reason] = (byReason[r.reason] || 0) + n(r.count); });
      const reasons = Object.entries(byReason).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      const cols: Col[] = [{ key: "reason", label: "Reason" }, { key: "source", label: "Source" }, { key: "project", label: "Project" },
        { key: "agent", label: "Agent" }, ...numCols(["count"])];
      return {
        charts: [{ title: "Lost leads by reason", rows: reasons.slice(0, 15), series: [{ key: "count", label: "Lost leads" }] }],
        tables: [{ cols, rows, totals: sumRows(rows, cols) }],
      };
    }
    case "conversion-funnel": {
      const cols: Col[] = [
        { key: "name", label: "Status", fmt: (v, r) => <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{String(v)}</span>, csv: (v) => v },
        { key: "category", label: "Category", fmt: (v) => humanize(String(v || "")) },
        { key: "count", label: "Leads", num: true, sum: true }, { key: "share", label: "Share %", num: true, fmt: (v) => `${n(v)}%` },
        { key: "reached", label: "At or beyond", num: true }];
      return {
        stats: [{ label: "Leads in period", value: n(d.total).toLocaleString() }, { label: "Converted", value: n(d.converted).toLocaleString() },
          { label: "Conversion rate", value: `${pct(n(d.converted), n(d.total))}%` }],
        charts: [],
        custom: <Funnel rows={rows} />,
        tables: [{ cols, rows, totals: sumRows(rows, cols) }],
      };
    }
    case "activity": {
      const types = dynamicKeys(rows, ["name", "total"]).sort();
      const cols: Col[] = [{ key: "name", label: "User" }, ...types.map((t) => ({ key: t, label: humanize(t), num: true, sum: true })), ...numCols(["total"])];
      return {
        charts: [{ title: "Activities logged by user", rows: rows.slice(0, 15), series: [{ key: "total", label: "Activities" }] }],
        tables: [{ cols, rows, totals: sumRows(rows, cols) }],
      };
    }
    case "document": {
      const sts = orderStatuses(Array.from(new Set(rows.map((r) => String(r.status)))));
      const pivot: Record<string, Row> = {};
      rows.forEach((r) => {
        const p = (pivot[r.category || "Uncategorised"] ||= { name: r.category || "Uncategorised", total: 0 });
        p[r.status] = n(p[r.status]) + n(r.count);
        p.total += n(r.count);
      });
      const prow = Object.values(pivot).sort((a, b) => b.total - a.total);
      const cols: Col[] = [{ key: "name", label: "Category" }, ...sts.map((s) => ({ key: s, label: s, num: true, sum: true })), ...numCols(["total"])];
      const totals = sumRows(prow, cols);
      return {
        stats: [{ label: "Documents", value: n(totals.total).toLocaleString() }, { label: "Pending", value: n(totals.Pending).toLocaleString() },
          { label: "Shared in period", value: n(d.shared).toLocaleString() }, { label: "Expired", value: n(d.expired).toLocaleString() }],
        charts: [{ title: "Documents by category and status", rows: prow, stacked: true, series: sts.slice(0, 8).map((s) => ({ key: s, label: s })) }],
        tables: [{ cols, rows: prow, totals }],
      };
    }
    case "import-export": {
      const imp: Row[] = d.imports || [], exp: Row[] = d.exports || [];
      const impCols: Col[] = [{ key: "created_at", label: "Date", fmt: (v) => fmtDateTime(v as string), csv: (v) => v },
        { key: "file_name", label: "File" }, { key: "module", label: "Module", fmt: (v) => humanize(String(v)) }, { key: "user_name", label: "By" },
        { key: "mode", label: "Mode" }, ...numCols(["total_rows", "success_count", "failed_count", "duplicate_count"]),
        { key: "status", label: "Status", fmt: (v) => <StatusPill value={String(v)} />, csv: (v) => v }];
      const expCols: Col[] = [{ key: "created_at", label: "Date", fmt: (v) => fmtDateTime(v as string), csv: (v) => v },
        { key: "module", label: "Module", fmt: (v) => humanize(String(v)) }, { key: "user_name", label: "By" },
        { key: "format", label: "Format", fmt: (v) => String(v || "").toUpperCase() }, ...numCols(["record_count"])];
      const it = sumRows(imp, impCols);
      return {
        stats: [{ label: "Imports", value: imp.length }, { label: "Rows imported", value: n(it.success_count).toLocaleString() },
          { label: "Rows failed", value: n(it.failed_count).toLocaleString() }, { label: "Exports", value: exp.length }],
        charts: [],
        tables: [{ title: "Imports", cols: impCols, rows: imp, totals: imp.length ? it : null },
          { title: "Exports", cols: expCols, rows: exp, totals: exp.length ? sumRows(exp, expCols) : null }],
      };
    }
    default:
      return { charts: [], tables: rows.length ? [{ cols: Object.keys(rows[0]).map((k) => ({ key: k, label: humanize(k), num: typeof rows[0][k] === "number" })), rows }] : [] };
  }
}

// ── Charts ─────────────────────────────────────────────────────────────────────
function HBarChart({ spec }: { spec: ChartSpec }) {
  const cat = spec.category || "name";
  const multi = spec.series.length > 1;
  const h = Math.max(160, spec.rows.length * (multi && !spec.stacked ? 40 : 30) + (multi ? 70 : 40));
  const longest = Math.max(...spec.rows.map((r) => String(r[cat] ?? "").length), 4);
  return (
    <div style={{ height: h }} role="img" aria-label={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={spec.rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
          barCategoryGap={multi && !spec.stacked ? "20%" : "28%"} barGap={2}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: INK2 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={cat} width={Math.min(170, longest * 6.5 + 12)} tick={{ fontSize: 11, fill: INK2 }}
            axisLine={{ stroke: GRID }} tickLine={false} interval={0}
            tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
          <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }}
            contentStyle={{ borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,.08)" }} />
          {multi && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: INK2 }} />}
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} maxBarSize={20} stackId={spec.stacked ? "a" : undefined}
              stroke={spec.stacked ? "#fff" : undefined} strokeWidth={spec.stacked ? 1 : 0}
              radius={!spec.stacked || i === spec.series.length - 1 ? [0, 4, 4, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Funnel({ rows }: { rows: Row[] }) {
  const max = Math.max(...rows.map((r) => n(r.count)), 1);
  return (
    <Card title="Leads by status (pipeline order)">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
            <span className="truncate text-slate-700" title={r.name}>{r.name}</span>
            <span className="h-5 rounded bg-slate-100">
              <span className="block h-full rounded" style={{ width: `${(100 * n(r.count)) / max}%`, minWidth: n(r.count) ? 4 : 0, background: r.color || SERIES[0] }}
                title={`${r.name}: ${r.count}`} />
            </span>
            <span className="w-24 text-right tabular-nums text-slate-700">{n(r.count).toLocaleString()} <span className="text-xs text-muted">({n(r.share)}%)</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportTable({ spec }: { spec: TableSpec }) {
  if (!spec.rows.length) return <Empty title="No data for this period" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-slate-50/80 text-left text-xs font-medium text-slate-500">
            {spec.cols.map((c) => <th key={c.key} className={cn("whitespace-nowrap px-3 py-2", c.num && "text-right")}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
              {spec.cols.map((c) => (
                <td key={c.key} className={cn("px-3 py-2", c.num && "text-right tabular-nums")}>
                  {c.fmt ? c.fmt(r[c.key], r) : c.num ? n(r[c.key]).toLocaleString() : (r[c.key] ?? <span className="text-slate-300">—</span>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {spec.totals && (
          <tfoot>
            <tr className="border-t-2 border-border bg-slate-50 font-semibold text-slate-800">
              {spec.cols.map((c, i) => (
                <td key={c.key} className={cn("px-3 py-2", c.num && "text-right tabular-nums")}>
                  {i === 0 ? "Total" : spec.totals![c.key] === undefined ? "" : c.fmt ? c.fmt(spec.totals![c.key], spec.totals!) : n(spec.totals![c.key]).toLocaleString()}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
function ReportsPage() {
  const { can, me, meta } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const [key, setKey] = useState(sp.get("r") || "lead-source");
  const [preset, setPreset] = useState("30");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const today = fmtDate(new Date().toISOString(), "yyyy-MM-dd");
  const range = useMemo(() => rangeFor(preset, cFrom, cTo, today), [preset, cFrom, cTo, today]);
  const params = { ...range, ...f };

  const reports = useQuery({ queryKey: ["/api/reports"], queryFn: () => api.get<{ key: string; name: string }[]>("/api/reports") });
  const report = useQuery({
    queryKey: ["/api/reports", key, params],
    queryFn: () => api.get(`/api/reports/${key}`, params),
    placeholderData: keepPreviousData,
  });
  const view = useMemo(() => (report.data ? buildView(key, report.data) : null), [key, report.data]);
  const pick = (k: string) => { setKey(k); router.replace(`/reports?r=${k}`); };
  const title = reports.data?.find((r) => r.key === key)?.name || humanize(key);

  const exportCsv = () => {
    if (!view?.tables.length) return;
    const t = view.tables[0];
    const val = (c: Col, r: Row) => (c.csv ? c.csv(r[c.key], r) : r[c.key]);
    const rows = t.rows.map((r) => t.cols.map((c) => val(c, r)));
    if (t.totals) rows.push(t.cols.map((c, i) => (i === 0 ? "Total" : t.totals![c.key] ?? "")));
    downloadCSV(`${key}-${(range.from || "").slice(0, 10)}_to_${(range.to || "").slice(0, 10)}`, t.cols.map((c) => c.label), rows);
  };

  const filterSel = (k: string, label: string, options: { value: number | string; label: string }[]) => (
    <Select className="w-auto min-w-[140px]" placeholder={label} value={f[k] || ""} options={options}
      onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );

  return (
    <div>
      <PageHeader title="Reports" subtitle={<span className="hidden print:inline">{title} · {fmtDate(range.from)} – {fmtDate(range.to)}</span>}
        actions={<div className="no-print flex gap-2">
          {can("reports", "export") && (
            <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} disabled={!view?.tables[0]?.rows.length} onClick={exportCsv}>Export CSV</Button>
          )}
          <Button size="sm" variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>
        </div>} />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="no-print">
          <div className="lg:hidden">
            <Select value={key} options={(reports.data || []).map((r) => ({ value: r.key, label: r.name }))} onChange={(e) => pick(e.target.value)} />
          </div>
          <ul className="card hidden p-1.5 lg:block">
            {(reports.data || []).map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => pick(r.key)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                    key === r.key ? "bg-primary-soft font-medium text-primary" : "text-slate-600 hover:bg-slate-50")}>
                  <BarChart3 className="h-3.5 w-3.5 shrink-0 opacity-60" />{r.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <div className="card no-print flex flex-wrap items-end gap-2 p-3">
            <Field label="Period">
              <Select className="w-auto" value={preset} options={PRESETS} onChange={(e) => setPreset(e.target.value)} />
            </Field>
            {preset === "custom" && <>
              <Field label="From"><Input type="date" className="w-auto" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" className="w-auto" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} /></Field>
            </>}
            {me?.is_global && filterSel("company_id", "All companies", (meta?.companies || []).map((c) => ({ value: c.id, label: c.name })))}
            {filterSel("assigned_to_id", "All agents", (meta?.users || []).map((u) => ({ value: u.id, label: u.name })))}
            {filterSel("project_id", "All projects", (meta?.projects || []).map((p) => ({ value: p.id, label: p.name })))}
            {filterSel("source_id", "All sources", (meta?.sources || []).map((s) => ({ value: s.id, label: s.name })))}
            {Object.values(f).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => setF({})}>Clear</Button>}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <span className="text-xs text-muted">{range.from ? fmtDate(range.from) : "Last 30 days"} – {range.to ? fmtDate(range.to) : "today"}
              {report.isFetching && view && <span className="ml-2 text-primary">Updating…</span>}</span>
          </div>

          {report.isLoading || !view ? (report.isError ? <Empty title="Could not load report" text={(report.error as Error)?.message} /> : <Loading />) : (
            <div className={cn("space-y-4 transition-opacity", report.isFetching && "opacity-70")}>
              {view.stats && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {view.stats.map((s) => (
                    <div key={s.label} className="card p-3">
                      <p className="text-xs text-muted">{s.label}</p>
                      <p className="text-xl font-semibold tracking-tight text-slate-900">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {view.custom}
              {view.charts.filter((c) => c.rows.length > 0).map((c) => (
                <Card key={c.title} title={c.title} actions={c.rows.length >= 15 && ["lead-source", "project", "agent-performance", "lost-lead", "activity"].includes(key) ? <Badge>Top 15</Badge> : undefined}>
                  <HBarChart spec={c} />
                </Card>
              ))}
              {view.tables.map((t, i) => (
                <Card key={i} title={t.title || "Details"} bodyClass="p-0"><ReportTable spec={t} /></Card>
              ))}
              {!view.tables.length && <Card><Empty title="No data for this period" /></Card>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><ReportsPage /></Suspense>;
}
