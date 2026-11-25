import { createClient } from "@supabase/supabase-js";

const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const apiUrl = (path: string) => `${apiBase}${path}`;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const configurationReady = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = createClient(supabaseUrl || "https://invalid.local", supabaseAnonKey || "missing", {
  // PKCE must retain its code verifier across the Google redirect. Keep the
  // Supabase session in this tab only; the Owner API still uses an HttpOnly cookie.
  auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, storage: window.sessionStorage, detectSessionInUrl: true, storageKey: "podpilot-admin-auth" },
});

let csrfToken = sessionStorage.getItem("podpilot_admin_csrf") || "";

export class ApiError extends Error {
  status: number;
  requestId: string;
  constructor(message: string, status: number, requestId = "") {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes((init.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: "include" });
  const requestId = response.headers.get("x-request-id") || "";
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.detail || "The Admin API request failed.", response.status, requestId);
  return payload as T;
}

export async function exchangeSession(accessToken: string) {
  const result = await api<{ csrf_token: string; owner: Owner; expires_at: string }>("/api/admin/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  csrfToken = result.csrf_token;
  sessionStorage.setItem("podpilot_admin_csrf", csrfToken);
  return result;
}

export function clearLocalAdminSession() {
  csrfToken = "";
  sessionStorage.removeItem("podpilot_admin_csrf");
}

export type Owner = { id: string; email?: string | null; role: string };
export type Page<T = Record<string, unknown>> = { items: T[]; page: number; page_size: number; total: number; pages: number; status?: string; reason?: string };
export type Metric = { value: number | string | null; status: "available" | "unavailable"; source: string; definition: string; is_estimate: boolean; reason?: string | null; refreshed_at: string };
