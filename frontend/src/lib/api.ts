export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export type Paged<T> = { items: T[]; total: number; page: number; page_size: number; pages: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

function messageFrom(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const d = (data as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d) return String((d as { message: string }).message);
  return fallback;
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    ...init,
  });
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/login")
      && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/f/")) {
    window.location.assign(`/login?expired=1&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, messageFrom(data, res.statusText || "Request failed"), data);
  return data as T;
}

export function qs(params: Record<string, unknown> = {}): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  get: <T = Row>(url: string, params?: Record<string, unknown>) => request<T>("GET", url + qs(params)),
  post: <T = Row>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = Row>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  patch: <T = Row>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T = Row>(url: string) => request<T>("DELETE", url),
  upload: <T = Row>(url: string, form: FormData) => request<T>("POST", url, form),
  /** POST/GET that returns a file and triggers a browser download. */
  async download(url: string, body?: unknown, fallbackName = "download") {
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, messageFrom(data, "Download failed"), data);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? decodeURIComponent(m[1]) : fallbackName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};
