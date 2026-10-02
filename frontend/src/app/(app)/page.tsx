"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlarmClock, CalendarCheck, CalendarClock, Eye, EyeOff, FileWarning, Flame, GripVertical, LayoutGrid, MapPin,
  MessageCircle, RotateCcw, Save, Trophy, UserPlus, Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, daysAgoISO, fmtDate, fromNow, startOfTodayISO } from "@/lib/utils";
import { opts } from "@/components/data";
import { FollowUpCenter } from "@/components/followup-center";
import { QuickAddMenu } from "@/components/shell";
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Stat, StatusPill } from "@/components/ui";

// Validated categorical slots (dataviz reference palette, light mode)
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const GRID = "#e2e8f0";
const AXIS = { fontSize: 11, fill: "#64748b" };

type CardCfg = { id: string; visible: boolean; size: string; title?: string };
type Catalog = { id: string; title: string; size: string }[];

const KPI_META: Record<string, { icon: React.ReactNode; tone: string; href: string }> = {
  new_leads_today: { icon: <UserPlus className="h-5 w-5" />, tone: "blue", href: "/leads" },
  unassigned: { icon: <Users className="h-5 w-5" />, tone: "amber", href: "/leads?assigned_to_id=none" },
  followups_today: { icon: <CalendarClock className="h-5 w-5" />, tone: "violet", href: "/followups?bucket=today" },
  followups_overdue: { icon: <AlarmClock className="h-5 w-5" />, tone: "red", href: "/followups?bucket=overdue" },
  hot_leads: { icon: <Flame className="h-5 w-5" />, tone: "pink", href: "/leads?priority=Hot" },
  visits_today: { icon: <MapPin className="h-5 w-5" />, tone: "teal", href: "/visits" },
  meetings_today: { icon: <CalendarCheck className="h-5 w-5" />, tone: "slate", href: "/meetings" },
  whatsapp_leads: { icon: <MessageCircle className="h-5 w-5" />, tone: "green", href: "/leads" },
  conversions: { icon: <Trophy className="h-5 w-5" />, tone: "green", href: "/clients" },
  pending_documents: { icon: <FileWarning className="h-5 w-5" />, tone: "amber", href: "/documents?status=Pending" },
};

const RANGES = [
  { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-800">{label}</p>
      {payload.map((p) => <p key={p.name} className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}: <b className="text-slate-900">{p.value}</b></p>)}
    </div>
  );
}

