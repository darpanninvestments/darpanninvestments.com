"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth, type Scope } from "@/lib/auth";
import { cn, humanize } from "@/lib/utils";
import { Badge, Button, Empty, Field, Input, Loading, PageHeader, Textarea, useConfirm } from "@/components/ui";
import { SCOPE_INFO, SCOPES, ScopeSelect } from "@/components/admin";

type Catalog = { modules: Record<string, { label: string; actions: string[] }>; actions: string[]; scopes: Scope[] };
type Matrix = Record<string, Record<string, Scope>>;

export default function RoleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const catalog = useQuery({ queryKey: ["/api/roles/catalog"], queryFn: () => api.get<Catalog>("/api/roles/catalog"), staleTime: Infinity });
  const role = useQuery({ queryKey: ["/api/roles", id], queryFn: () => api.get(`/api/roles/${id}`) });
  if (role.isLoading || catalog.isLoading) return <Loading />;
  if (!role.data || !catalog.data) return <Empty title="Role not found" action={<Link href="/roles" className="text-sm text-primary">Back to roles</Link>} />;
  return <Editor key={role.data.id} role={role.data} catalog={catalog.data} />;
}

function Editor({ role, catalog }: { role: Row; catalog: Catalog }) {
  const { me, can, refresh } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isGlobal = !!me?.is_global;
  const isSuper = role.key === "super_admin";
  const readOnly = isSuper || !can("roles", "configure") || (role.company_id == null && !isGlobal);
  const [matrix, setMatrix] = useState<Matrix>(() => role.permissions || {});
  const [info, setInfo] = useState({ name: role.name || "", description: role.description || "", level: role.level });
  const [dirty, setDirty] = useState(false);
  const modules = Object.entries(catalog.modules);
  const actions = catalog.actions;
  const get = (m: string, a: string): Scope => (isSuper ? "all" : matrix[m]?.[a] ?? "none");

  const update = (fn: (m: Matrix) => void) => {
    setMatrix((prev) => { const next: Matrix = JSON.parse(JSON.stringify(prev)); fn(next); return next; });
    setDirty(true);
  };
  const setCell = (m: string, a: string, s: Scope) => update((x) => { x[m] = { ...(x[m] || {}), [a]: s }; });
  const setRow = (m: string, s: Scope) => update((x) => { x[m] = Object.fromEntries(catalog.modules[m].actions.map((a) => [a, s])); });
  const setCol = (a: string, s: Scope) => update((x) => {
    modules.forEach(([m, def]) => { if (def.actions.includes(a)) x[m] = { ...(x[m] || {}), [a]: s }; });
  });

  const granted = useMemo(() => modules.reduce((n, [m, d]) => n + d.actions.filter((a) => get(m, a) !== "none").length, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matrix]);
  const total = modules.reduce((n, [, d]) => n + d.actions.length, 0);

  const done = (r: Row, msg: string) => {
    toast.success(msg);
    setMatrix(r.permissions || {});
    setInfo({ name: r.name || "", description: r.description || "", level: r.level });
    setDirty(false);
    qc.setQueryData(["/api/roles", String(role.id)], r);
    qc.invalidateQueries({ queryKey: ["/api/roles"] });
    refresh();
  };
  const save = useMutation({
    mutationFn: () => {
      const permissions: Matrix = {};
      modules.forEach(([m, d]) => d.actions.forEach((a) => { const s = get(m, a); if (s !== "none") (permissions[m] ||= {})[a] = s; }));
      return api.patch(`/api/roles/${role.id}`, {
        name: info.name, description: info.description || null, ...(!role.is_system ? { level: Number(info.level) } : {}), permissions,
      });
    },
    onSuccess: (r) => done(r, "Permissions saved"),
  });
  const reset = useMutation({ mutationFn: () => api.post(`/api/roles/${role.id}/reset`), onSuccess: (r) => done(r, "Reset to default permissions") });

  return (
    <div>
      <PageHeader
        back={<Link href="/roles" className="mb-1 inline-flex items-center gap-1 text-xs text-muted hover:text-primary"><ArrowLeft className="h-3 w-3" />Roles</Link>}
        title={<span className="flex items-center gap-2">{role.name}{role.is_system ? <Badge tone="blue">System</Badge> : <Badge tone="violet">Custom</Badge>}</span>}
        subtitle={`${role.user_count ?? ""}${role.user_count != null ? " users · " : ""}${granted} of ${total} permissions granted · level ${role.level}`}
        actions={!readOnly && <>
          {role.is_system && isGlobal && (
            <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} loading={reset.isPending}
              onClick={async () => { if (await confirm({ title: "Reset to defaults?", message: "All custom changes to this role's permissions will be replaced by the built-in defaults.", confirmText: "Reset" })) reset.mutate(); }}>
              Reset to defaults
            </Button>
          )}
          <Button size="sm" icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save changes</Button>
        </>} />

      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Lock className="h-4 w-4 shrink-0" />
          {isSuper ? "Super Admin always has full access to everything – this role cannot be edited."
            : !can("roles", "configure") ? "You can view this role but not change it."
            : "System roles can only be changed by CRM admins."}
        </div>
      )}

      {!readOnly && (
        <div className="card mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_2fr_120px]">
          <Field label="Name"><Input value={info.name} onChange={(e) => { setInfo({ ...info, name: e.target.value }); setDirty(true); }} /></Field>
          <Field label="Description"><Textarea rows={1} value={info.description} onChange={(e) => { setInfo({ ...info, description: e.target.value }); setDirty(true); }} /></Field>
          <Field label="Level" hint={role.is_system ? "Fixed for system roles" : undefined}>
            <Input type="number" disabled={role.is_system} value={info.level} onChange={(e) => { setInfo({ ...info, level: e.target.value }); setDirty(true); }} />
          </Field>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs font-medium text-slate-500">
                <th className="sticky left-0 z-20 border-b border-r border-border bg-slate-50 px-3 py-2 text-left">Module</th>
                {actions.map((a) => (
                  <th key={a} className="border-b border-border px-2 py-2 text-center">
                    <div>{humanize(a)}</div>
                    {!readOnly && (
                      <ScopeSelect className="mt-1 w-[86px]" value="" placeholder="Set col…" allowAll={isGlobal} onChange={(s) => setCol(a, s)} />
                    )}
                  </th>
                ))}
                {!readOnly && <th className="border-b border-border px-2 py-2 text-center">Row</th>}
              </tr>
            </thead>
            <tbody>
              {modules.map(([m, def]) => (
                <tr key={m} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-800 group-hover:bg-slate-50">
                    {def.label}
                  </td>
                  {actions.map((a) => (
                    <td key={a} className="border-b border-slate-100 px-2 py-1.5 text-center group-hover:bg-slate-50/60">
                      {def.actions.includes(a) ? (
                        readOnly ? <ScopeChip s={get(m, a)} /> :
                          <ScopeSelect className="w-[86px]" value={get(m, a)} allowAll={isGlobal} onChange={(s) => setCell(m, a, s)} />
                      ) : <span className="text-slate-200">·</span>}
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="border-b border-slate-100 px-2 py-1.5 text-center group-hover:bg-slate-50/60">
                      <ScopeSelect className="w-[86px]" value="" placeholder="Set all…" allowAll={isGlobal} onChange={(s) => setRow(m, s)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-4 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">What the scopes mean</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {SCOPES.map((s) => (
            <div key={s} className="flex items-start gap-2 text-xs">
              <ScopeChip s={s} />
              <span className="text-muted">{SCOPE_INFO[s].text}</span>
            </div>
          ))}
        </div>
        {!isGlobal && <p className="mt-3 text-xs text-muted">“All” is reserved for CRM admins; company-level roles are capped at “Company”.</p>}
        <p className="mt-1 text-xs text-muted">Users must sign in again or refresh for permission changes to take effect.</p>
      </div>
    </div>
  );
}

function ScopeChip({ s }: { s: Scope }) {
  return <span className={cn("inline-block min-w-[56px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[11px] font-medium", SCOPE_INFO[s].cls)}>{SCOPE_INFO[s].label}</span>;
}
