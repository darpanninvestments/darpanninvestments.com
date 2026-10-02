"use client";

import type { Scope } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Admin-area helpers: data-scope styling and user-agent descriptions. */
export const SCOPES: Scope[] = ["none", "own", "team", "company", "all"];

export const SCOPE_INFO: Record<Scope, { label: string; cls: string; text: string }> = {
  none: { label: "None", cls: "bg-slate-50 text-slate-400 border-slate-200", text: "No access" },
  own: { label: "Own", cls: "bg-sky-50 text-sky-700 border-sky-200", text: "Only records the user owns / is assigned to" },
  team: { label: "Team", cls: "bg-violet-50 text-violet-700 border-violet-200", text: "Own records plus those of their team / reportees" },
  company: { label: "Company", cls: "bg-amber-50 text-amber-800 border-amber-200", text: "Every record in the user's company" },
  all: { label: "All", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "Every company (CRM-wide) – CRM admins only" },
};

export function ScopeSelect({ value, onChange, disabled, allowAll = true, className, placeholder }:
  { value: Scope | ""; onChange: (s: Scope) => void; disabled?: boolean; allowAll?: boolean; className?: string; placeholder?: string }) {
  const info = value ? SCOPE_INFO[value] : null;
  return (
    <select value={value} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value as Scope)}
      className={cn("h-7 rounded-md border px-1 text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed",
        info ? info.cls : "border-border bg-white text-slate-500", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {SCOPES.filter((s) => allowAll || s !== "all" || value === "all").map((s) => <option key={s} value={s}>{SCOPE_INFO[s].label}</option>)}
    </select>
  );
}

export function describeAgent(ua?: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : ua.split(" ")[0];
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
