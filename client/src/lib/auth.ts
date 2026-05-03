import { getClientEnvStatus, isSupabaseEnvReady } from "./env";

const SESSION_KEY = "geoduel:auth-session";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
}

interface SupabaseAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id: string;
    email?: string;
  };
  error_description?: string;
  msg?: string;
}

export function isAuthConfigured(): boolean {
  return isSupabaseEnvReady();
}

export function getStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(session: AuthSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  return authRequest("/token?grant_type=password", { email, password });
}

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<AuthSession> {
  return authRequest("/signup", {
    email,
    password,
    data: { display_name: displayName }
  });
}

export async function signOut(session: AuthSession | null) {
  if (!session || !isAuthConfigured()) {
    storeSession(null);
    return;
  }

  await fetch(`${authBaseUrl()}/logout`, {
    method: "POST",
    headers: authHeaders(session.accessToken)
  }).catch(() => undefined);
  storeSession(null);
}

async function authRequest(path: string, body: unknown): Promise<AuthSession> {
  if (!isAuthConfigured()) {
    throw new Error(getClientEnvStatus().errors[0] ?? "Supabase is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(`${authBaseUrl()}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(
      err instanceof TypeError
        ? "Could not reach Supabase. Check VITE_SUPABASE_URL in Vercel, then redeploy the frontend."
        : "Authentication network request failed."
    );
  }
  const data = (await response.json()) as SupabaseAuthResponse;

  if (!response.ok || !data.access_token || !data.user?.id) {
    throw new Error(data.error_description || data.msg || "Authentication failed.");
  }

  const session: AuthSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: {
      id: data.user.id,
      email: data.user.email ?? ""
    }
  };

  storeSession(session);
  return session;
}

function authBaseUrl(): string {
  const supabaseUrl = getClientEnvStatus().supabaseUrl;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL is invalid.");
  return `${supabaseUrl}/auth/v1`;
}

function authHeaders(token?: string): HeadersInit {
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}
