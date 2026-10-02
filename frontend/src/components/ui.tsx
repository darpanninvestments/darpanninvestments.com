"use client";

import {
  createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Flame, Inbox, Loader2, X } from "lucide-react";
import { cn, contrastText, initials } from "@/lib/utils";

// ── Button ─────────────────────────────────────────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
  size?: "xs" | "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref,
) {
  const v = {
    primary: "bg-primary text-white hover:bg-primary-hover shadow-sm",
    secondary: "bg-slate-100 text-slate-800 hover:bg-slate-200",
    outline: "border border-border bg-white text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-danger text-white hover:bg-red-700",
    success: "bg-success text-white hover:bg-emerald-700",
  }[variant];
  const s = { xs: "h-7 px-2 text-xs gap-1", sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-4 text-sm gap-2" }[size];
  return (
    <button ref={ref} type="button" disabled={disabled || loading}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50", v, s, className)}
      {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ title, className, children, tone = "default", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: "default" | "green" | "blue" | "red" | "amber" | "violet" }) {
  const t = {
    default: "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
    green: "text-emerald-600 hover:bg-emerald-50", blue: "text-blue-600 hover:bg-blue-50",
    red: "text-red-600 hover:bg-red-50", amber: "text-amber-600 hover:bg-amber-50",
    violet: "text-violet-600 hover:bg-violet-50",
  }[tone];
  return (
    <button type="button" title={title} aria-label={title}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-40", t, className)} {...rest}>
      {children}
    </button>
  );
}

// ── Form controls ──────────────────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref) {
  return <input ref={ref} className={cn("input", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn("input resize-y", className)} {...rest} />;
});

type Opt = { value: string | number; label: string };
export function Select({ options, placeholder, className, ...rest }:
  SelectHTMLAttributes<HTMLSelectElement> & { options: Opt[]; placeholder?: string }) {
  return (
    <select className={cn("input pr-8", className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ label, required, error, hint, children, className, htmlFor }:
  { label?: ReactNode; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="text-danger"> *</span>}</label>}
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)]" {...rest} />
      {label}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition", checked ? "bg-primary" : "bg-slate-300")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

// ── Display ────────────────────────────────────────────────────────────────────
export function Badge({ children, color, tone = "slate", className }:
  { children: ReactNode; color?: string | null; tone?: "slate" | "green" | "red" | "amber" | "blue" | "violet"; className?: string }) {
  if (color) {
    return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", className)}
      style={{ background: color, color: contrastText(color) }}>{children}</span>;
  }
  const t = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-1 ring-red-200", amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200", violet: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", t, className)}>{children}</span>;
}

export function PriorityBadge({ value }: { value?: string | null }) {
  const tone = value === "Hot" ? "red" : value === "Cold" ? "blue" : "amber";
  return <Badge tone={tone}>{value === "Hot" && <Flame className="mr-0.5 h-3 w-3" />}{value || "Warm"}</Badge>;
}

const STATUS_TONES: Record<string, "green" | "red" | "amber" | "blue" | "slate" | "violet"> = {
  Completed: "green", Confirmed: "blue", Scheduled: "violet", Rescheduled: "amber", Cancelled: "red", "No Show": "red",
  Available: "green", Hold: "amber", Reserved: "violet", Booked: "blue", Sold: "slate", Blocked: "red",
  Pending: "amber", Uploaded: "blue", Verified: "green", Rejected: "red", Archived: "slate",
  pending: "amber", completed: "green", cancelled: "slate", Processing: "blue", Failed: "red", "Rolled Back": "slate",
  "Active Client": "green", "Onboarding Pending": "amber", "Onboarding In Progress": "blue", "Documents Pending": "violet",
  "Closed / Completed": "slate", Active: "green", Submitted: "blue", Reviewed: "green", "Correction Requested": "amber",
};
export function StatusPill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONES[value] || "slate"}>{value}</Badge>;
}

export function Avatar({ name, size = 28, className }: { name?: string | null; size?: number; className?: string }) {
  const palette = ["#1e3a8a", "#0f766e", "#9333ea", "#c2410c", "#0369a1", "#be123c", "#4d7c0f", "#a16207"];
  const idx = (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: palette[idx], fontSize: size * 0.38 }} title={name || ""}>
      {initials(name)}
    </span>
  );
}

export function Card({ title, actions, children, className, bodyClass }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, icon, tone = "blue", onClick, sub }:
  { label: string; value: ReactNode; icon?: ReactNode; tone?: string; onClick?: () => void; sub?: ReactNode }) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-700", violet: "bg-violet-50 text-violet-700", slate: "bg-slate-100 text-slate-700",
    pink: "bg-pink-50 text-pink-700", teal: "bg-teal-50 text-teal-700",
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="card flex h-full w-full flex-col items-start gap-2 p-3 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-md enabled:active:scale-[0.99] sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      {icon && <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5", tones[tone])}>{icon}</span>}
      <span className="min-w-0">
        <span className="line-clamp-2 block text-xs font-medium leading-snug text-muted sm:line-clamp-1">{label}</span>
        <span className="block text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{value}</span>
        {sub && <span className="block text-[11px] text-muted">{sub}</span>}
      </span>
    </button>
  );
}

export function PageHeader({ title, subtitle, actions, back }:
  { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-primary", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner />{label}</div>;
}

export function Empty({ title = "Nothing here yet", text, action, icon }:
  { title?: string; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon || <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {text && <p className="mt-1 max-w-sm text-xs text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }:
  { tabs: { value: string; label: ReactNode; count?: number; color?: string }[]; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition",
            value === t.value ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.color && <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />}
          {t.label}
          {t.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px]", value === t.value ? "bg-primary-soft" : "bg-slate-100")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage, pageSize, onPageSize }:
  { page: number; pages: number; total: number; onPage: (p: number) => void; pageSize?: number; onPageSize?: (n: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
      <span>{total.toLocaleString()} record{total === 1 ? "" : "s"}</span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select className="rounded border border-border bg-white px-1 py-0.5" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <IconButton title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></IconButton>
        <span>Page {page} of {Math.max(pages, 1)}</span>
        <IconButton title="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></IconButton>
      </div>
    </div>
  );
}

// ── Overlays ───────────────────────────────────────────────────────────────────
function useEsc(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, open]);
}

export function Modal({ open, onClose, title, children, footer, size = "md" }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  useEsc(onClose, open);
  if (!open || typeof document === "undefined") return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cn("animate-fade-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl", w)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <IconButton title="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = "max-w-2xl" }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEsc(onClose, open);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <div className={cn("animate-slide-in flex h-full w-full flex-col bg-white shadow-2xl", width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1 text-base font-semibold text-slate-900">{title}</div>
          <IconButton title="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Small anchored dropdown menu. */
export function Menu({ trigger, children, align = "right", width = "w-52" }:
  { trigger: (toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cn("animate-fade-in absolute z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-xl", width, align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, icon, danger, disabled }:
  { onClick?: () => void; children: ReactNode; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-slate-50 disabled:opacity-40", danger ? "text-danger" : "text-slate-700")}>
      {icon && <span className="text-slate-400">{icon}</span>}{children}
    </button>
  );
}

// ── Confirm dialog (promise based) ─────────────────────────────────────────────
type ConfirmOpts = { title?: string; message?: ReactNode; confirmText?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || "Are you sure?"} size="sm"
        footer={<>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state?.danger === false ? "primary" : "danger"} onClick={() => close(true)}>{state?.confirmText || "Confirm"}</Button>
        </>}>
        <div className="text-sm text-slate-600">{state?.message || "This action cannot be undone."}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-slate-800">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}
