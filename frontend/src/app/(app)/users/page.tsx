"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MonitorSmartphone, MoreVertical, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fromNow } from "@/lib/utils";
import {
  Avatar, Badge, Button, Empty, Field, IconButton, Input, Loading, Menu, MenuItem, Modal, PageHeader, Pagination, Select,
  Tabs, Toggle, useConfirm,
} from "@/components/ui";
import { describeAgent } from "@/components/admin";
import { DataTable, ResourcePage, companyField, opts, useList, type Column, type ResourceConfig } from "@/components/data";

const isLocked = (u: Row) => !!u.locked_until && new Date(u.locked_until) > new Date();

export default function UsersPage() {
  return <Suspense fallback={<Loading />}><UsersInner /></Suspense>;
}

function UsersInner() {
  const sp = useSearchParams();
  const { me, can } = useAuth();
  const [tab, setTab] = useState(sp.get("tab") === "teams" ? "teams" : "users");
  const teamCfg = useMemo<ResourceConfig>(() => ({
    title: "Teams", subtitle: "Group users under a manager and team lead", endpoint: "/api/teams", module: "users",
    noun: "Team", defaultSort: "name", showCompanyFilter: true, searchPlaceholder: "Search teams…",
    columns: [
      { key: "name", label: "Team", sortable: true, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
      ...(me?.is_global ? [{ key: "company_name", label: "Company" }] : []),
      { key: "manager_name", label: "Manager" },
      { key: "lead_name", label: "Team lead" },
      { key: "member_count", label: "Members", render: (r: Row) => <Badge tone="blue">{r.member_count}</Badge> },
      { key: "is_active", label: "Status", render: (r: Row) => <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
    ],
    fields: [
      companyField,
      { key: "name", label: "Team name", required: true },
      { key: "manager_id", label: "Manager", type: "select", options: opts.users },
      { key: "lead_id", label: "Team lead", type: "select", options: opts.users },
      { key: "is_active", label: "Active", type: "checkbox", default: true },
    ],
  }), [me?.is_global]);

  if (!can("users")) return <Empty title="No access" text="You do not have permission to view users." />;
  return (
    <div>
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "users", label: "Users" }, { value: "teams", label: "Teams" }]} />
      {tab === "users" ? <UsersTab openNew={sp.get("new") === "1"} /> : <ResourcePage cfg={teamCfg} />}
    </div>
  );
}

