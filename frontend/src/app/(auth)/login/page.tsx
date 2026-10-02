"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Lock, Mail, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn, safeNext } from "@/lib/utils";
import { OtpInput } from "@/components/otp-input";
import { Button, Checkbox, Field, Input } from "@/components/ui";

const LAST_EMAIL = "crm.lastEmail";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function maskEmail(e: string) {
  const [user, domain] = e.split("@");
  if (!domain) return e;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const expired = !!params.get("expired");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore last email after hydration (localStorage)
    try { const e = localStorage.getItem(LAST_EMAIL); if (e) setEmail(e); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return setError("Enter a valid work email address");
    setError(""); setLoading(true);
    try {
      await api.post("/api/auth/login-code", { email: clean });
      setEmail(clean); setCode(""); setStep("code"); setCooldown(60);
      toast.success("Code sent. Check your inbox.");
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || loading) return;
    setError(""); setLoading(true);
    try {
      const r = await api.post<{ must_change_password: boolean }>("/api/auth/login-code/verify", { email, code: value, remember });
      try { localStorage.setItem(LAST_EMAIL, email); } catch { /* ignore */ }
      router.replace(r.must_change_password ? "/profile?tab=security&force=1" : safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      setError((err as Error).message); setCode(""); setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px]">
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_20px_60px_-25px_rgba(15,27,61,0.35)] sm:p-9">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0f1b3d] to-[#1e3a8a] text-amber-300 shadow-lg shadow-blue-900/20">
          {step === "email" ? <Mail className="h-5 w-5" /> : <MailCheck className="h-5 w-5" />}
        </span>

        {step === "email" ? (
          <>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Sign in to your CRM</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">Enter your work email and we&apos;ll send you a secure one-time code. No password needed.</p>
          </>
        ) : (
          <>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Check your email</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              We sent a 6-digit code to <b className="font-medium text-slate-800">{maskEmail(email)}</b>. It expires in 10 minutes.
            </p>
          </>
        )}

        <div className="mt-6 space-y-4" aria-live="polite">
          {expired && !error && step === "email" && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800"><Clock className="h-4 w-4 shrink-0" />Your session ended. Please sign in again.</div>
          )}
          {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {step === "email" ? (
            <form onSubmit={sendCode} className="space-y-4">
              <Field label="Work email" htmlFor="login-email">
                <Input id="login-email" type="email" name="email" autoComplete="username" inputMode="email" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@darpanninvestments.com" className="h-12 rounded-xl px-4" />
              </Field>
              <Button type="submit" loading={loading} disabled={!email.trim()} className="h-12 w-full rounded-xl text-base">
                Email me a sign-in code <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-5">
              <OtpInput value={code} onChange={(v) => { setCode(v); if (error) setError(""); }} onComplete={verify} disabled={loading} invalid={!!error} />
              <Checkbox label="Keep me signed in on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <Button type="submit" loading={loading} disabled={code.length !== 6} className="h-12 w-full rounded-xl text-base">Verify & sign in</Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => { setStep("email"); setError(""); setCode(""); }} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                  <ArrowLeft className="h-4 w-4" />Change email
                </button>
                <button type="button" disabled={cooldown > 0 || loading} onClick={() => sendCode()}
                  className={cn("font-medium", cooldown > 0 ? "text-slate-400" : "text-primary hover:underline")}>
                  {cooldown > 0 ? `Resend in 0:${String(cooldown).padStart(2, "0")}` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2.5 px-2 text-xs leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p>Codes are single-use and only work in the browser that requested them. We never ask for your code by phone or message — don&apos;t share it with anyone.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
