"use client";

/**
 * Session provider — the single owner of "who is signed in".
 * On mount it exchanges the stored refresh token for an access token and
 * loads GET /users/me (profile + scope breadcrumb). Access tokens live in
 * module memory (lib/api.ts); only the refresh token is persisted.
 *
 * Offline-first bootstrap: when the refresh request never reaches the
 * service (reload with zero signal, gateway down) and a profile was cached
 * from an earlier sign-in, the session stays "authed" in a degraded mode —
 * the on-device surfaces (exam engine reads IndexedDB) keep working, and the
 * deferred refresh retries on the `online` / visibility signals. Only an
 * explicit 401/403 from the refresh endpoint ends the session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AdminRoles, RoleLevel } from "@rl/schemas";
import type {
  LoginResponse,
  MeResponse,
  ScopeWithDepth,
  User,
  UserRole,
} from "@rl/schemas";
import {
  ApiError,
  apiGet,
  apiPost,
  clearTokens,
  getStoredRefreshToken,
  hasStoredSession,
  onSessionEnded,
  refreshSession,
  setTokens,
} from "@/lib/api";

export type SessionStatus = "loading" | "authed" | "anon";

/* --------------------------- Cached profile store ------------------------- */

const PROFILE_KEY = "rl-session-profile";

interface CachedProfile {
  user: User;
  breadcrumb: ScopeWithDepth[] | null;
  cachedAt: string;
}

function readCachedProfile(): CachedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile;
    if (typeof parsed?.user?.id !== "string" || typeof parsed.user.role !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(user: User, breadcrumb: ScopeWithDepth[] | null): void {
  try {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ user, breadcrumb, cachedAt: new Date().toISOString() }),
    );
  } catch {
    /* storage unavailable — offline reloads will need the network */
  }
}

function clearCachedProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

/** Set when a degraded (offline-cached) session ends with an explicit
    rejection — the guards then route to /login?resume=1 so the login page
    can say "Sign in again to send your work — nothing was lost." */
let endedFromDegraded = false;

function loginRoute(): string {
  return endedFromDegraded ? "/login?resume=1" : "/login";
}

export function isAdminRole(role: UserRole): boolean {
  return (AdminRoles as readonly string[]).includes(role);
}

/** Landing route after sign-in, by role (confirmed decision). */
export function homeRouteFor(role: UserRole): string {
  return isAdminRole(role) ? "/admin" : "/";
}

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

