"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Empty, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Textarea, useConfirm } from "@/components/ui";
import { DataTable, type Column } from "@/components/data";
import { SCOPE_INFO, SCOPES } from "@/components/admin";

export default function RolesPage() {
  const { me, can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const roles = useQuery({ queryKey: ["/api/roles"], queryFn: () => api.get<Row[]>("/api/roles") });
  const canConfigure = can("roles", "configure");

  const remove = async (r: Row) => {
    if (!(await confirm({ title: "Delete role?", message: <>The custom role “{r.name}” will be deleted.</> }))) return;
    await api.del(`/api/roles/${r.id}`);
    toast.success("Role deleted");
    qc.invalidateQueries({ queryKey: ["/api/roles"] });
  };

  const columns: Column[] = [
    { key: "name", label: "Role", render: (r) => (
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary"><ShieldCheck className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-slate-800">
            {r.name}
            {r.key === "super_admin" && <Lock className="h-3 w-3 text-slate-400" />}
          </div>
          {r.description && <div className="max-w-md truncate text-xs text-muted">{r.description}</div>}
        </div>
      </div>
    ) },
    { key: "level", label: "Level", render: (r) => <span className="font-mono text-xs">{r.level}</span> },
    { key: "is_system", label: "Type", render: (r) => r.is_system ? <Badge tone="blue">System</Badge> : <Badge tone="violet">Custom</Badge> },
    { key: "scope", label: "Applies to", render: (r) => r.company_id ? <span className="text-xs">{r.company_id === me?.company?.id ? me?.company?.name : `Company #${r.company_id}`}</span> : <span className="text-xs text-muted">All companies</span> },
    { key: "user_count", label: "Users", render: (r) => <Badge>{r.user_count}</Badge> },
    { key: "_a", label: "", className: "text-right", render: (r) => (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {canConfigure && !r.is_system && !r.user_count && (
          <IconButton title="Delete role" tone="red" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
        )}
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </div>
    ) },
  ];

  if (!can("roles")) return <Empty title="No access" text="You do not have permission to view roles." />;
  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle="Each role grants a data scope per module and action. Higher level = more senior."
        actions={canConfigure && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New role</Button>} />
      <div className="card">
        {roles.isLoading ? <Loading /> : (
          <DataTable columns={columns} rows={roles.data || []} onRowClick={(r) => router.push(`/roles/${r.id}`)} />
        )}
      </div>
      <div className="card mt-4 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Data scopes</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {SCOPES.map((s) => (
            <div key={s} className="flex items-start gap-2 text-xs">
              <span className={`shrink-0 rounded border px-1.5 py-0.5 font-medium ${SCOPE_INFO[s].cls}`}>{SCOPE_INFO[s].label}</span>
              <span className="text-muted">{SCOPE_INFO[s].text}</span>
            </div>
          ))}
        </div>
      </div>
      {creating && <CreateRole roles={roles.data || []} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/roles/${id}`)} />}
    </div>
  );
}

function CreateRole({ roles, onClose, onCreated }: { roles: Row[]; onClose: () => void; onCreated: (id: number) => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const myLevel = me?.role.level ?? 0;
  const maxLevel = me?.role.key === "super_admin" ? 99 : myLevel - 1;
  const [f, setF] = useState<Row>({ level: Math.min(20, maxLevel), copy_from_role_id: roles.find((r) => r.key === "agent")?.id ?? "" });
  const [err, setErr] = useState("");
  const save = useMutation({
    mutationFn: () => api.post("/api/roles", {
      name: f.name.trim(), description: f.description || null, level: Number(f.level),
      copy_from_role_id: f.copy_from_role_id ? Number(f.copy_from_role_id) : null,
    }),
    onSuccess: (r) => { toast.success("Role created – now set its permissions"); qc.invalidateQueries({ queryKey: ["/api/roles"] }); onCreated(r.id); },
  });
  const submit = () => {
    if (!f.name?.trim()) return setErr("Name is required");
    if (Number(f.level) > maxLevel) return setErr(`Level must be ${maxLevel} or lower`);
    setErr(""); save.mutate();
  };
  return (
    <Modal open onClose={onClose} title="New custom role" size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>Create role</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Role name" required error={err}><Input autoFocus value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Telecaller" /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description || ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Level" hint={`1–${maxLevel}. Users can only manage roles below their own level (yours: ${myLevel}).`}>
            <Input type="number" min={1} max={maxLevel} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} />
          </Field>
          <Field label="Copy permissions from" hint="Start from an existing role's matrix">
            <Select placeholder="Start empty" value={f.copy_from_role_id} onChange={(e) => setF({ ...f, copy_from_role_id: e.target.value })}
              options={roles.map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
