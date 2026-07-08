"use client";

/**
 * Session provider — the single owner of "who is signed in".
 * On mount it exchanges the stored refresh token for an access token and
 * loads GET /users/me (profile + scope breadcrumb). Access tokens live in
 * module memory (lib/api.ts); only the refresh token is persisted.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const loadProfile = useCallback(async () => {
    const me = await apiGet<MeResponse>("/users/me");
    setUser(me.user);
    setBreadcrumb(me.breadcrumb);
    setStatus("authed");
    return me.user;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasStoredSession()) {
        if (!cancelled) setStatus("anon");
        return;
      }
      const ok = await refreshSession();
      if (cancelled) return;
      if (!ok) {
        setUser(null);
        setBreadcrumb(null);
        setStatus("anon");
        return;
      }
      try {
        await loadProfile();
      } catch {
        if (!cancelled) setStatus("anon");
      }
    })();
    const off = onSessionEnded(() => {
      setUser(null);
      setBreadcrumb(null);
      setStatus("anon");
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [loadProfile]);

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
    setUser(null);
    setBreadcrumb(null);
    setStatus("anon");
    if (refreshToken) {
      // Best-effort server-side revocation; the local session is already gone.
      try {
        await apiPost<void>("/auth/logout", { refreshToken });
      } catch {
        /* the token expires on its own */
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const value = useMemo<SessionValue>(
    () => ({ user, breadcrumb, status, login, adoptSession, logout, refreshProfile }),
    [user, breadcrumb, status, login, adoptSession, logout, refreshProfile],
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
    while the session resolves (calm blank, never a blocking spinner). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anon") router.replace("/login");
  }, [status, router]);

  if (status !== "authed") return null;
  return <>{children}</>;
}

/** Admin gate: anonymous → /login; signed-in non-admins → student home. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const router = useRouter();
  const admin = user !== null && isAdminRole(user.role);

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    else if (status === "authed" && !admin) router.replace("/");
  }, [status, admin, router]);

  if (status !== "authed" || !admin) return null;
  return <>{children}</>;
}
