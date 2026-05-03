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
  id?: string;
  email?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: {
    id: string;
    email?: string;
  };
  error?: string;
  error_description?: string;
  message?: string;
  msg?: string;
  code?: string;
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

export async function consumeAuthRedirectSession(): Promise<AuthSession | null> {
  if (!isAuthConfigured() || !window.location.hash.includes("access_token=")) return null;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  const refreshToken = params.get("refresh_token") ?? "";
  const expiresIn = Number(params.get("expires_in") ?? "3600");
  const user = await fetchAuthUser(accessToken);
  const session: AuthSession = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    user
  };

  storeSession(session);
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  return session;
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
  const data = await readSupabaseResponse(response);

  if (!response.ok || !data.access_token || !data.user?.id) {
    if (response.ok && data.user?.id && !data.access_token) {
      throw new Error("Account created. Check your email, confirm the signup link, then GeoDuel will sign you in automatically.");
    }
    throw new Error(formatSupabaseAuthError(data));
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

async function fetchAuthUser(accessToken: string): Promise<AuthUser> {
  let response: Response;
  try {
    response = await fetch(`${authBaseUrl()}/user`, {
      headers: authHeaders(accessToken)
    });
  } catch {
    throw new Error("Email was confirmed, but GeoDuel could not load the Supabase user session. Refresh and try signing in.");
  }

  const data = await readSupabaseResponse(response);
  const user = data.user?.id ? data.user : data.id ? { id: data.id, email: data.email } : undefined;
  if (!response.ok || !user?.id) {
    throw new Error(formatSupabaseAuthError(data));
  }

  return {
    id: user.id,
    email: user.email ?? ""
  };
}

async function readSupabaseResponse(response: Response): Promise<SupabaseAuthResponse> {
  try {
    return (await response.json()) as SupabaseAuthResponse;
  } catch {
    return {
      message: response.ok ? "" : `Supabase request failed with status ${response.status}.`
    };
  }
}

function formatSupabaseAuthError(data: SupabaseAuthResponse): string {
  const rawMessage = data.error_description || data.message || data.msg || data.error || data.code || "";
  const message = rawMessage.replace(/^400:\s*/i, "").trim();

  if (/invalid.*credentials/i.test(message) || data.code === "invalid_credentials") {
    return "Invalid email or password. If you just created the account, confirm the email link first.";
  }

  if (/email.*not.*confirmed/i.test(message)) {
    return "Email is not confirmed yet. Open the confirmation email from Supabase, then return to GeoDuel.";
  }

  return message || "Authentication failed. Check the email, password, and Supabase Auth settings.";
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
