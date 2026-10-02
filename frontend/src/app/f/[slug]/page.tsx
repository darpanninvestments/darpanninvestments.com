"use client";
import Image from "next/image";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Lock } from "lucide-react";
import { api, ApiError, type Row } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FormFieldInput, type FieldValue, type FormField } from "@/components/forms-kit";

type PublicForm = {
  name: string; description?: string | null; fields: FormField[]; version: number; success_message?: string | null;
  company: string; logo_url?: string | null; prefill: Row;
};

function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  const token = sp.get("t") || undefined;
  const embed = sp.get("embed") === "1";
  const rootRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["public-form", slug, token],
    queryFn: () => api.get<PublicForm>(`/api/public/forms/${encodeURIComponent(slug)}`, { t: token }),
    retry: false, staleTime: Infinity,
  });

  const [vals, setVals] = useState<Record<string, FieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // prefill once the form arrives
  const [prefilled, setPrefilled] = useState<PublicForm | null>(null);
  if (q.data && q.data !== prefilled) {
    setPrefilled(q.data);
    const pre = q.data.prefill || {};
    const init: Record<string, FieldValue> = {};
    for (const f of q.data.fields) {
      if (f.type === "section" || f.type === "file" || f.type === "signature") continue;
      const v = pre[f.key] ?? (f.map_to ? pre[f.map_to] : undefined);
      if (v === undefined || v === null) continue;
      init[f.key] = f.type === "checkbox" ? v === true || v === "true" : String(v);
    }
    setVals(init);
  }
  useEffect(() => {
    if (q.data) document.title = `${q.data.name} · ${q.data.company || "Darpann"}`;
  }, [q.data]);

  // let an embedding page size the iframe
  useEffect(() => {
    if (!embed || typeof ResizeObserver === "undefined" || !rootRef.current || window.parent === window) return;
    const ro = new ResizeObserver(([e]) => window.parent.postMessage({ type: "darpann-form-height", slug, height: Math.ceil(e.contentRect.height) + 8 }, "*"));
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [embed, slug, q.data, done]);

  const set = (k: string, v: FieldValue) => {
    setVals((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = (fields: FormField[]) => {
    const e: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "section") continue;
      const v = vals[f.key];
      const empty = v === undefined || v === null || v === "" || v === false;
      if (f.required && empty) e[f.key] = f.type === "checkbox" ? "Please confirm to continue" : `${f.label} is required`;
      else if (!empty && f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) e[f.key] = "Enter a valid email";
      else if (!empty && f.type === "tel" && String(v).replace(/\D/g, "").length < 7) e[f.key] = "Enter a valid phone number";
    }
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!q.data || sending) return;
    const fields = q.data.fields;
    const e = validate(fields);
    setErrors(e);
    setFormError("");
    if (Object.keys(e).length) {
      document.getElementById(`f_${Object.keys(e)[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const data: Row = {};
    for (const f of fields) {
      if (f.type === "section" || f.type === "file") continue;
      const v = vals[f.key];
      if (v !== undefined && v !== null && v !== "") data[f.key] = v;
    }
    if (token) data._t = token;
    if (hp) data._hp = hp;
    for (const k of ["utm_campaign", "utm_source"]) if (sp.get(k)) data[k] = sp.get(k);

    const url = `/api/public/forms/${encodeURIComponent(slug)}`;
    setSending(true);
    try {
      let res: Row;
      if (fields.some((f) => f.type === "file")) {
        const fd = new FormData();
        fd.append("data", JSON.stringify(data));
        for (const f of fields) {
          const v = vals[f.key];
          if (f.type === "file" && v instanceof File) fd.append(f.key, v, v.name);
        }
        res = await api.upload(url, fd);
      } else {
        res = await api.post(url, data);
      }
      setDone(res.message || q.data.success_message || "Thank you! We will get in touch shortly.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const d = err instanceof ApiError ? (err.data as { detail?: unknown })?.detail : null;
      if (d && typeof d === "object" && "errors" in d) {
        setErrors((d as { errors: Record<string, string> }).errors);
        setFormError((d as { message?: string }).message || "Please fix the highlighted fields");
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  const shell = (body: React.ReactNode) => embed ? (
    <div className="min-h-full bg-white"><div ref={rootRef} className="mx-auto w-full max-w-2xl p-3 sm:p-4">{body}</div></div>
  ) : (
    <div ref={rootRef} className="min-h-full px-3 py-6 sm:py-10"
      style={{ background: "linear-gradient(to bottom, var(--sidebar) 0, var(--sidebar) 200px, var(--background) 200px)" }}>
      <div className="mx-auto w-full max-w-2xl">{body}</div>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
        <Lock className="h-3 w-3" /> Your information is kept confidential.
      </p>
    </div>
  );

  if (q.isLoading) {
    return shell(<div className="flex items-center justify-center gap-2 rounded-2xl bg-white py-24 text-sm text-muted shadow-sm"><Loader2 className="h-5 w-5 animate-spin text-primary" />Loading form…</div>);
  }
  if (q.isError || !q.data) {
    return shell(
      <div className="rounded-2xl bg-white px-6 py-16 text-center shadow-sm">
        <AlertCircle className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Form unavailable</h1>
        <p className="mt-1 text-sm text-muted">{(q.error as Error)?.message || "This form is not available."}</p>
      </div>,
    );
  }

  const f = q.data;
  const header = (
    <div className={cn("flex items-center gap-3", embed ? "mb-4" : "border-b border-border px-5 py-4 sm:px-8")}>
      {f.logo_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={f.logo_url} alt={f.company} className="h-9 w-auto max-w-[140px] object-contain" />
        : !embed && <Image src="/logo-mark.png" alt="" width={292} height={390} className="h-10 w-auto" />}
      {!embed && <span className="text-sm font-semibold text-slate-800">{f.company}</span>}
    </div>
  );

  if (done) {
    return shell(
      <div className={cn("bg-white text-center", !embed && "overflow-hidden rounded-2xl shadow-xl shadow-slate-900/10")}>
        {!embed && header}
        <div className="px-6 py-14 sm:px-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50"><CheckCircle2 className="h-8 w-8 text-success" /></div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Submitted successfully</h1>
          <p className="mx-auto mt-2 max-w-md whitespace-pre-line text-sm text-slate-600">{done}</p>
        </div>
      </div>,
    );
  }

  return shell(
    <form noValidate onSubmit={submit} className={cn("bg-white", embed ? "rounded-xl" : "overflow-hidden rounded-2xl shadow-xl shadow-slate-900/10")}>
      {!embed && header}
      <div className={cn(embed ? "" : "px-5 py-6 sm:px-8 sm:py-8")}>
        {embed && f.logo_url && header}
        <h1 className={cn("font-semibold tracking-tight text-slate-900", embed ? "text-lg" : "text-xl sm:text-2xl")}>{f.name}</h1>
        {f.description && <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600">{f.description}</p>}

        <div className="mt-6 space-y-5">
          {f.fields.map((fld) => (
            <FormFieldInput key={fld.key} field={fld} value={vals[fld.key]} error={errors[fld.key]} disabled={sending}
              onChange={(v) => set(fld.key, v)} />
          ))}
        </div>

        {/* honeypot – hidden from humans */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Leave this empty<input type="text" name="_hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
        </div>

        {formError && (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}
          </div>
        )}

        <button type="submit" disabled={sending}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-60">
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}{sending ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>,
  );
}

export default function Page() {
  return <Suspense><PublicFormPage /></Suspense>;
}
