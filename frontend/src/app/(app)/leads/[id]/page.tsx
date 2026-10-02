"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LeadPanel } from "@/components/lead-panel";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Lead Board</Link>
      <LeadPanel leadId={Number(id)} full />
    </div>
  );
}
