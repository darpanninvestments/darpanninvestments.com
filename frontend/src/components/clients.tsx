"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Paged, type Row } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Modal } from "./ui";
import { FormFields, companyField, opts, type FieldDef } from "./data";

export const CLIENT_STAGES = ["Onboarding Pending", "Onboarding In Progress", "Documents Pending", "Active Client", "Closed / Completed"];
const MONEY = ["booking_amount", "deal_value", "payment_plan"];

/** Create (initial = {}) or edit (initial = client row) a client. Only changed fields are sent on edit. */
export function ClientFormModal({ initial, onClose, onSaved }: { initial: Row; onClose: () => void; onSaved?: (r: Row) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editing = !!initial.id;
  const [form, setForm] = useState<Row>(() => editing ? { ...initial } : { stage: "Onboarding Pending", ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const propsQ = useQuery({
    queryKey: ["/api/properties", { project_id: form.project_id, page_size: 300, sort: "code" }],
    queryFn: () => api.get<Paged<Row>>("/api/properties", { project_id: form.project_id, page_size: 300, sort: "code" }),
    enabled: !!form.project_id && can("properties"), staleTime: 60_000,
  });
  const masked = !!initial.deal_value_masked;
  const fields: FieldDef[] = [
    companyField,
    { key: "name", label: "Client name", required: true },
    { key: "mobile", label: "Mobile", type: "tel", required: true },
    { key: "email", label: "Email", type: "email" },
    { key: "alt_mobile", label: "Alternate mobile", type: "tel" },
    { key: "project_id", label: "Project", type: "select", options: opts.projects, onChange: () => ({ property_id: null }) },
    { key: "property_id", label: "Property / unit", type: "select", placeholder: form.project_id ? "Select…" : "Pick a project first",
      options: (propsQ.data?.items || []).map((p) => ({ value: p.id, label: [p.code, p.unit_no, p.property_type, p.availability].filter(Boolean).join(" · ") })) },
    { key: "assigned_to_id", label: "Assigned agent", type: "select", options: opts.users },
    { key: "stage", label: "Stage", type: "select", options: CLIENT_STAGES.map((s) => ({ value: s, label: s })) },
    { key: "source_id", label: "Source", type: "select", options: opts.sources },
    { key: "booking_date", label: "Booking date", type: "date" },
    { key: "booking_amount", label: "Booking amount (₹)", type: "number", hidden: () => masked },
    { key: "deal_value", label: "Deal value (₹)", type: "number", hidden: () => masked },
    { key: "payment_plan", label: "Payment plan", hidden: () => masked },
    { key: "referral", label: "Referral" },
    { key: "city", label: "City" },
    { key: "address", label: "Address", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const save = useMutation({
    mutationFn: (body: Row) => editing ? api.patch(`/api/clients/${initial.id}`, body) : api.post("/api/clients", body),
    onSuccess: (r) => {
      toast.success(editing ? "Client updated" : `Client ${r.code || ""} created`);
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      qc.invalidateQueries({ queryKey: ["client-detail"] });
      onClose();
      onSaved?.(r);
    },
  });
  const submit = () => {
    const errs: Record<string, string> = {};
    if (!String(form.name || "").trim()) errs.name = "Name is required";
    if (!String(form.mobile || "").trim()) errs.mobile = "Mobile is required";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const keys = fields.map((f) => f.key).filter((k) => !(masked && MONEY.includes(k)) && !(editing && k === "company_id"));
    const body: Row = {};
    keys.forEach((k) => {
      const v = form[k] === "" ? null : form[k];
      if (editing ? (v ?? null) !== (initial[k] ?? null) : v !== undefined && v !== null) body[k] = v;
    });
    if (editing && !Object.keys(body).length) { onClose(); return; }
    save.mutate(body);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={editing ? `Edit ${initial.code || "client"}` : "Add client"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={submit}>{editing ? "Save changes" : "Create client"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormFields fields={fields} value={form} onChange={setForm} errors={errors} />
        {masked && <p className="mt-3 text-xs text-muted">Commercial fields are hidden for your role.</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const color = v >= 100 ? "bg-emerald-500" : v >= 50 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
