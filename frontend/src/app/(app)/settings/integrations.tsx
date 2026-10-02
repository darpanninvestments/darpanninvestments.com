"use client";

import { useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Mail, MessageCircle, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, Loading, Modal, useConfirm } from "@/components/ui";
import type { SectionProps } from "./shared";

const subscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(subscribe, () => window.location.origin, () => "");

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="xs" variant="outline" icon={done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
        catch { toast.error("Copy failed – select and copy manually"); }
      }}>{done ? "Copied" : label}</Button>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{children}</pre>;
}

export function IntegrationsSection({ companyId, canConfigure }: SectionProps) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const origin = useOrigin();
  const isGlobal = !!useAuth().me?.is_global;
  const [fresh, setFresh] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["/api/settings", companyId], queryFn: () => api.get("/api/settings", { company_id: companyId || undefined }) });
  const rotate = useMutation({
    mutationFn: () => api.post(`/api/settings/integrations/rotate-api-key${qs({ company_id: companyId || undefined })}`),
    onSuccess: (r) => { setFresh(r.api_key); qc.invalidateQueries({ queryKey: ["/api/settings"] }); },
  });
  if (!q.data) return <Loading />;
  const masked: string | undefined = q.data.integrations?.api_key;
  const url = `${origin}/api/public/leads`;
  const sample = JSON.stringify({
    name: "Rahul Sharma", mobile: "9876543210", email: "rahul@example.com", source: "Website",
    project: "Skyline Residency", campaign: "Diwali Offer 2026", external_id: "lead-12345",
  }, null, 2);
  const curl = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-API-Key: ${masked ? "<your API key>" : "<generate a key first>"}' \\\n  -d '${JSON.stringify(JSON.parse(sample))}'`;

  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2"><Webhook className="h-4 w-4 text-primary" />Lead capture webhook</span>}>
        <p className="mb-3 text-sm text-slate-600">
          Send leads from your website, landing pages or any tool. Leads are created in this company, de-duplicated on <code className="rounded bg-slate-100 px-1">external_id</code> and auto-assigned using your assignment rules.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2">
          <Badge tone="green">POST</Badge>
          <code className="min-w-0 flex-1 break-all text-sm text-slate-800">{url}</code>
          <CopyButton text={url} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between"><span className="label mb-0">Sample request</span><CopyButton text={curl} /></div>
            <Code>{curl}</Code>
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between"><span className="label mb-0">JSON body (single object or array of up to 500)</span><CopyButton text={sample} /></div>
            <Code>{sample}</Code>
          </div>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
          <li><b>source</b> and <b>project</b> are matched by name (case-insensitive) to your Lead Sources and Projects.</li>
          <li><b>name</b> and <b>mobile</b> are required; other lead fields (city, budget, notes…) are accepted too.</li>
          <li>Rate limit: 600 requests / minute per company.</li>
        </ul>
      </Card>

      <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />API key</span>}
        actions={canConfigure && (
          <Button size="sm" variant={masked ? "outline" : "primary"} icon={<RefreshCw className="h-3.5 w-3.5" />} loading={rotate.isPending}
            disabled={isGlobal && !companyId}
            onClick={async () => {
              if (masked && !(await confirm({ title: "Rotate API key?", message: "The current key stops working immediately. Update every integration that uses it.", confirmText: "Rotate key" }))) return;
              rotate.mutate();
            }}>{masked ? "Rotate key" : "Generate key"}</Button>
        )}>
        {masked ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-border bg-slate-50 px-3 py-1.5 font-mono text-sm">{masked}</code>
            <span className="text-xs text-muted">The full key is shown only once, when generated.</span>
          </div>
        ) : <p className="text-sm text-muted">No API key yet. Generate one to start receiving leads.</p>}
        <p className="mt-3 text-xs text-muted">Send it in the <code className="rounded bg-slate-100 px-1">X-API-Key</code> header. Each company has its own key{!companyId ? " – CRM admins: pick a company at the top first" : ""}.</p>
      </Card>

      <Card title="Meta (Facebook / Instagram) & Google lead ads">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Use a connector such as Zapier, Make, Pabbly or LeadsBridge with the “New lead” trigger for your Facebook Lead Ads form or Google Ads lead form extension.</li>
          <li>Add a “Webhook / HTTP POST” action to the URL above with the <code className="rounded bg-slate-100 px-1">X-API-Key</code> header.</li>
          <li>Map the form fields to <code className="rounded bg-slate-100 px-1">name, mobile, email</code>, set <code className="rounded bg-slate-100 px-1">source</code> to e.g. “Facebook” / “Google Ads”, <code className="rounded bg-slate-100 px-1">campaign</code> to the ad/campaign name and <code className="rounded bg-slate-100 px-1">external_id</code> to the lead ID so retries never create duplicates.</li>
        </ol>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Email (SMTP)</span>}>
          <p className="text-sm text-slate-600">Outgoing email (welcome mails, password resets, reminders, notifications) is sent through the SMTP account configured on the server
            (<code className="rounded bg-slate-100 px-1">SMTP_HOST / SMTP_USER / SMTP_PASSWORD</code> environment variables). Contact your server administrator to change it.</p>
          <p className="mt-2 text-xs text-muted">Each user chooses which notifications they get by email in their Profile, under Notifications.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" />WhatsApp</span>}>
          <p className="text-sm text-slate-600">One-click WhatsApp buttons across the CRM open a <code className="rounded bg-slate-100 px-1">wa.me</code> deep link with the chosen message template pre-filled, using the agent&apos;s own WhatsApp (app or web). The activity is logged on the lead timeline.</p>
          <p className="mt-2 text-xs text-muted"><Badge tone="amber">Phase 2</Badge> Per-user WhatsApp sessions (scan a QR code to link each agent&apos;s number and send/receive inside the CRM) are planned for a later phase.</p>
        </Card>
      </div>

      <Modal open={!!fresh} onClose={() => setFresh(null)} title="Your new API key" size="md"
        footer={<Button onClick={() => setFresh(null)}>I&apos;ve saved it</Button>}>
        <p className="mb-3 text-sm text-slate-600">Copy this key now – for security it won&apos;t be shown again.</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{fresh}</code>
          {fresh && <CopyButton text={fresh} />}
        </div>
      </Modal>
    </div>
  );
}
