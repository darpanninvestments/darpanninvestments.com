"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { FormFields, opts, type FieldDef } from "./data";
import { Button, Field, IconButton, Input, Modal, Select, Textarea } from "./ui";

export const AVAILABILITY = ["Available", "Hold", "Reserved", "Booked", "Sold", "Blocked"];
export const AVAIL_COLORS: Record<string, string> = {
  Available: "bg-emerald-500", Hold: "bg-amber-500", Reserved: "bg-violet-500", Booked: "bg-blue-500",
  Sold: "bg-slate-500", Blocked: "bg-red-500",
};

export function InventoryBar({ inv }: { inv?: Record<string, number> | null }) {
  const total = Object.values(inv || {}).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        {total > 0 && AVAILABILITY.map((a) => inv?.[a] ? <span key={a} className={AVAIL_COLORS[a]} style={{ width: `${(inv[a] / total) * 100}%` }} title={`${a}: ${inv[a]}`} /> : null)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
        {(["Available", "Booked", "Sold"] as const).map((a) => (
          <span key={a} className="inline-flex items-center gap-1"><span className={cn("h-1.5 w-1.5 rounded-full", AVAIL_COLORS[a])} />{a} <b className="font-semibold">{inv?.[a] || 0}</b></span>
        ))}
        {total === 0 && <span className="text-muted">No units</span>}
      </div>
    </div>
  );
}

// ── Location options (cascading) ───────────────────────────────────────────────
export function useLocations(kind: "countries" | "states" | "cities" | "areas", parent?: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: [`/api/locations/${kind}`, { page_size: 0, ...parent }],
    queryFn: () => api.get<Paged<Row>>(`/api/locations/${kind}`, { page_size: 0, ...parent }),
    enabled,
    staleTime: 5 * 60_000,
    select: (d) => d.items.map((r) => ({ value: r.id as number, label: r.name as string })),
  });
}

const num = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

// ── Project form ───────────────────────────────────────────────────────────────
export function ProjectFormModal({ value, onClose, onSaved }: { value: Row | null; onClose: () => void; onSaved?: (r: Row) => void }) {
  if (!value) return null;
  return <ProjectForm key={value.id || "new"} value={value} onClose={onClose} onSaved={onSaved} />;
}