interface SessionValue {
  user: User | null;
  /** Breadcrumb for the user's own scope, Central first (from /users/me). */
  breadcrumb: ScopeWithDepth[] | null;
  status: SessionStatus;
  /** True while "authed" rests on the cached profile because the deferred
      token refresh hasn't reached the service yet (offline reload). */
  degraded: boolean;
  login: (email: string, password: string) => Promise<User>;
  /** Install a LoginResponse obtained elsewhere (e.g. activation confirm). */
  adoptSession: (res: LoginResponse) => Promise<User>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** LoginResponse.user lacks scope/status fields — a display-safe stand-in
    used only if /users/me is momentarily unreachable right after sign-in. */
function provisionalUser(u: LoginResponse["user"]): User {
  return {
    ...u,
    status: "active",
    scopeName: "",
    scopeLevel: RoleLevel[u.role],
    phoneMasked: null,
    createdAt: new Date().toISOString(),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<ScopeWithDepth[] | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [degraded, setDegradedState] = useState(false);
  /* Mirrors `degraded` for the session-ended handler (runs outside render). */
  const degradedRef = useRef(false);

  const setDegraded = useCallback((v: boolean) => {
    degradedRef.current = v;
    setDegradedState(v);
  }, []);

  const loadProfile = useCallback(async () => {
    const me = await apiGet<MeResponse>("/users/me");
    writeCachedProfile(me.user, me.breadcrumb);
    endedFromDegraded = false;
    setUser(me.user);
    setBreadcrumb(me.breadcrumb);
    setDegraded(false);
    setStatus("authed");
    return me.user;
  }, [setDegraded]);

  useEffect(() => {
    let cancelled = false;
    /** Cached-profile session: signed in on-device, refresh deferred. */
    const enterDegraded = (cached: CachedProfile) => {
      setUser(cached.user);
      setBreadcrumb(cached.breadcrumb ?? null);
      setDegraded(true);
      setStatus("authed");
    };
    (async () => {
      if (!hasStoredSession()) {
        if (!cancelled) setStatus("anon");
        return;
      }
      const outcome = await refreshSession();
      if (cancelled) return;
      if (outcome === "ok") {
        try {
          await loadProfile();
        } catch (err) {
          if (cancelled) return;
          // Fresh tokens but /users/me didn't answer (connection dropped
          // mid-boot) — the cached profile keeps the device signed in.
          const cached = err instanceof ApiError ? null : readCachedProfile();
          if (cached) enterDegraded(cached);
          else setStatus("anon");
        }
        return;
      }
      if (outcome === "network") {
        // The service never answered — the stored token may still be good.
        const cached = readCachedProfile();
        if (cached) {
          enterDegraded(cached);
        } else {
          // Never completed a sign-in on this device: nothing to restore.
          setStatus("anon");
        }
        return;
      }
      // "rejected" — api.ts already cleared the stored token and broadcast
      // session-ended; make the local state deterministic regardless.
      setUser(null);
      setBreadcrumb(null);
      setDegraded(false);
      setStatus("anon");
    })();
    const off = onSessionEnded(() => {
      // Explicit rejection. If it hit a degraded session (token expired while
      // offline), the guards route to /login?resume=1 — local work is intact.
      endedFromDegraded = degradedRef.current;
      clearCachedProfile();
      setUser(null);
      setBreadcrumb(null);
      setDegraded(false);
      setStatus("anon");
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [loadProfile, setDegraded]);

  /* While degraded, retry the deferred refresh whenever the device looks
     reachable again. refreshSession() is single-flight in lib/api.ts; `busy`
     stops overlapping profile loads. Success flows through loadProfile
     (fresh cache, degraded=false); "rejected" arrives via session-ended. */
  useEffect(() => {
    if (!degraded) return;
    let busy = false;
    const retry = () => {
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const outcome = await refreshSession();
          if (outcome === "ok") await loadProfile();
        } catch {
          /* still unreachable — stay degraded, try again on the next signal */
        } finally {
          busy = false;
        }
      })();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    if (navigator.onLine) retry(); // connectivity may already be back
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [degraded, loadProfile]);

  const adoptSession = useCallback(
    async (res: LoginResponse): Promise<User> => {
      setTokens(res);
      try {
        return await loadProfile();
      } catch {
        const fallback = provisionalUser(res.user);
        setUser(fallback);
        setBreadcrumb(null);
        setStatus("authed");
        return fallback;
      }
    },
    [loadProfile],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const res = await apiPost<LoginResponse>("/auth/login", { email, password });
      return adoptSession(res);
    },
    [adoptSession],
  );

  const logout = useCallback(async () => {
    const refreshToken = getStoredRefreshToken();
    clearTokens();
    clearCachedProfile();
    endedFromDegraded = false;
    setUser(null);
    setBreadcrumb(null);
    setDegraded(false);
    setStatus("anon");
    if (refreshToken) {
      // Best-effort server-side revocation; the local session is already gone.
      try {
        await apiPost<void>("/auth/logout", { refreshToken });
      } catch {
        /* the token expires on its own */
      }
    }
  }, [setDegraded]);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const value = useMemo<SessionValue>(
    () => ({ user, breadcrumb, status, degraded, login, adoptSession, logout, refreshProfile }),
    [user, breadcrumb, status, degraded, login, adoptSession, logout, refreshProfile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/* ------------------------------ Route guards ----------------------------- */

/** Client-side gate: anonymous visitors are sent to /login. Nothing renders
    while the session resolves (calm blank, never a blocking spinner).
    A degraded (cached-profile) session counts as "authed" — offline reloads
    stay signed in; if it later ends with an explicit rejection, the redirect
    carries ?resume=1 so login shows "nothing was lost". */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anon") router.replace(loginRoute());
  }, [status, router]);

  if (status !== "authed") return null;
  return <>{children}</>;
}

/** Admin gate: anonymous → /login; signed-in non-admins → student home.
    Role checks run against the (possibly cached) profile user. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const router = useRouter();
  const admin = user !== null && isAdminRole(user.role);

  useEffect(() => {
    if (status === "anon") router.replace(loginRoute());
    else if (status === "authed" && !admin) router.replace("/");
  }, [status, admin, router]);

  if (status !== "authed" || !admin) return null;
  return <>{children}</>;
}
