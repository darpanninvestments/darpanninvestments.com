import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday } from "date-fns";

export const cn = (...c: ClassValue[]) => clsx(c);

export function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v?: string | null, f = "dd MMM yyyy"): string {
  const d = toDate(v);
  return d ? format(d, f) : "—";
}

export function fmtDateTime(v?: string | null): string {
  const d = toDate(v);
  if (!d) return "—";
  if (isToday(d)) return `Today, ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return `Tomorrow, ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, "h:mm a")}`;
  return format(d, "dd MMM yyyy, h:mm a");
}

export function fromNow(v?: string | null): string {
  const d = toDate(v);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : "—";
}

/** ISO (UTC) -> value for <input type="datetime-local"> in the user's timezone */
export function toLocalInput(v?: string | null): string {
  const d = toDate(v);
  if (!d) return "";
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value -> ISO UTC string */
export function fromLocalInput(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function inHours(h: number): string {
  const d = new Date(Date.now() + h * 3600_000);
  d.setSeconds(0, 0);
  return toLocalInput(d.toISOString());
}

export function tomorrowAt(hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/** Indian style money: 1.25 Cr, 45 L, 12,500 */
export function money(v?: number | string | null, compact = true): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  if (compact && n >= 1e7) return `₹${(n / 1e7).toFixed(n % 1e7 ? 2 : 0)} Cr`;
  if (compact && n >= 1e5) return `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function initials(name?: string | null): string {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function phoneDigits(p?: string | null): string {
  const d = (p || "").replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

export function waLink(phone?: string | null, text = ""): string {
  return `https://wa.me/${phoneDigits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Fill {name} {agent} {project} placeholders in templates */
export function fillTemplate(tpl: string, vars: Record<string, string | undefined | null>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function contrastText(hex?: string | null): string {
  const h = (hex || "#94a3b8").replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#0f172a" : "#ffffff";
}

export function humanize(s?: string | null): string {
  return (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Navigate to tel:/sms:/mailto: or external URLs (keeps components free of global mutation). */
export function openUrl(url: string) {
  window.location.assign(url);
}

/** Only same-site paths are allowed after sign-in (blocks //evil.com and /\evil.com open redirects). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}
