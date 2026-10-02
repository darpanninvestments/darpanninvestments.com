"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Mail, MonitorSmartphone, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, type Row } from "@/lib/api";
import { useAuth, type Me } from "@/lib/auth";
import { fmtDateTime, fromNow } from "@/lib/utils";
import { Avatar, Badge, Button, Card, Empty, Field, IconButton, Input, KeyValue, Loading, PageHeader, Tabs, useConfirm } from "@/components/ui";
import { PasswordInput, PasswordStrength } from "@/components/password";
import { describeAgent } from "@/components/admin";

const EMAIL_TYPES: { value: string; label: string; desc: string }[] = [
  { value: "assignment", label: "Lead assigned to me", desc: "When a lead or client is assigned or re-assigned to you" },
  { value: "followup_reminder", label: "Follow-up reminders", desc: "Shortly before a scheduled follow-up is due" },
  { value: "escalation", label: "Escalations", desc: "Overdue follow-ups of your team members" },
  { value: "visit_reminder", label: "Site visit reminders", desc: "Before an upcoming site visit" },
  { value: "meeting_reminder", label: "Meeting reminders", desc: "Before an upcoming meeting" },
  { value: "new_lead", label: "New unassigned leads", desc: "Leads arriving without an owner" },
  { value: "status", label: "Status changes", desc: "When the status of your leads changes" },
  { value: "conversion", label: "Conversions", desc: "When a lead is converted into a client" },
  { value: "form_submission", label: "Form submissions", desc: "When a client submits a form" },
  { value: "import", label: "Imports finished", desc: "When a bulk import completes" },
];
const DEFAULT_EMAIL = ["assignment", "followup_reminder", "escalation", "visit_reminder", "meeting_reminder"];

export default function ProfilePage() {
  return <Suspense fallback={<Loading />}><Profile /></Suspense>;
}

function Profile() {
  const { me } = useAuth();
  const sp = useSearchParams();
  const force = sp.get("force") === "1";
  const t = sp.get("tab");
  const [tab, setTab] = useState(force ? "security" : t === "security" || t === "notifications" ? t : "profile");
  if (!me) return <Loading />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My Profile" subtitle={`${me.role.name}${me.company ? ` · ${me.company.name}` : ""}`} />
      {force && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Please set a new password to continue</p>
            <p className="text-sm">Your current password is temporary or no longer meets the security policy. Choose a new password below to continue.</p>
          </div>
        </div>
      )}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: "profile", label: "Profile" }, { value: "security", label: "Security" }, { value: "notifications", label: "Notifications" },
      ]} />
      {tab === "profile" && <ProfileTab key={me.user.updated_at} me={me} />}
      {tab === "security" && <SecurityTab force={force} />}
      {tab === "notifications" && <NotificationsTab key={JSON.stringify(me.user.preferences?.email_notifications ?? null)} me={me} />}
    </div>
  );
}

function ProfileTab({ me }: { me: Me }) {
  const { refresh } = useAuth();
  const u = me.user;
  const [f, setF] = useState({ name: u.name || "", mobile: u.mobile || "", designation: u.designation || "", avatar_url: u.avatar_url || "" });
  const save = useMutation({
    mutationFn: () => api.patch("/api/auth/me", { name: f.name.trim(), mobile: f.mobile || null, designation: f.designation || null, avatar_url: f.avatar_url || null }),
    onSuccess: () => { toast.success("Profile updated"); refresh(); },
  });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      <Card title="Personal details">
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return toast.error("Name is required"); save.mutate(); }}>
          <Field label="Full name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" hint="Ask an administrator to change your email"><Input value={u.email} disabled /></Field>
          <Field label="Mobile"><Input type="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
          <Field label="Avatar URL" className="sm:col-span-2" hint="Link to a square image (optional)">
            <div className="flex items-center gap-3">
              {f.avatar_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
                : <Avatar name={f.name} size={40} />}
              <Input type="url" placeholder="https://…" value={f.avatar_url} onChange={(e) => setF({ ...f, avatar_url: e.target.value })} />
            </div>
          </Field>
          <div className="sm:col-span-2"><Button type="submit" icon={<Save className="h-4 w-4" />} loading={save.isPending}>Save profile</Button></div>
        </form>
      </Card>
      <Card title="Account">
        <KeyValue cols={1} items={[
          ["Role", <Badge key="r" tone="violet">{me.role.name}</Badge>],
          ["Company", me.company?.name || "All companies"],
          ["Team", me.team?.name],
          ["Last sign-in", u.last_login_at ? `${fmtDateTime(u.last_login_at)} (${fromNow(u.last_login_at)})` : null],
          ["Member since", fmtDateTime(u.created_at)],
        ]} />
      </Card>
    </div>
  );
}