function UsersTab({ openNew }: { openNew: boolean }) {
  const { me, can, meta } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isGlobal = !!me?.is_global;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("name");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Row | null>(() => (openNew ? { is_active: true, send_welcome: true } : null));
  const [sessionsFor, setSessionsFor] = useState<Row | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const list = useList("/api/users", { q: debounced, page, page_size: pageSize, sort, ...filters });
  const roles = useQuery({ queryKey: ["/api/roles"], queryFn: () => api.get<Row[]>("/api/roles") });
  const teams = useList("/api/teams", { page_size: 0, sort: "name" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/users"] }); qc.invalidateQueries({ queryKey: ["/api/teams"] }); qc.invalidateQueries({ queryKey: ["meta"] }); };
  const setFilter = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Row }) => api.patch(`/api/users/${id}`, body),
    onSuccess: (r) => { toast.success(`${r.name} ${r.is_active ? "activated" : "deactivated"}`); refresh(); },
  });
  const resetPassword = async (u: Row) => {
    if (!(await confirm({ title: "Reset password?", danger: false, confirmText: "Reset & email",
      message: <>A new temporary password will be emailed to <b>{u.email}</b>. They will be signed out everywhere and asked to change it on next sign-in.</> }))) return;
    await api.post(`/api/users/${u.id}/reset-password`, {});
    toast.success(`Temporary password emailed to ${u.email}`);
  };
  const unlock = async (u: Row) => {
    await api.post(`/api/users/${u.id}/unlock`);
    toast.success(`${u.name} can sign in again`); refresh();
  };
  const remove = async (u: Row) => {
    if (!(await confirm({ title: "Delete user?", message: <>“{u.name}” will be removed and signed out. Their records stay in the CRM.</>, confirmText: "Delete" }))) return;
    await api.del(`/api/users/${u.id}`);
    toast.success("User deleted"); refresh();
  };
  const toggleActive = async (u: Row) => {
    if (u.is_active && !(await confirm({ title: "Deactivate user?", message: <>“{u.name}” will be signed out and cannot sign in until re-activated.</>, confirmText: "Deactivate" }))) return;
    patch.mutate({ id: u.id, body: { is_active: !u.is_active } });
  };

  const canEdit = can("users", "edit");
  const canDelete = can("users", "delete");
  const teamOpts = (teams.data?.items || []).filter((t) => !filters.company_id || String(t.company_id) === filters.company_id)
    .map((t) => ({ value: t.id, label: t.name }));

  const columns: Column[] = [
    { key: "name", label: "User", sortable: true, render: (r) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={r.name} size={30} />
        <div className="min-w-0">
          <div className="font-medium text-slate-800">{r.name}</div>
          {r.designation && <div className="text-xs text-muted">{r.designation}</div>}
        </div>
      </div>
    ) },
    { key: "email", label: "Email", sortable: true },
    { key: "mobile", label: "Mobile" },
    { key: "role_name", label: "Role", render: (r) => <Badge tone="violet">{r.role_name}</Badge> },
    ...(isGlobal ? [{ key: "company_name", label: "Company", render: (r: Row) => r.company_name || <span className="text-xs text-muted">All companies</span> }] : []),
    { key: "team_name", label: "Team" },
    { key: "reports_to_name", label: "Reports to" },
    { key: "is_active", label: "Active", render: (r) => (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {canEdit && r.id !== me?.user.id ? <Toggle checked={!!r.is_active} onChange={() => toggleActive(r)} />
          : <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Badge>}
        {isLocked(r) && <Badge tone="red">Locked</Badge>}
      </div>
    ) },
    { key: "last_login_at", label: "Last login", sortable: true, render: (r) => <span className="text-xs text-muted" title={fmtDateTime(r.last_login_at)}>{r.last_login_at ? fromNow(r.last_login_at) : "Never"}</span> },
    ...((canEdit || canDelete) ? [{ key: "_a", label: "", className: "text-right", render: (r: Row) => (
      <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {canEdit && <IconButton title="Edit" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
        <Menu trigger={(t) => <IconButton title="More" onClick={t}><MoreVertical className="h-4 w-4" /></IconButton>}>
          {(close) => <>
            {canEdit && isLocked(r) && <MenuItem icon={<KeyRound className="h-4 w-4" />} onClick={() => { close(); unlock(r); }}>Unlock account</MenuItem>}
            {canEdit && me?.password_login_enabled && <MenuItem icon={<KeyRound className="h-4 w-4" />} onClick={() => { close(); resetPassword(r); }}>Reset password</MenuItem>}
            {canEdit && <MenuItem icon={<MonitorSmartphone className="h-4 w-4" />} onClick={() => { close(); setSessionsFor(r); }}>Active sessions</MenuItem>}
            {canEdit && r.id !== me?.user.id && <MenuItem icon={<Power className="h-4 w-4" />} onClick={() => { close(); toggleActive(r); }}>{r.is_active ? "Deactivate" : "Activate"}</MenuItem>}
            {canDelete && r.id !== me?.user.id && <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); remove(r); }}>Delete</MenuItem>}
          </>}
        </Menu>
      </div>
    ) }] : []),
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="People who can sign in to the CRM, their roles and reporting lines"
        actions={can("users", "add") && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ is_active: true, send_welcome: true })}>Add user</Button>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Search name, email, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {isGlobal && <Select className="w-auto min-w-[150px]" placeholder="All companies" options={opts.companies(meta)} value={filters.company_id || ""}
            onChange={(e) => { setFilters((f) => ({ ...f, company_id: e.target.value, team_id: "" })); setPage(1); }} />}
          <Select className="w-auto min-w-[130px]" placeholder="All roles" value={filters.role_id || ""} onChange={(e) => setFilter("role_id", e.target.value)}
            options={(roles.data || []).map((r) => ({ value: r.id, label: r.name }))} />
          <Select className="w-auto min-w-[130px]" placeholder="All teams" value={filters.team_id || ""} onChange={(e) => setFilter("team_id", e.target.value)} options={teamOpts} />
          <Select className="w-auto min-w-[120px]" placeholder="Any status" value={filters.is_active || ""} onChange={(e) => setFilter("is_active", e.target.value)}
            options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} />
        </div>
        <DataTable columns={columns} rows={list.data?.items || []} loading={list.isFetching} sort={sort} onSort={setSort}
          onRowClick={canEdit ? (r) => setEditing(r) : undefined}
          rowClass={(r) => (r.is_active ? "" : "opacity-60")}
          empty={<Empty title="No users found" />} />
        {list.data && list.data.total > 0 && (
          <Pagination page={page} pages={list.data.pages} total={list.data.total} onPage={setPage} pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>
      {editing && <UserForm key={editing.id ?? "new"} initial={editing} roles={roles.data || []} onClose={() => setEditing(null)} onSaved={refresh} />}
      {sessionsFor && <SessionsModal user={sessionsFor} onClose={() => setSessionsFor(null)} />}
    </div>
  );
}

