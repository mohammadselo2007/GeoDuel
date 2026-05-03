export interface ClientEnvStatus {
  serverUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  errors: string[];
}

export function getClientEnvStatus(): ClientEnvStatus {
  const serverUrl = normalizeOptionalUrl(import.meta.env.VITE_SERVER_URL);
  const supabaseUrl = normalizeOptionalUrl(import.meta.env.VITE_SUPABASE_URL);
  const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
  const errors: string[] = [];

  if (import.meta.env.VITE_SERVER_URL && !serverUrl) {
    errors.push("VITE_SERVER_URL must be a valid URL, for example https://geoduel-backend.onrender.com.");
  }

  if (!supabaseUrl) {
    errors.push("VITE_SUPABASE_URL is missing or invalid. Copy the exact Project URL from Supabase.");
  } else if (!supabaseUrl.endsWith(".supabase.co")) {
    errors.push("VITE_SUPABASE_URL should look like https://<project-ref>.supabase.co and must not include /rest/v1.");
  }

  if (!supabaseAnonKey) {
    errors.push("VITE_SUPABASE_ANON_KEY is missing. Copy the anon public key from Supabase.");
  }

  return {
    serverUrl,
    supabaseUrl,
    supabaseAnonKey,
    errors
  };
}

export function isSupabaseEnvReady(): boolean {
  const env = getClientEnvStatus();
  return Boolean(env.supabaseUrl && env.supabaseAnonKey && env.errors.length === 0);
}

export function apiBaseUrl(): string {
  return normalizeOptionalUrl(import.meta.env.VITE_SERVER_URL) ?? "";
}

function normalizeOptionalUrl(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return undefined;
  }
}
