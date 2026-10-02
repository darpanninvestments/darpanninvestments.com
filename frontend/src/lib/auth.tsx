"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Row } from "./api";

export type Scope = "none" | "own" | "team" | "company" | "all";

export type Me = {
  user: Row;
  role: { id: number; key: string; name: string; level: number };
  company: Row | null;
  team: Row | null;
  permissions: Record<string, Record<string, Scope>>;
  modules: Record<string, string>;
  unread_notifications: number;
  is_global: boolean;
  password_login_enabled?: boolean;
  session_idle_minutes?: number;
};

export type Meta = {
  statuses: { id: number; name: string; color: string; category: string; requires_reason: boolean;
    allowed_next_ids: number[] | null; sub_statuses: { id: number; name: string }[] }[];
  sources: { id: number; name: string; color?: string }[];
  lookups: Record<string, { id: number; name: string; value: string; color?: string }[]>;
  custom_fields: Row[];
  processes: { id: number; name: string }[];
  projects: { id: number; name: string; process_id?: number }[];
  users: { id: number; name: string; role_id: number; team_id?: number; company_id?: number }[];
  teams: { id: number; name: string; company_id?: number }[];
  companies: { id: number; name: string }[];
  templates: { id: number; name: string; channel: string; subject?: string; body: string }[];
};

type AuthCtx = {
  me: Me | undefined;
  meta: Meta | undefined;
  loading: boolean;
  can: (module: string, action?: string) => boolean;
  scope: (module: string, action?: string) => Scope;
  refresh: () => void;
  lookup: (type: string) => { id: number; name: string; value: string }[];
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000, retry: false });
  const metaQ = useQuery({
    queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta"), enabled: !!meQ.data, staleTime: 5 * 60_000,
  });
  const scope = useCallback(
    (module: string, action = "view"): Scope => meQ.data?.permissions?.[module]?.[action] ?? "none",
    [meQ.data],
  );
  const can = useCallback((module: string, action = "view") => scope(module, action) !== "none", [scope]);
  const value = useMemo<AuthCtx>(() => ({
    me: meQ.data, meta: metaQ.data, loading: meQ.isLoading, can, scope,
    refresh: () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["meta"] }); },
    lookup: (t: string) => metaQ.data?.lookups?.[t] ?? [],
  }), [meQ.data, metaQ.data, meQ.isLoading, can, scope, qc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