function UserForm({ initial, roles, onClose, onSaved }: { initial: Row; roles: Row[]; onClose: () => void; onSaved: () => void }) {
  const { me, meta } = useAuth();
  const isGlobal = !!me?.is_global;
  const [f, setF] = useState<Row>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Row) => setF((p) => ({ ...p, ...patch }));
  const editing = !!f.id;
  const role = roles.find((r) => r.id === Number(f.role_id));
  const companyless = isGlobal && (role?.level ?? 0) >= 90;
  const cid: number | null = isGlobal ? (companyless ? null : f.company_id || null) : me?.user.company_id ?? null;
  const teams = useList("/api/teams", { page_size: 0, sort: "name", company_id: cid || undefined }, !!cid);
  const users = useQuery({
    queryKey: ["/api/users/options", cid], enabled: !!cid,
    queryFn: () => api.get<Row[]>("/api/users/options", { company_id: cid || undefined }),
  });
  const roleOpts = roles.filter((r) => r.assignable || r.id === initial.role_id)
    .map((r) => ({ value: r.id, label: `${r.name} (L${r.level})` }));

  const save = useMutation({
    mutationFn: () => {
      const body: Row = {
        name: f.name?.trim(), email: f.email?.trim(), mobile: f.mobile || null, designation: f.designation || null,
        role_id: Number(f.role_id), team_id: cid ? f.team_id || null : null, reports_to_id: cid ? f.reports_to_id || null : null,
        is_active: !!f.is_active,
      };
      if (isGlobal) body.company_id = companyless ? null : f.company_id || null;
      if (editing) return api.patch(`/api/users/${f.id}`, body);
      return api.post("/api/users", { ...body, password: f.password || undefined, send_welcome: !!f.send_welcome });
    },
    onSuccess: () => {
      toast.success(editing ? "User updated" : f.send_welcome ? `User created – welcome email sent to ${f.email}` : "User created");
      onSaved(); onClose();
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.name?.trim()) e.name = "Name is required";
    if (!f.email?.trim()) e.email = "Email is required";
    if (!f.role_id) e.role_id = "Role is required";
    if (isGlobal && !companyless && !f.company_id) e.company_id = "Company is required";
    if (!editing && f.password && (f.password.length < 8 || !/\d/.test(f.password) || !/[a-z]/i.test(f.password))) e.password = "At least 8 characters with letters and numbers";
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${initial.name}` : "New user"} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{editing ? "Save changes" : "Create user"}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Full name" required error={errors.name}><Input value={f.name || ""} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Email" required error={errors.email}><Input type="email" value={f.email || ""} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Mobile"><Input type="tel" value={f.mobile || ""} onChange={(e) => set({ mobile: e.target.value })} /></Field>
        <Field label="Designation"><Input value={f.designation || ""} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. Senior Sales Executive" /></Field>
        <Field label="Role" required error={errors.role_id} hint={role?.description}>
          <Select placeholder="Select role…" options={roleOpts} value={f.role_id ?? ""} disabled={editing && initial.id === me?.user.id}
            onChange={(e) => set({ role_id: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        {isGlobal && !companyless && (
          <Field label="Company" required error={errors.company_id}>
            <Select placeholder="Select company…" options={opts.companies(meta)} value={f.company_id ?? ""}
              onChange={(e) => set({ company_id: e.target.value ? Number(e.target.value) : null, team_id: null, reports_to_id: null })} />
          </Field>
        )}
        {companyless && <p className="self-end rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 sm:col-span-1">This role is CRM-wide and is not tied to a company.</p>}
        {!!cid && <>
          <Field label="Team">
            <Select placeholder="No team" options={(teams.data?.items || []).map((t) => ({ value: t.id, label: t.name }))} value={f.team_id ?? ""}
              onChange={(e) => set({ team_id: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label="Reports to">
            <Select placeholder="No manager" options={(users.data || []).filter((u) => u.id !== f.id).map((u) => ({ value: u.id, label: u.role ? `${u.name} · ${u.role}` : u.name }))}
              value={f.reports_to_id ?? ""} onChange={(e) => set({ reports_to_id: e.target.value ? Number(e.target.value) : null })} />
          </Field>
        </>}
        {!editing && me?.password_login_enabled && (
          <Field label="Password" error={errors.password} className="sm:col-span-2"
            hint="Optional. Leave blank to auto-generate a temporary password – it is emailed in the welcome mail and the user must change it on first sign-in.">
            <Input type="password" autoComplete="new-password" value={f.password || ""} onChange={(e) => set({ password: e.target.value })} placeholder="Leave blank to auto-generate" />
          </Field>
        )}
        <div className="flex flex-wrap gap-6 sm:col-span-2">
          {!editing && <Toggle checked={!!f.send_welcome} onChange={(v) => set({ send_welcome: v })} label={me?.password_login_enabled ? "Send welcome email with login details" : "Send welcome email with sign-in instructions"} />}
          <Toggle checked={!!f.is_active} onChange={(v) => set({ is_active: v })} label="Active" />
        </div>
        {!editing && me?.password_login_enabled && !f.password && !f.send_welcome && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">
            No password and no welcome email: the user won&apos;t know their password. Use “Reset password” later to email one.
          </p>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function SessionsModal({ user, onClose }: { user: Row; onClose: () => void }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ["/api/users", user.id, "sessions"];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Row[]>(`/api/users/${user.id}/sessions`) });
  const logoutAll = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/logout-all`),
    onSuccess: () => { toast.success(`${user.name} signed out everywhere`); qc.invalidateQueries({ queryKey: key }); },
  });
  return (
    <Modal open onClose={onClose} title={`Sessions – ${user.name}`} size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button variant="danger" icon={<LogOut className="h-4 w-4" />} loading={logoutAll.isPending} disabled={!q.data?.length}
          onClick={async () => { if (await confirm({ title: "Sign out everywhere?", message: `All active sessions of ${user.name} will be ended.`, confirmText: "Sign out" })) logoutAll.mutate(); }}>
          Sign out everywhere
        </Button>
      </>}>
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No active sessions" icon={<MonitorSmartphone className="h-6 w-6" />} /> : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-2.5">
              <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium text-slate-800" title={s.user_agent}>{describeAgent(s.user_agent)}</div>
                <div className="text-xs text-muted">IP {s.ip || "—"} · signed in {fmtDateTime(s.created_at)} · last seen {fromNow(s.last_seen_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
