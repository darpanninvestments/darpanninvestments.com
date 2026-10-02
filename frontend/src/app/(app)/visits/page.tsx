"use client";

import { Suspense } from "react";
import { AppointmentsPage } from "@/components/scheduling";
import { Loading } from "@/components/ui";

export default function Page() {
  return <Suspense fallback={<Loading />}><AppointmentsPage kind="visit" /></Suspense>;
}
