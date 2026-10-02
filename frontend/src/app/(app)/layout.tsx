"use client";

import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/shell";
import { ConfirmProvider } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ConfirmProvider>
        <AppShell>{children}</AppShell>
      </ConfirmProvider>
    </AuthProvider>
  );
}
