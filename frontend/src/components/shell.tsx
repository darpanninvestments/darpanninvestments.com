"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Bell, Building, Building2, CalendarCheck, CalendarClock, ChevronDown, ClipboardList, FileText, FolderKanban, FormInput, Home, KeyRound, LayoutDashboard, LayoutGrid, LogOut, MapPin, Plus, Search, Settings, ShieldCheck, Upload, UserCircle, UserPlus, UserSquare2, Users, Workflow, X,
} from "lucide-react";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, fromNow } from "@/lib/utils";
import { Avatar, Loading, Menu, MenuItem } from "./ui";

type NavItem = { href: string; label: string; icon: ReactNode; module: string; action?: string; badge?: number };

const NAV: { section: string; items: NavItem[] }[] = [
  { section: "", items: [
    { href: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, module: "dashboard" },
  ] },
  { section: "Sales", items: [
    { href: "/leads", label: "Lead Board", icon: <UserPlus className="h-4 w-4" />, module: "leads" },
    { href: "/followups", label: "Follow-Ups", icon: <CalendarClock className="h-4 w-4" />, module: "followups" },
    { href: "/visits", label: "Site Visits", icon: <MapPin className="h-4 w-4" />, module: "visits" },
    { href: "/meetings", label: "Meetings", icon: <CalendarCheck className="h-4 w-4" />, module: "meetings" },
    { href: "/clients", label: "Clients", icon: <UserSquare2 className="h-4 w-4" />, module: "clients" },
  ] },
  { section: "Inventory", items: [
    { href: "/processes", label: "Processes", icon: <Workflow className="h-4 w-4" />, module: "processes" },
    { href: "/projects", label: "Projects", icon: <FolderKanban className="h-4 w-4" />, module: "projects" },
    { href: "/properties", label: "Properties", icon: <Home className="h-4 w-4" />, module: "properties" },
    { href: "/locations", label: "Locations", icon: <MapPin className="h-4 w-4" />, module: "locations" },
  ] },
  { section: "Workspace", items: [
    { href: "/documents", label: "Documents", icon: <FileText className="h-4 w-4" />, module: "documents" },
    { href: "/forms", label: "Forms", icon: <FormInput className="h-4 w-4" />, module: "forms" },
    { href: "/reports", label: "Reports", icon: <BarChart3 className="h-4 w-4" />, module: "reports" },
    { href: "/imports", label: "Import / Export", icon: <Upload className="h-4 w-4" />, module: "imports" },
  ] },
  { section: "Administration", items: [
    { href: "/users", label: "Users & Teams", icon: <Users className="h-4 w-4" />, module: "users" },
    { href: "/roles", label: "Roles & Permissions", icon: <ShieldCheck className="h-4 w-4" />, module: "roles" },
    { href: "/companies", label: "Companies", icon: <Building2 className="h-4 w-4" />, module: "companies" },
    { href: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" />, module: "settings" },
    { href: "/audit", label: "Audit Log", icon: <ClipboardList className="h-4 w-4" />, module: "audit" },
  ] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, me } = useAuth();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <Link href="/" onClick={onNavigate} className="block px-5 pb-3 pt-4">
        <Image src="/logo.png" alt="Darpann Investments" width={1280} height={398} priority className="h-auto w-full max-w-[190px]" />
        <span className="mt-1.5 block truncate text-[11px] text-slate-400">CRM · {me?.company?.name || "All companies"}</span>
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(i.module, i.action || "view") || (i.module === "imports" && can("exports")));
          if (!items.length) return null;
          return (
            <div key={g.section} className="mt-3">
              {g.section && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.section}</p>}
              {items.map((i) => {
                const active = i.href === "/" ? pathname === "/" : pathname.startsWith(i.href);
                return (
                  <Link key={i.href} href={i.href} onClick={onNavigate}
                    className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                      active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white")}>
                    {i.icon}{i.label}
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void } = {}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); setOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const res = useQuery({ queryKey: ["search", debounced], queryFn: () => api.get<Row[]>("/api/search", { q: debounced }), enabled: debounced.length >= 2 });
  const labels: Record<string, string> = { leads: "Lead", clients: "Client", projects: "Project", properties: "Property" };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input ref={ref} value={q} autoFocus={autoFocus} type="search" enterKeyHint="search" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search leads, clients, projects, IDs…"
        className="h-10 w-full rounded-lg border border-border bg-slate-50 pl-9 pr-3 text-base outline-none focus:border-primary focus:bg-white md:h-9 md:text-sm" />
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-96 overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-xl">
          {res.isLoading ? <Loading label="Searching…" /> : !res.data?.length ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No matches for “{debounced}”</p>
          ) : res.data.map((r) => (
            <button key={`${r.type}-${r.id}`} type="button" onMouseDown={() => { router.push(r.link); setOpen(false); setQ(""); onDone?.(); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
              <span className="w-16 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-600">{labels[r.type]}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted">{r.subtitle}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications", "bell"], queryFn: () => api.get("/api/notifications", { page_size: 8 }), refetchInterval: 60_000 });
  const markAll = async () => { await api.post("/api/notifications/read", {}); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  return (
    <Menu width="w-80" trigger={(t) => (
      <button type="button" onClick={t} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
    )}>
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={markAll}>Mark all read</button>
          </div>
          {!data?.items?.length ? <p className="px-3 py-6 text-center text-sm text-muted">You&apos;re all caught up</p> :
            data.items.map((n: Row) => (
              <button key={n.id} type="button" onClick={async () => {
                close(); if (!n.is_read) { await api.post("/api/notifications/read", { ids: [n.id] }); qc.invalidateQueries({ queryKey: ["notifications"] }); }
                if (n.link) router.push(n.link);
              }} className={cn("block w-full border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50", !n.is_read && "bg-blue-50/50")}>
                <span className="flex items-start gap-2">
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="block text-[10px] text-slate-400">{fromNow(n.created_at)}</span>
                  </span>
                </span>
              </button>
            ))}
          <Link href="/notifications" onClick={close} className="block px-3 py-2 text-center text-xs font-medium text-primary hover:bg-slate-50">View all</Link>
        </div>
      )}
    </Menu>
  );
}

function useQuickAddItems() {
  const { can } = useAuth();
  return [
    { label: "Add Lead", href: "/leads?new=1", m: "leads", a: "add", icon: <UserPlus className="h-4 w-4" /> },
    { label: "Import Leads", href: "/imports?new=1", m: "imports", a: "import", icon: <Upload className="h-4 w-4" /> },
    { label: "Schedule Visit", href: "/visits?new=1", m: "visits", a: "add", icon: <MapPin className="h-4 w-4" /> },
    { label: "Schedule Meeting", href: "/meetings?new=1", m: "meetings", a: "add", icon: <CalendarCheck className="h-4 w-4" /> },
    { label: "Add Client", href: "/clients?new=1", m: "clients", a: "add", icon: <UserSquare2 className="h-4 w-4" /> },
    { label: "Add Project", href: "/projects?new=1", m: "projects", a: "add", icon: <FolderKanban className="h-4 w-4" /> },
    { label: "Add Property", href: "/properties?new=1", m: "properties", a: "add", icon: <Building className="h-4 w-4" /> },
    { label: "Create Form", href: "/forms?new=1", m: "forms", a: "add", icon: <FormInput className="h-4 w-4" /> },
  ].filter((i) => can(i.m, i.a));
}

export function QuickAddMenu() {
  const router = useRouter();
  const items = useQuickAddItems();
  if (!items.length) return null;
  return (
    <Menu trigger={(t) => (
      <button type="button" onClick={t} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover">
        <Plus className="h-4 w-4" /><span className="hidden sm:inline">Quick add</span>
      </button>
    )}>
      {(close) => items.map((i) => <MenuItem key={i.href} icon={i.icon} onClick={() => { close(); router.push(i.href); }}>{i.label}</MenuItem>)}
    </Menu>
  );
}

function UserMenu() {
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = async () => { try { await api.post("/api/auth/logout"); } finally { qc.clear(); router.replace("/login"); } };
  return (
    <Menu trigger={(t) => (
      <button type="button" onClick={t} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100">
        <Avatar name={me?.user.name} size={30} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[140px] truncate text-sm font-medium">{me?.user.name}</span>
          <span className="block text-[11px] text-muted">{me?.role.name}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
    )}>
      {(close) => (<>
        <div className="border-b border-border px-3 py-2"><p className="truncate text-sm font-medium">{me?.user.name}</p><p className="truncate text-xs text-muted">{me?.user.email}</p></div>
        <MenuItem icon={<UserCircle className="h-4 w-4" />} onClick={() => { close(); router.push("/profile"); }}>My profile</MenuItem>
        <MenuItem icon={<KeyRound className="h-4 w-4" />} onClick={() => { close(); router.push("/profile?tab=security"); }}>Password & sessions</MenuItem>
        <MenuItem icon={<Bell className="h-4 w-4" />} onClick={() => { close(); router.push("/notifications"); }}>Notifications</MenuItem>
        <MenuItem icon={<LogOut className="h-4 w-4" />} danger onClick={logout}>Sign out</MenuItem>
      </>)}
    </Menu>
  );
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40 lg:hidden" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="animate-fade-in max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const [sheet, setSheet] = useState<"more" | "add" | null>(null);
  const quick = useQuickAddItems();
  const dayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); })();
  const counters = useQuery({
    queryKey: ["followup-counters", {}], enabled: can("followups"), refetchInterval: 120_000,
    queryFn: () => api.get<Record<string, number>>("/api/followups/counters", { day_start: dayStart }),
  });
  const overdue = counters.data?.overdue ?? 0;
  const close = () => setSheet(null);
  const go = (href: string) => { close(); router.push(href); };
  const logout = async () => { try { await api.post("/api/auth/logout"); } finally { qc.clear(); router.replace("/login"); } };
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const tabs = [
    { href: "/", label: "Home", icon: LayoutDashboard, show: can("dashboard") },
    { href: "/leads", label: "Leads", icon: UserPlus, show: can("leads") },
    { href: "/followups", label: "Follow-ups", icon: CalendarClock, show: can("followups"), badge: overdue },
  ].filter((t) => t.show);
  const moreActive = !tabs.some((t) => isActive(t.href));
  const tab = (t: { href: string; label: string; icon: typeof Home; badge?: number }) => {
    const Icon = t.icon;
    const active = isActive(t.href);
    return (
      <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
        className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition", active ? "text-primary" : "text-slate-500")}>
        <span className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition", active && "bg-primary-soft")}>
          <Icon className="h-5 w-5" />
          {!!t.badge && <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{t.badge > 99 ? "99+" : t.badge}</span>}
        </span>
        {t.label}
      </Link>
    );
  };
  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex h-16 max-w-xl items-stretch px-2">
          {tabs.slice(0, 2).map(tab)}
          {quick.length > 0 && (
            <div className="flex flex-1 items-start justify-center">
              <button type="button" onClick={() => setSheet("add")} aria-label="Quick add"
                className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-600/30 ring-4 ring-white transition active:scale-95">
                <Plus className="h-6 w-6" />
              </button>
            </div>
          )}
          {tabs.slice(2).map(tab)}
          <button type="button" onClick={() => setSheet("more")} aria-expanded={sheet === "more"}
            className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium", moreActive ? "text-primary" : "text-slate-500")}>
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", moreActive && "bg-primary-soft")}><LayoutGrid className="h-5 w-5" /></span>
            More
          </button>
        </div>
      </nav>

      <Sheet open={sheet === "add"} onClose={close} title="Quick add">
        <div className="grid grid-cols-2 gap-2">
          {quick.map((i) => (
            <button key={i.href} type="button" onClick={() => go(i.href)}
              className="flex items-center gap-3 rounded-2xl border border-border p-3 text-left text-sm font-medium text-slate-800 active:bg-slate-50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{i.icon}</span>{i.label}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === "more"} onClose={close} title="Menu">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
          <Avatar name={me?.user.name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{me?.user.name}</p>
            <p className="truncate text-xs text-muted">{me?.role.name}{me?.company ? ` · ${me.company.name}` : ""}</p>
          </div>
          <button type="button" onClick={() => go("/profile")} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium">Profile</button>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => (can(i.module, i.action || "view") || (i.module === "imports" && can("exports"))) && !tabs.some((t) => t.href === i.href));
          if (!items.length) return null;
          return (
            <div key={g.section || "main"} className="mb-4">
              {g.section && <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.section}</p>}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {items.map((i) => (
                  <button key={i.href} type="button" onClick={() => go(i.href)}
                    className={cn("flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-medium active:bg-slate-50",
                      isActive(i.href) ? "border-primary/30 bg-primary-soft text-primary" : "border-border text-slate-700")}>
                    <span className="[&>svg]:h-5 [&>svg]:w-5">{i.icon}</span>{i.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 py-3 text-sm font-medium text-danger active:bg-red-50">
          <LogOut className="h-4 w-4" />Sign out
        </button>
      </Sheet>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (me?.password_login_enabled && me.user.must_change_password && pathname !== "/profile") router.replace("/profile?tab=security&force=1");
  }, [me, pathname, router]);
  if (loading || !me) return <div className="flex h-dvh items-center justify-center"><Loading label="Loading your workspace…" /></div>;
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-60 shrink-0 lg:block"><Sidebar /></aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-white px-3 pt-[env(safe-area-inset-top)] sm:px-5 md:gap-3">
          <Link href="/" className="-ml-1 flex h-10 w-10 items-center justify-center lg:hidden" aria-label="Dashboard">
            <Image src="/logo-mark.png" alt="Darpann Investments" width={292} height={390} className="h-8 w-auto" />
          </Link>
          <div className="hidden flex-1 md:block"><GlobalSearch /></div>
          <div className="ml-auto flex items-center gap-1 md:gap-1.5">
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden">
              <Search className="h-5 w-5" />
            </button>
            <div className="hidden lg:block"><QuickAddMenu /></div>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        {searchOpen && (
          <div className="fixed inset-x-0 top-0 z-50 flex items-start gap-2 border-b border-border bg-white p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-lg md:hidden">
            <div className="flex-1"><GlobalSearch autoFocus onDone={() => setSearchOpen(false)} /></div>
            <button type="button" onClick={() => setSearchOpen(false)} className="h-10 px-2 text-sm font-medium text-primary">Cancel</button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-4 sm:px-6 sm:pt-5 lg:pb-6">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
