"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FollowUpCenter } from "@/components/followup-center";
import { PageHeader } from "@/components/ui";

function FollowUps() {
  const params = useSearchParams();
  const extra = params.get("assigned_to_id") ? { assigned_to_id: params.get("assigned_to_id") } : {};
  return (
    <div>
      <PageHeader title="Follow-Up Command Center" subtitle="Overdue items stay here until they are completed or rescheduled." />
      <div className="card">
        <FollowUpCenter defaultBucket={params.get("bucket") || "overdue"} extraParams={extra} />
      </div>
    </div>
  );
}

export default function FollowUpsPage() {
  return <Suspense><FollowUps /></Suspense>;
}
