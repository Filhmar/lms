/**
 * Same-origin API client for `/api/v1/*` (proxied to the backend by the
 * Next server rewrite). Token policy (confirmed decision):
 *   · access token — module memory only, never persisted;
 *   · refresh token — localStorage key `rl-auth-refresh`.
 * On a 401 the wrapper performs a single-flight refresh and retries the
 * request exactly once. The refresh path distinguishes two failures:
 *   · "rejected" — the endpoint answered 401/403: the session is over
 *     everywhere; tokens are cleared and a logout event is broadcast;
 *   · "network"  — the request never reached the service (offline, DNS,
 *     gateway hiccup): the stored token may still be good, so NOTHING is
 *     cleared and the caller may keep a cached session alive (offline-first).
 */

import type { TokenPair } from "@rl/schemas";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Calm fallback when the request never reached the service (offline, DNS…). */
export const NO_CONNECTION_MESSAGE =
  "No connection right now — nothing was lost. Try again in a moment.";

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return NO_CONNECTION_MESSAGE;
}

/* ------------------------------ Token store ------------------------------ */

const REFRESH_KEY = "rl-auth-refresh";

let accessToken: string | null = null;

export function setTokens(pair: TokenPair): void {
  accessToken = pair.accessToken;
  try {
    localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  } catch {
    /* storage unavailable — the session lives for this tab only */
  }
}

export function clearTokens(): void {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function hasStoredSession(): boolean {
  return getStoredRefreshToken() !== null;
}

/* --------------------------- Session-end signal -------------------------- */

const SESSION_ENDED_EVENT = "rl:session-ended";

/** Fired when a refresh is rejected — the SessionProvider listens and resets. */
export function onSessionEnded(handler: () => void): () => void {
  window.addEventListener(SESSION_ENDED_EVENT, handler);
  return () => window.removeEventListener(SESSION_ENDED_EVENT, handler);
}

function broadcastSessionEnded(): void {
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
}

/* -------------------------------- Refresh -------------------------------- */

/**
 * How a refresh attempt ended:
 *   · "ok"       — a fresh token pair is installed;
 *   · "network"  — the endpoint never answered (offline / gateway down).
 *                  The stored refresh token is left intact — retry later;
 *   · "rejected" — the endpoint explicitly refused the token (401/403).
 *                  Tokens are cleared and session-ended is broadcast.
 */
export type RefreshOutcome = "ok" | "network" | "rejected";

let refreshInflight: Promise<RefreshOutcome> | null = null;

/** Single-flight token refresh. Resolves "ok" when a new pair is installed. */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshInflight ??= doRefresh().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return "rejected";
  let res: Response;
  try {
    res = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Never end the session over a network hiccup — the token may still be good.
    return "network";
  }
  if (res.status === 401 || res.status === 403) {
    // The refresh token was rejected: the session is over everywhere.
    clearTokens();
    broadcastSessionEnded();
    return "rejected";
  }
  if (!res.ok) {
    // 5xx / gateway trouble — the service didn't judge the token at all.
    return "network";
  }
  const pair = (await res.json()) as TokenPair;
  setTokens(pair);
  return "ok";
}

/* ------------------------------ Core request ----------------------------- */

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === "string" && m.length > 0) message = m;
      else if (Array.isArray(m) && m.length > 0) message = m.join(" · ");
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message);
}

async function request(path: string, init: RequestInit, allowRetry: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const res = await fetch(`/api/v1${path}`, { ...init, headers });
  if (res.status === 401 && allowRetry && hasStoredSession()) {
    const refreshed = await refreshSession();
    if (refreshed === "ok") return request(path, init, false);
  }
  return res;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await request(path, init, true);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/* ------------------------------ Typed helpers ---------------------------- */

export function apiGet<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Multipart upload — never sets Content-Type so the boundary survives. */
export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: form });
}
