"use client";

import { useEffect, useRef } from "react";
import { Eraser, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Form schema ────────────────────────────────────────────────────────────────
export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  map_to?: string | null;
  category?: string | null;
  placeholder?: string;
};

export const FIELD_TYPES = [
  "text", "email", "tel", "number", "textarea", "select", "radio", "checkbox", "date", "file", "signature", "section",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_TYPES = [
  "lead_capture", "enquiry", "site_visit_request", "partner_registration", "client_onboarding", "feedback",
  "referral", "campaign", "event", "document_collection", "custom",
];

export const LEAD_MAP = [
  "name", "mobile", "alt_mobile", "email", "city", "state", "country", "preferred_location", "property_type",
  "budget_min", "budget_max", "purpose", "requirement", "notes", "campaign", "sub_source",
];
export const CLIENT_MAP = ["name", "mobile", "alt_mobile", "email", "address", "city"];

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/** Accept options as array or a comma/newline separated string. */
export function parseOptions(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return String(v || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error("Could not copy – please copy manually");
  }
}

// ── CSV helpers (client-side export) ───────────────────────────────────────────
export function toCSV(headers: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

export function downloadCSV(name: string, headers: string[], rows: unknown[][]) {
  const blob = new Blob(["﻿" + toCSV(headers, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── Signature pad ──────────────────────────────────────────────────────────────
export function SignaturePad({ value, onChange, disabled, invalid }:
  { value?: string | null; onChange: (dataUrl: string | null) => void; disabled?: boolean; invalid?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let lastW = 0;
    const resize = () => {
      const r = c.getBoundingClientRect();
      if (Math.round(r.width) === lastW) return; // mobile address-bar resizes only change height
      lastW = Math.round(r.width);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      if (dirty.current) { dirty.current = false; onChangeRef.current(null); }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // external clear (e.g. parent reset)
  useEffect(() => {
    if (!value && dirty.current && ref.current) {
      ref.current.getContext("2d")?.clearRect(0, 0, ref.current.width, ref.current.height);
      dirty.current = false;
    }
  }, [value]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    dirty.current = true;
    onChange(ref.current?.toDataURL("image/png") ?? null);
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div>
      <div className={cn("relative overflow-hidden rounded-lg border bg-white", invalid ? "border-danger" : "border-border")}>
        <canvas ref={ref} className="block h-40 w-full cursor-crosshair touch-none" aria-label="Signature pad"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
        {!value && (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 mx-6 border-t border-dashed border-slate-300 pt-1 text-center text-[11px] text-slate-400">
            Sign here
          </span>
        )}
      </div>
      <button type="button" onClick={clear} disabled={disabled}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
        <Eraser className="h-3.5 w-3.5" /> Clear signature
      </button>
    </div>
  );
}

// ── Field renderer (shared by builder preview & public form) ───────────────────
export type FieldValue = string | boolean | File | null | undefined;

export function FormFieldInput({ field, value, onChange, error, disabled }:
  { field: FormField; value: FieldValue; onChange: (v: FieldValue) => void; error?: string; disabled?: boolean }) {
  const id = `f_${field.key}`;
  const opts = parseOptions(field.options);
  const cls = cn("input", error && "border-danger focus:border-danger focus:ring-danger/15");
  const str = typeof value === "string" ? value : "";

  if (field.type === "section") {
    return (
      <div className="pt-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">{field.label}</h3>
        <div className="mt-1.5 h-px bg-border" />
      </div>
    );
  }

  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = <textarea id={id} rows={4} className={cn(cls, "resize-y")} value={str} disabled={disabled}
        placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <select id={id} className={cn(cls, "pr-8")} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case "radio":
      control = (
        <div role="radiogroup" aria-labelledby={`${id}_l`} className="flex flex-wrap gap-2">
          {opts.map((o) => (
            <label key={o} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
              str === o ? "border-primary bg-primary-soft text-primary" : "border-border bg-white text-slate-700 hover:bg-slate-50")}>
              <input type="radio" name={id} value={o} checked={str === o} disabled={disabled}
                onChange={() => onChange(o)} className="accent-[var(--primary)]" />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    case "checkbox":
      return (
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
            <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--primary)]"
              checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
            <span>{field.label}{field.required && <span className="text-danger"> *</span>}</span>
          </label>
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      );
    case "file": {
      const f = value instanceof File ? value : null;
      control = (
        <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-sm transition hover:bg-slate-50",
          error ? "border-danger" : "border-slate-300")}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Upload className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-700">{f ? f.name : "Choose a file"}</span>
            <span className="block text-xs text-muted">{f ? `${(f.size / 1024).toFixed(0)} KB` : "PDF, JPG or PNG"}</span>
          </span>
          <input id={id} type="file" className="sr-only" disabled={disabled} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
      );
      break;
    }
    case "signature":
      control = <SignaturePad value={str || null} onChange={(v) => onChange(v)} disabled={disabled} invalid={!!error} />;
      break;
    default:
      control = <input id={id} className={cls} disabled={disabled} placeholder={field.placeholder}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
        inputMode={field.type === "tel" ? "tel" : field.type === "number" ? "decimal" : undefined}
        autoComplete={field.map_to === "name" || field.key === "name" ? "name" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : undefined}
        value={str} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div>
      <label id={`${id}_l`} htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {field.label}{field.required && <span className="text-danger"> *</span>}
      </label>
      {control}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
