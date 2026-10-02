"use client";

import { useState, type ReactNode } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
    // every mutation error surfaces as a toast unless the caller handles it with meta.silent
    mutationCache: new MutationCache({
      onError: (err, _v, _c, m) => {
        if (!m.meta?.silent) toast.error(err instanceof Error ? err.message : "Something went wrong");
      },
    }),
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