function SortableCard({ id, editing, children, className }: { id: string; editing: boolean; children: React.ReactNode; className: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(className, "relative", isDragging && "z-10 opacity-80")}>
      {editing && (
        <button type="button" {...attributes} {...listeners} title="Drag to reorder"
          className="absolute -left-1 -top-1 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-full bg-primary text-white shadow">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { me, meta, can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [range, setRange] = useState("30");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CardCfg[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const layout = useQuery({ queryKey: ["dashboard", "layout"], queryFn: () => api.get<{ cards: CardCfg[]; catalog: Catalog }>("/api/dashboard/layout") });
  const cards = draft ?? layout.data?.cards ?? [];
  const setCards = (c: CardCfg[]) => setDraft(c);
  const params = { from: daysAgoISO(Number(range)), day_start: startOfTodayISO(), ...filters };
  const summary = useQuery({ queryKey: ["dashboard", "summary", params], queryFn: () => api.get("/api/dashboard/summary", params), refetchInterval: 120_000 });

  const catalog = layout.data?.catalog || [];
  const titleOf = (c: CardCfg) => c.title || catalog.find((x) => x.id === c.id)?.title || c.id;
  const visible = cards.filter((c) => c.visible);
  const hidden = catalog.filter((c) => !cards.find((x) => x.id === c.id && x.visible));

  const save = useMutation({
    mutationFn: (forRole?: string) => api.put("/api/dashboard/layout", { cards, for_role: forRole }),
    onSuccess: (_r, forRole) => { toast.success(forRole ? `Saved as default for ${forRole}` : "Dashboard saved"); setEditing(false); setDraft(null); qc.invalidateQueries({ queryKey: ["dashboard", "layout"] }); },
  });
  const reset = async () => { await api.del("/api/dashboard/layout"); qc.invalidateQueries({ queryKey: ["dashboard", "layout"] }); setEditing(false); setDraft(null); toast.success("Dashboard reset to default"); };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = cards.map((c) => c.id);
    setCards(arrayMove(cards, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  const update = (id: string, patch: Partial<CardCfg>) => setCards(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCard = (c: { id: string; size: string }) => setCards([...cards.filter((x) => x.id !== c.id), { id: c.id, visible: true, size: c.size }]);

  const s = summary.data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const renderCard = (c: CardCfg) => {
    if (!s) return <div className="card h-full"><Loading /></div>;
    if (KPI_META[c.id]) {
      const k = KPI_META[c.id];
      return <Stat label={titleOf(c)} value={s[c.id] ?? 0} icon={k.icon} tone={k.tone} onClick={editing ? undefined : () => router.push(k.href)} />;
    }
    const body = (() => {
      switch (c.id) {
        case "followup_center":
          return <FollowUpCenter compact />;
        case "source_performance":
          return !s.source_performance.length ? <Empty title="No leads in this period" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={s.source_performance} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={AXIS} width={130} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "#f1f5f9" }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="leads" name="Leads" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={10} />
                <Bar dataKey="converted" name="Converted" fill={SERIES[2]} radius={[0, 4, 4, 0]} barSize={10} />
              </BarChart>
            </ResponsiveContainer>
          );
        case "project_demand":
          return !s.project_demand.length ? <Empty title="No leads in this period" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={s.project_demand} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={AXIS} width={130} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="leads" name="Leads" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={14} label={{ position: "right", fontSize: 11, fill: "#334155" }} />
              </BarChart>
            </ResponsiveContainer>
          );
        case "conversion_funnel": {
          const max = Math.max(1, ...s.conversion_funnel.map((f: Row) => f.count));
          return (
            <div className="space-y-2">
              {s.conversion_funnel.map((f: Row) => (
                <Link key={f.name} href={`/leads`} className="group block">
                  <div className="mb-0.5 flex justify-between text-xs"><span className="text-slate-600 group-hover:text-slate-900">{f.name}</span><span className="font-semibold text-slate-900">{f.count}</span></div>
                  <div className="h-2.5 rounded-full bg-slate-100"><div className="h-2.5 rounded-full transition-all" style={{ width: `${Math.max(2, (100 * f.count) / max)}%`, background: f.color }} /></div>
                </Link>
              ))}
            </div>
          );
        }
        case "lost_leads":
          return !s.lost_leads.length ? <Empty title="No lost leads" /> : (
            <ul className="space-y-2 text-sm">{s.lost_leads.map((l: Row) => (
              <li key={l.name} className="flex items-center justify-between"><span className="text-slate-600">{l.name}</span><Badge tone="red">{l.count}</Badge></li>))}</ul>
          );
        case "lead_trend":
          return !s.lead_trend.length ? <Empty title="No leads in this period" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={s.lead_trend.map((d: Row) => ({ ...d, label: fmtDate(d.date, "dd MMM") }))} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: "#94a3b8", strokeDasharray: 3 }} />
                <Line type="monotone" dataKey="leads" name="New leads" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          );
        case "agent_performance":
          return !s.agent_performance.length ? <Empty title="No agent activity yet" /> : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead><tr className="border-b border-border text-left text-slate-500">{["Agent", "Assigned", "Contacted", "Follow-ups", "Overdue", "Visits", "Meetings", "Converted", "Conv. %"].map((h) => <th key={h} className="px-4 py-1.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>{s.agent_performance.map((a: Row) => (
                  <tr key={a.user_id} className="border-b border-slate-50">
                    <td className="px-4 py-1.5 font-medium text-slate-800">{a.name}</td><td className="px-4">{a.assigned}</td><td className="px-4">{a.contacted}</td>
                    <td className="px-4">{a.followups_done}</td><td className={cn("px-4", a.followups_overdue && "font-semibold text-danger")}>{a.followups_overdue}</td>
                    <td className="px-4">{a.visits}</td><td className="px-4">{a.meetings}</td><td className="px-4 font-semibold text-emerald-700">{a.converted}</td><td className="px-4">{a.conversion_rate}%</td>
                  </tr>))}</tbody>
              </table>
            </div>
          );
        case "import_activity":
          return !s.import_activity.length ? <Empty title="No imports yet" /> : (
            <ul className="space-y-2 text-sm">{s.import_activity.map((i: Row) => (
              <li key={i.id} className="flex items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate">{i.file_name}</span>
                <span className="text-xs text-muted">{i.success_count} ok · {i.failed_count} failed · {fromNow(i.created_at)}</span></span><StatusPill value={i.status} /></li>))}</ul>
          );
        case "notification_center":
          return !s.notification_center.length ? <Empty title="No notifications" /> : (
            <ul className="space-y-2 text-sm">{s.notification_center.map((n: Row) => (
              <li key={n.id}><Link href={n.link || "/notifications"} className="block rounded-md p-1 hover:bg-slate-50">
                <span className={cn("block truncate", !n.is_read && "font-medium")}>{n.title}</span><span className="text-xs text-muted">{fromNow(n.created_at)}</span></Link></li>))}</ul>
          );
        case "recent_leads":
          return !s.recent_leads.length ? <Empty title="No leads yet" /> : (
            <ul className="divide-y divide-slate-50 text-sm">{s.recent_leads.map((l: Row) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/leads/${l.id}`} className="min-w-0 truncate hover:text-primary">{l.name} <span className="text-xs text-muted">{l.code}</span></Link>
                <Badge color={l.color}>{l.status || "—"}</Badge></li>))}</ul>
          );
        default:
          return <Empty title="Unknown card" />;
      }
    })();
    return (
      <Card className="h-full" title={editing ? <Input className="h-7 w-48 text-xs" value={titleOf(c)} onChange={(e) => update(c.id, { title: e.target.value })} /> : titleOf(c)}
        bodyClass={c.id === "followup_center" ? "p-0" : "p-4"}
        actions={editing && (
          <div className="flex items-center gap-1">
            <Select className="h-7 w-auto py-0 text-xs" value={c.size === "wide" ? "wide" : "half"} onChange={(e) => update(c.id, { size: e.target.value === "wide" ? "wide" : "chart" })}
              options={[{ value: "half", label: "Half width" }, { value: "wide", label: "Full width" }]} />
            <button type="button" title="Hide card" onClick={() => update(c.id, { visible: false })} className="text-slate-400 hover:text-danger"><EyeOff className="h-4 w-4" /></button>
          </div>
        )}>
        {body}
      </Card>
    );
  };

  const kpis = visible.filter((c) => KPI_META[c.id]);
  const others = visible.filter((c) => !KPI_META[c.id]);
  const roleOptions = useMemo(() => ["agent", "team_lead", "manager", "company_admin"], []);

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={`${greeting}, ${me?.user.name?.split(" ")[0] || ""}`} subtitle="Here's what needs your attention today."
        actions={editing ? (<>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>Reset</Button>
          {can("settings", "configure") && (
            <Select className="h-8 w-auto text-xs" value="" placeholder="Save as role default…" options={roleOptions.map((r) => ({ value: r, label: r.replace("_", " ") }))}
              onChange={(e) => e.target.value && save.mutate(e.target.value)} />
          )}
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(null); }}>Cancel</Button>
          <Button size="sm" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save layout</Button>
        </>) : (<>
          {can("dashboard", "configure") && <Button size="sm" variant="outline" icon={<LayoutGrid className="h-4 w-4" />} onClick={() => setEditing(true)}>Customize</Button>}
          <QuickAddMenu />
        </>)} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
        {me?.is_global && <Select className="w-auto" value={filters.company_id || ""} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })} placeholder="All companies" options={opts.companies(meta)} />}
        {me?.role.level !== 20 && <Select className="w-auto" value={filters.assigned_to_id || ""} onChange={(e) => setFilters({ ...filters, assigned_to_id: e.target.value })} placeholder="All agents" options={opts.users(meta)} />}
        <Select className="w-auto" value={filters.project_id || ""} onChange={(e) => setFilters({ ...filters, project_id: e.target.value })} placeholder="All projects" options={opts.projects(meta)} />
        <Select className="w-auto" value={filters.source_id || ""} onChange={(e) => setFilters({ ...filters, source_id: e.target.value })} placeholder="All sources" options={opts.sources(meta)} />
        {Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => setFilters({})}>Clear</Button>}
        {s && <span className="ml-auto text-xs text-muted">{s.total_leads} leads · {s.conversions} conversions in period</span>}
      </div>

      {editing && hidden.length > 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-primary/40 bg-primary-soft/50 p-3">
          <p className="mb-2 text-xs font-medium text-primary">Add cards to your dashboard</p>
          <div className="flex flex-wrap gap-1.5">{hidden.map((c) => <Button key={c.id} size="xs" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => addCard(c)}>{c.title}</Button>)}</div>
        </div>
      )}

      {layout.isLoading ? <Loading /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
            {kpis.length > 0 && (
              <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
                {kpis.map((c) => (
                  <SortableCard key={c.id} id={c.id} editing={editing} className="">
                    {editing && <button type="button" onClick={() => update(c.id, { visible: false })} className="absolute right-1 top-1 z-10 text-slate-400 hover:text-danger" title="Hide"><EyeOff className="h-3.5 w-3.5" /></button>}
                    {renderCard(c)}
                  </SortableCard>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {others.map((c) => (
                <SortableCard key={c.id} id={c.id} editing={editing} className={c.size === "wide" ? "xl:col-span-2" : ""}>{renderCard(c)}</SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
