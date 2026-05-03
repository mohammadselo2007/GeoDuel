import type {
  AdminPermission,
  AdminRole,
  AdminAnalyticsSummary,
  AdminRoomSummary,
  AdminUserSummary,
  AuditLogEntry,
  CountryPool,
  FriendsPayload,
  FriendRequestActionResponse,
  GameMode,
  PublicProfile
} from "../../../shared/types";
import { apiBaseUrl } from "./env";
import type { LeaderboardEntry, MatchProgressResult, PlayerProfile } from "./profile";

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalGamesPlayed: number;
  activeRooms: number;
  rankedGames: number;
  practiceGames: number;
  averageGameDurationMs: number;
  mostUsedRegions: Array<{ region: string; count: number }>;
  serverHealth: "ok" | "degraded";
}

export interface CompletedMatchPayload {
  result: MatchProgressResult;
  roomCode: string;
  mode: GameMode;
  countryPool: CountryPool;
  durationMs: number;
}

export async function fetchRemoteProfile(token: string): Promise<PlayerProfile | null> {
  return apiRequest<PlayerProfile>("/api/me", { token }).catch(() => null);
}

export async function saveRemoteProfile(token: string, profile: PlayerProfile): Promise<PlayerProfile | null> {
  return apiRequest<PlayerProfile>("/api/me", {
    token,
    method: "PUT",
    body: profile
  }).catch(() => null);
}

export async function fetchRemoteLeaderboard(): Promise<LeaderboardEntry[] | null> {
  return apiRequest<LeaderboardEntry[]>("/api/leaderboard").catch(() => null);
}

export async function recordCompletedMatch(token: string | undefined, payload: CompletedMatchPayload) {
  await apiRequest("/api/matches", {
    token,
    method: "POST",
    body: payload
  }).catch(() => undefined);
}

export async function trackEvent(event: string, detail: Record<string, unknown> = {}) {
  await apiRequest("/api/analytics", {
    method: "POST",
    body: {
      event,
      path: window.location.pathname,
      detail
    }
  }).catch(() => undefined);
}

export async function fetchAdminStats(token?: string, adminToken?: string): Promise<AdminStats> {
  return apiRequest<AdminStats>("/api/admin/stats", {
    token,
    adminToken
  });
}

export async function fetchAdminAnalyticsApi(token?: string, adminToken?: string): Promise<AdminAnalyticsSummary> {
  return apiRequest<AdminAnalyticsSummary>("/api/admin/analytics", { token, adminToken });
}

export async function fetchAdminRoomsApi(token?: string, adminToken?: string): Promise<AdminRoomSummary[]> {
  return apiRequest<AdminRoomSummary[]>("/api/admin/rooms", { token, adminToken });
}

export async function searchUsers(query: string): Promise<PublicProfile[]> {
  return apiRequest<PublicProfile[]>(`/api/users/search?q=${encodeURIComponent(query)}`).catch(() => []);
}

export async function fetchPublicProfile(userId: string): Promise<PublicProfile | null> {
  return apiRequest<PublicProfile>(`/api/users/${encodeURIComponent(userId)}`).catch(() => null);
}

export async function fetchFriends(token: string): Promise<FriendsPayload | null> {
  return apiRequest<FriendsPayload>("/api/friends", { token }).catch(() => null);
}

export async function sendFriendRequestApi(token: string, targetUserId: string): Promise<FriendRequestActionResponse> {
  return apiRequest<FriendRequestActionResponse>("/api/friends/request", {
    token,
    method: "POST",
    body: { targetUserId }
  });
}

export async function respondFriendRequestApi(token: string, requestId: string, accepted: boolean) {
  await apiRequest(`/api/friends/requests/${encodeURIComponent(requestId)}/${accepted ? "accept" : "decline"}`, {
    token,
    method: "POST"
  });
}

export async function removeFriendApi(token: string, friendUserId: string) {
  await apiRequest(`/api/friends/${encodeURIComponent(friendUserId)}`, {
    token,
    method: "DELETE"
  });
}

export async function searchAdminUsersApi(token: string | undefined, adminToken: string | undefined, query: string): Promise<AdminUserSummary[]> {
  return apiRequest<AdminUserSummary[]>(`/api/admin/users?q=${encodeURIComponent(query)}`, { token, adminToken });
}

export async function fetchAuditLogsApi(token?: string, adminToken?: string): Promise<AuditLogEntry[]> {
  return apiRequest<AuditLogEntry[]>("/api/admin/audit", { token, adminToken });
}

export async function banUserApi(token: string | undefined, adminToken: string | undefined, userId: string, reason: string) {
  await apiRequest("/api/admin/ban", {
    token,
    adminToken,
    method: "POST",
    body: { userId, reason }
  });
}

export async function unbanUserApi(token: string | undefined, adminToken: string | undefined, userId: string) {
  await apiRequest("/api/admin/unban", {
    token,
    adminToken,
    method: "POST",
    body: { userId }
  });
}

export async function updateUserRatingApi(
  token: string | undefined,
  adminToken: string | undefined,
  userId: string,
  rating: number,
  reason: string
): Promise<PlayerProfile> {
  return apiRequest<PlayerProfile>(`/api/admin/users/${encodeURIComponent(userId)}/rating`, {
    token,
    adminToken,
    method: "POST",
    body: { rating, reason }
  });
}

export async function forceEndRoomApi(token: string | undefined, adminToken: string | undefined, roomCode: string) {
  await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/end`, {
    token,
    adminToken,
    method: "POST"
  });
}

export async function kickPlayerApi(token: string | undefined, adminToken: string | undefined, roomCode: string, userId: string) {
  await apiRequest(`/api/admin/rooms/${encodeURIComponent(roomCode)}/kick`, {
    token,
    adminToken,
    method: "POST",
    body: { userId }
  });
}

export async function setAdminRoleApi(
  token: string | undefined,
  adminToken: string | undefined,
  userId: string,
  role: AdminRole,
  permissions: AdminPermission[]
) {
  await apiRequest("/api/admin/roles", {
    token,
    adminToken,
    method: "POST",
    body: { userId, role, permissions }
  });
}

export async function removeAdminRoleApi(token: string | undefined, adminToken: string | undefined, userId: string, role: AdminRole) {
  await apiRequest(`/api/admin/roles/${encodeURIComponent(userId)}/${encodeURIComponent(role)}`, {
    token,
    adminToken,
    method: "DELETE"
  });
}

async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; token?: string; adminToken?: string; body?: unknown } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.adminToken ? { "x-admin-token": options.adminToken } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (err) {
    throw new Error(
      err instanceof TypeError
        ? "Could not reach the GeoDuel backend. Check VITE_SERVER_URL in Vercel, CLIENT_ORIGIN in Render, then redeploy both."
        : "Backend request failed."
    );
  }

  if (!response.ok) {
    const message = await response.text();
    let parsedMessage = "";
    try {
      const parsed = JSON.parse(message) as { message?: string };
      parsedMessage = parsed.message ?? "";
    } catch {
      parsedMessage = "";
    }
    throw new Error(parsedMessage || message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