function ProjectForm({ value, onClose, onSaved }: { value: Row; onClose: () => void; onSaved?: (r: Row) => void }) {
  const { me, meta, lookup } = useAuth();
  const qc = useQueryClient();
  const [f, setF] = useState<Row>(() => ({ status: "Active", ...value, team_user_ids: value.team_user_ids || [], }));
  const [userQ, setUserQ] = useState("");
  const set = (patch: Row) => setF((p) => ({ ...p, ...patch }));
  const countries = useLocations("countries");
  const states = useLocations("states", { country_id: f.country_id }, !!f.country_id);
  const cities = useLocations("cities", { state_id: f.state_id }, !!f.state_id);
  const areas = useLocations("areas", { city_id: f.city_id }, !!f.city_id);
  const idOrNull = (v: string) => (v ? Number(v) : null);

  const save = useMutation({
    mutationFn: () => {
      const body: Row = {
        ...f, price_min: num(f.price_min), price_max: num(f.price_max),
        process_id: f.process_id || null, team_user_ids: (f.team_user_ids as number[]).map(Number),
      };
      ["inventory", "property_count", "lead_count", "document_count", "process_name", "city_name", "area_name", "company_name"]
        .forEach((k) => delete body[k]);
      return f.id ? api.patch(`/api/projects/${f.id}`, body) : api.post("/api/projects", body);
    },
    onSuccess: (r) => {
      toast.success(f.id ? "Project updated" : "Project created");
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      onSaved?.(r);
      onClose();
    },
  });
  const submit = () => {
    if (!f.name?.trim()) return toast.error("Project name is required");
    if (me?.is_global && !f.id && !f.company_id) return toast.error("Select a company");
    save.mutate();
  };
  const team = (f.team_user_ids as number[]).map(Number);
  const users = (meta?.users || []).filter((u) => !userQ || u.name.toLowerCase().includes(userQ.toLowerCase()));
  const statusOpts = lookup("project_status").map((l) => ({ value: l.value, label: l.name }));
  if (f.status && !statusOpts.some((o) => o.value === f.status)) statusOpts.push({ value: f.status, label: f.status });

  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? `Edit ${value.name}` : "New project"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{f.id ? "Save changes" : "Create project"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {me?.is_global && !f.id && (
            <Field label="Company" required>
              <Select value={f.company_id ?? ""} placeholder="Select…" options={opts.companies(meta)} onChange={(e) => set({ company_id: idOrNull(e.target.value) })} />
            </Field>
          )}
          <Field label="Process">
            <Select value={f.process_id ?? ""} placeholder="Select…" options={opts.processes(meta)} onChange={(e) => set({ process_id: idOrNull(e.target.value) })} />
          </Field>
          <Field label="Project name" required><Input value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Code"><Input value={f.code ?? ""} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="e.g. KUDAL" /></Field>
          <Field label="Developer"><Input value={f.developer ?? ""} onChange={(e) => set({ developer: e.target.value })} /></Field>
          <Field label="Status"><Select value={f.status ?? ""} options={statusOpts} onChange={(e) => set({ status: e.target.value })} /></Field>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Location</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Country">
              <Select value={f.country_id ?? ""} placeholder="Select…" options={countries.data || []}
                onChange={(e) => set({ country_id: idOrNull(e.target.value), state_id: null, city_id: null, area_id: null })} />
            </Field>
            <Field label="State">
              <Select value={f.state_id ?? ""} placeholder={f.country_id ? "Select…" : "Select country first"} disabled={!f.country_id} options={states.data || []}
                onChange={(e) => set({ state_id: idOrNull(e.target.value), city_id: null, area_id: null })} />
            </Field>
            <Field label="City">
              <Select value={f.city_id ?? ""} placeholder={f.state_id ? "Select…" : "Select state first"} disabled={!f.state_id} options={cities.data || []}
                onChange={(e) => set({ city_id: idOrNull(e.target.value), area_id: null })} />
            </Field>
            <Field label="Area">
              <Select value={f.area_id ?? ""} placeholder={f.city_id ? "Select…" : "Select city first"} disabled={!f.city_id} options={areas.data || []}
                onChange={(e) => set({ area_id: idOrNull(e.target.value) })} />
            </Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></Field>
            <Field label="Map link" className="sm:col-span-2"><Input type="url" value={f.map_link ?? ""} onChange={(e) => set({ map_link: e.target.value })} placeholder="https://maps.google.com/…" /></Field>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Min price (₹)"><Input type="number" min={0} value={f.price_min ?? ""} onChange={(e) => set({ price_min: e.target.value })} /></Field>
          <Field label="Max price (₹)"><Input type="number" min={0} value={f.price_max ?? ""} onChange={(e) => set({ price_max: e.target.value })} /></Field>
          <Field label="Contact name"><Input value={f.contact_name ?? ""} onChange={(e) => set({ contact_name: e.target.value })} /></Field>
          <Field label="Contact phone"><Input type="tel" value={f.contact_phone ?? ""} onChange={(e) => set({ contact_phone: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Sales notes" className="sm:col-span-2" hint="Internal pitch notes for the sales team"><Textarea value={f.sales_notes ?? ""} onChange={(e) => set({ sales_notes: e.target.value })} /></Field>
        </section>

        <Field label={`Project team (${team.length})`}>
          <div className="rounded-lg border border-border">
            <div className="relative border-b border-border">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input className="w-full rounded-t-lg py-2 pl-8 pr-3 text-sm outline-none" placeholder="Filter users…" value={userQ} onChange={(e) => setUserQ(e.target.value)} />
            </div>
            <div className="grid max-h-44 grid-cols-1 overflow-y-auto p-1 sm:grid-cols-2">
              {users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={team.includes(u.id)}
                    onChange={() => set({ team_user_ids: team.includes(u.id) ? team.filter((x) => x !== u.id) : [...team, u.id] })} />
                  <span className="truncate">{u.name}</span>
                </label>
              ))}
              {!users.length && <p className="px-2 py-1.5 text-xs text-muted">No users</p>}
            </div>
          </div>
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// ── Property form ──────────────────────────────────────────────────────────────
const PROPERTY_FIELDS: FieldDef[] = [
  { key: "project_id", label: "Project", type: "select", options: opts.projects, required: true },
  { key: "code", label: "Code", placeholder: "Auto-generated if blank" },
  { key: "unit_no", label: "Unit / Plot no." },
  { key: "property_type", label: "Property type", type: "select", options: opts.lookup("property_type") },
  { key: "size", label: "Size", type: "number" },
  { key: "size_unit", label: "Size unit", type: "select", options: opts.list("sq.ft", "sq.yd", "sq.m", "acre", "bigha") },
  { key: "facing", label: "Facing", type: "select", options: opts.lookup("facing") },
  { key: "floor", label: "Floor" },
  { key: "bedrooms", label: "Bedrooms", type: "number" },
  { key: "bathrooms", label: "Bathrooms", type: "number" },
  { key: "base_price", label: "Base price (₹)", type: "number" },
  { key: "offer_price", label: "Offer price (₹)", type: "number" },
  { key: "price_status", label: "Price status", placeholder: "e.g. Negotiable, Fixed" },
  { key: "availability", label: "Availability", type: "select", options: opts.list(...AVAILABILITY) },
  { key: "description", label: "Description", type: "textarea" },
];

export function PropertyFormModal({ value, onClose }: { value: Row | null; onClose: () => void }) {
  if (!value) return null;
  return <PropertyForm key={value.id || "new"} value={value} onClose={onClose} />;
}

function PropertyForm({ value, onClose }: { value: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Row>(() => ({ availability: "Available", size_unit: "sq.ft", ...value }));
  const [attrs, setAttrs] = useState<{ k: string; v: string }[]>(() =>
    Object.entries((value.attributes as Record<string, unknown>) || {}).map(([k, v]) => ({ k, v: String(v ?? "") })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body: Row = { ...f, attributes: Object.fromEntries(attrs.filter((a) => a.k.trim()).map((a) => [a.k.trim(), a.v])) };
      delete body.project_name;
      return f.id ? api.patch(`/api/properties/${f.id}`, body) : api.post("/api/properties", body);
    },
    onSuccess: () => {
      toast.success(f.id ? "Property updated" : "Property created");
      qc.invalidateQueries({ queryKey: ["/api/properties"] });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      onClose();
    },
  });
  const submit = () => {
    if (!f.project_id) { setErrors({ project_id: "Project is required" }); return; }
    setErrors({});
    save.mutate();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? `Edit ${value.code}` : "New property"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{f.id ? "Save changes" : "Create property"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormFields fields={PROPERTY_FIELDS} value={f} onChange={setF} errors={errors} />
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Attributes</span>
            <Button size="xs" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAttrs([...attrs, { k: "", v: "" }])}>Add attribute</Button>
          </div>
          {!attrs.length && <p className="text-xs text-muted">e.g. Corner plot, Club access, Parking slots…</p>}
          <div className="space-y-2">
            {attrs.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Name" value={a.k} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                <Input placeholder="Value" value={a.v} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                <IconButton title="Remove" className="mt-1" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><X className="h-4 w-4" /></IconButton>
              </div>
            ))}
          </div>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