function SecurityTab({ force }: { force: boolean }) {
  const { refresh, me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [valid, setValid] = useState(false);
  const onValid = useCallback((v: boolean) => setValid(v), []);
  const sessions = useQuery({ queryKey: ["/api/auth/sessions"], queryFn: () => api.get<Row[]>("/api/auth/sessions") });
  const change = useMutation({
    mutationFn: () => api.post("/api/auth/change-password", { current_password: f.current, new_password: f.next }),
    onSuccess: async () => {
      toast.success("Password changed. Other devices have been signed out.");
      setF({ current: "", next: "", confirm: "" });
      qc.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      await qc.refetchQueries({ queryKey: ["me"] });
      refresh();
      if (force) router.replace("/");
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>("/api/auth/sessions/revoke-others"),
    onSuccess: (r) => { toast.success(`Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}`); qc.invalidateQueries({ queryKey: ["/api/auth/sessions"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/api/auth/sessions/${id}`),
    onSuccess: () => { toast.success("Session signed out"); qc.invalidateQueries({ queryKey: ["/api/auth/sessions"] }); },
  });
  const submit = () => {
    if (!f.current || !f.next) return setErr("Fill in all fields");
    if (!valid) return setErr("The new password doesn't meet the requirements yet");
    if (f.next !== f.confirm) return setErr("Passwords do not match");
    if (f.next === f.current) return setErr("New password must be different from the current one");
    setErr(""); change.mutate();
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {me?.password_login_enabled ? (
      <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />Change password</span>} className={force ? "ring-2 ring-amber-300" : ""}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label={force ? "Temporary / current password" : "Current password"} required>
            <PasswordInput autoComplete="current-password" autoFocus={force} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </Field>
          <Field label="New password" required>
            <PasswordInput autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
            <PasswordStrength password={f.next} email={me?.user.email} name={me?.user.name} onValid={onValid} />
          </Field>
          <Field label="Confirm new password" required error={err}>
            <PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          <Button type="submit" loading={change.isPending} disabled={!valid || !f.current || f.next !== f.confirm}>Update password</Button>
          <p className="text-xs text-muted">Changing your password signs you out on every other device.</p>
        </form>
      </Card>
      ) : (
        <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />Sign-in method</span>}>
          <div className="space-y-3 text-sm text-slate-600">
            <p className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              You sign in with a one-time code emailed to <b className="font-medium text-slate-800">{me?.user.email}</b>. There is no password to steal or forget.</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              <li>Codes expire after 10 minutes and work once, only in the browser that requested them.</li>
              <li>You get an email whenever your account signs in from a new network or device.</li>
              <li>You are signed out automatically after {Math.round((me?.session_idle_minutes ?? 240) / 60)} hours of inactivity.</li>
            </ul>
            <Button variant="outline" size="sm" loading={revokeOthers.isPending} onClick={async () => {
              if (await confirm({ title: "Sign out all other devices?", message: "Every other browser and phone will need a new email code.", confirmText: "Sign out others" })) revokeOthers.mutate();
            }}>Sign out all other devices</Button>
          </div>
        </Card>
      )}
      <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="h-4 w-4 text-primary" />Active sessions</span>} bodyClass="p-0">
        {sessions.isLoading ? <Loading /> : !sessions.data?.length ? <Empty title="No active sessions" /> : (
          <ul className="divide-y divide-slate-100">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800" title={s.user_agent}>{describeAgent(s.user_agent)}</span>
                    {s.current && <Badge tone="green">This device</Badge>}
                  </div>
                  <div className="text-xs text-muted">IP {s.ip || "—"} · signed in {fmtDateTime(s.created_at)} · active {fromNow(s.last_seen_at)}</div>
                </div>
                {!s.current && (
                  <IconButton title="Sign out this session" tone="red"
                    onClick={async () => { if (await confirm({ title: "Sign out this session?", message: `${describeAgent(s.user_agent)} (${s.ip || "unknown IP"}) will be signed out.`, confirmText: "Sign out" })) revoke.mutate(s.id); }}>
                    <LogOut className="h-4 w-4" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NotificationsTab({ me }: { me: Me }) {
  const { refresh } = useAuth();
  const prefs: Row = me.user.preferences || {};
  const [sel, setSel] = useState<string[]>(() => prefs.email_notifications ?? DEFAULT_EMAIL);
  const save = useMutation({
    mutationFn: () => api.patch("/api/auth/me", { preferences: { email_notifications: sel } }),
    onSuccess: () => { toast.success("Notification preferences saved"); refresh(); },
  });
  const toggle = (v: string, on: boolean) => setSel((x) => (on ? [...x, v] : x.filter((y) => y !== v)));
  return (
    <Card title="Email notifications" actions={<>
      <Button size="xs" variant="ghost" onClick={() => setSel(EMAIL_TYPES.map((t) => t.value))}>All</Button>
      <Button size="xs" variant="ghost" onClick={() => setSel([])}>None</Button>
    </>}>
      <p className="mb-4 text-sm text-muted">In-app notifications are always shown in the bell. Choose which ones should also be emailed to <b>{me.user.email}</b>.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EMAIL_TYPES.map((t) => (
          <label key={t.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-slate-50">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" checked={sel.includes(t.value)} onChange={(e) => toggle(t.value, e.target.checked)} />
            <span>
              <span className="block text-sm font-medium text-slate-800">{t.label}</span>
              <span className="block text-xs text-muted">{t.desc}</span>
            </span>
          </label>
        ))}
      </div>
      <Button className="mt-4" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button>
    </Card>
  );
}
