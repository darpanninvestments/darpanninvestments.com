"use client";

import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Password input with show/hide toggle and a Caps Lock warning. */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { className, onKeyUp, ...rest }, ref) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div className="relative">
        <input ref={ref} type={show ? "text" : "password"} spellCheck={false} autoCapitalize="none"
          className={cn("input pr-10", className)}
          onKeyUp={(e) => { setCaps(e.getModifierState?.("CapsLock") ?? false); onKeyUp?.(e); }}
          onKeyDown={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)} {...rest} />
        <button type="button" tabIndex={-1} onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {caps && <p className="mt-1 text-xs font-medium text-amber-600">Caps Lock is on</p>}
    </div>
  );
});

const RULES: [string, (pw: string) => boolean][] = [
  ["At least 8 characters", (p) => p.length >= 8],
  ["Letters and numbers", (p) => /[a-z]/i.test(p) && /\d/.test(p)],
  ["An uppercase letter or a symbol", (p) => (/[a-z]/.test(p) && /[A-Z]/.test(p)) || /[^a-z0-9]/i.test(p)],
];

/** Live checklist + meter. Server rules (common passwords, contains name/email) are checked via the API. */
export function PasswordStrength({ password, email, name, onValid }: {
  password: string; email?: string; name?: string; onValid?: (ok: boolean) => void;
}) {
  const [server, setServer] = useState<{ pw: string; issues: string[] } | null>(null);
  useEffect(() => {
    if (password.length < 8) return;
    const t = setTimeout(() => {
      api.post<{ ok: boolean; issues: string[] }>("/api/auth/check-password", { password, email, name })
        .then((r) => setServer({ pw: password, issues: r.issues })).catch(() => setServer(null));
    }, 350);
    return () => clearTimeout(t);
  }, [password, email, name]);
  const local = RULES.map(([label, test]) => ({ label, ok: test(password) }));
  const extra = server?.pw === password ? server.issues.filter((i) => i.startsWith("must not")) : [];
  const passed = local.filter((r) => r.ok).length + (password.length >= 12 ? 1 : 0);
  const ok = local.every((r) => r.ok) && server?.pw === password && server.issues.length === 0;
  useEffect(() => { onValid?.(ok); }, [ok, onValid]);
  if (!password) return null;
  const level = !local.every((r) => r.ok) || extra.length ? 1 : passed >= 4 ? 3 : 2;
  const colors = ["bg-red-500", "bg-amber-500", "bg-emerald-500"];
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">{[1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= level ? colors[level - 1] : "bg-slate-200")} />)}</div>
      <ul className="space-y-0.5 text-xs">
        {local.map((r) => (
          <li key={r.label} className={cn("flex items-center gap-1.5", r.ok ? "text-emerald-700" : "text-slate-500")}>
            {r.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{r.label}
          </li>
        ))}
        {extra.map((i) => <li key={i} className="flex items-center gap-1.5 text-red-600"><X className="h-3.5 w-3.5" />{i[0].toUpperCase() + i.slice(1)}</li>)}
      </ul>
    </div>
  );
}
