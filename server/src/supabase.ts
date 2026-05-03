import type {
  AdminPermission,
  AdminRole,
  AdminAnalyticsSummary,
  AuditLogEntry,
  CountryPool,
  FriendRequestActionResponse,
  FriendRequestSummary,
  FriendsPayload,
  FriendSummary,
  GameMode,
  PlayerProfileSummary,
  PresenceStatus,
  PublicMatchSummary,
  PublicProfile
} from "../../shared/types.js";

export interface StoredProfile {
  id: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  rankedWins: number;
  rankedLosses: number;
  gamesPlayed: number;
  totalCorrect: number;
  totalWrong: number;
  totalSkips: number;
  currentWinStreak: number;
  bestWinStreak: number;
  bestAnswerStreak: number;
  perfectGames: number;
  noSkipWins: number;
  achievements: Record<string, number>;
  lastRatingDelta: number;
  updatedAt: number;
}

export interface SupabaseUser {
  id: string;
  email: string;
  userMetadata?: Record<string, unknown>;
}

export interface StoredMatch {
  id?: string;
  roomCode: string;
  winnerId?: string;
  loserId?: string;
  mode: GameMode;
  countryPool: CountryPool;
  ranked: boolean;
  durationMs: number;
}

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

export interface AdminContext {
  user?: SupabaseUser;
  roles: AdminRole[];
  permissions: AdminPermission[];
  isOwner: boolean;
}

export interface StoredBan {
  userId: string;
  reason: string;
  bannedBy?: string;
  createdAt: number;
  expiresAt?: number;
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  "view_analytics",
  "view_users",
  "edit_elo",
  "ban_users",
  "unban_users",
  "kick_players",
  "force_end_games",
  "view_active_rooms",
  "manage_reports",
  "grant_roles",
  "revoke_roles"
];

const DEFAULT_ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  owner: ALL_ADMIN_PERMISSIONS,
  admin: [
    "view_analytics",
    "view_users",
    "edit_elo",
    "ban_users",
    "unban_users",
    "kick_players",
    "force_end_games",
    "view_active_rooms",
    "manage_reports"
  ],
  moderator: ["view_users", "ban_users", "kick_players", "view_active_rooms", "manage_reports"],
  support: ["view_users", "view_active_rooms", "manage_reports"]
};

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export async function verifyAuthToken(token: string | undefined): Promise<SupabaseUser | undefined> {
  if (!token || !supabaseUrl || !anonKey) return undefined;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) return undefined;
  const user = (await response.json()) as { id: string; email?: string; user_metadata?: Record<string, unknown> };
  return {
    id: user.id,
    email: user.email ?? "",
    userMetadata: user.user_metadata
  };
}

export async function getOrCreateProfile(user: SupabaseUser, fallbackName = "Player"): Promise<StoredProfile> {
  const existing = await getProfile(user.id);
  if (existing) return existing;

  const name =
    typeof user.userMetadata?.display_name === "string" && user.userMetadata.display_name.trim()
      ? user.userMetadata.display_name.trim()
      : fallbackName;
  const profile = defaultProfile(user.id, name);
  await upsertProfile(profile);
  return profile;
}

export async function getProfile(userId: string): Promise<StoredProfile | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const rows = await supabaseRequest<SupabaseProfileRow[]>(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ? fromProfileRow(rows[0]) : undefined;
}

export async function upsertProfile(profile: StoredProfile): Promise<StoredProfile> {
  if (!isSupabaseConfigured()) return profile;

  await supabaseRequest("/rest/v1/profiles", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify([toProfileRow(profile)])
  });

  return profile;
}

export async function getLeaderboard(limit = 50): Promise<StoredProfile[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await supabaseRequest<SupabaseProfileRow[]>(
    `/rest/v1/profiles?select=*&order=rating.desc,wins.desc&limit=${limit}`
  );
  return rows.map(fromProfileRow);
}

export async function getProfilesByIds(userIds: string[]): Promise<StoredProfile[]> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (!isSupabaseConfigured() || uniqueIds.length === 0) return [];
  const rows = await supabaseRequest<SupabaseProfileRow[]>(
    `/rest/v1/profiles?select=*&id=in.(${uniqueIds.map(encodeURIComponent).join(",")})`
  );
  return rows.map(fromProfileRow);
}

export async function searchPublicProfiles(
  query: string,
  presenceForUser: (userId: string) => PresenceStatus
): Promise<PublicProfile[]> {
  if (!isSupabaseConfigured()) return [];
  const clean = query.trim().slice(0, 32);
  if (clean.length < 2) return [];
  const rows = await supabaseRequest<SupabaseProfileRow[]>(
    `/rest/v1/profiles?select=*&display_name=ilike.*${encodePostgrestPattern(clean)}*&order=rating.desc&limit=12`
  );
  return Promise.all(rows.map((row) => toPublicProfile(fromProfileRow(row), presenceForUser(row.id))));
}

export async function getPublicProfileById(
  userId: string,
  presence: PresenceStatus = "offline"
): Promise<PublicProfile | undefined> {
  const profile = await getProfile(userId);
  if (!profile) return undefined;
  return toPublicProfile(profile, presence, await getRecentMatches(userId));
}

export async function getRecentMatches(userId: string, limit = 8): Promise<PublicMatchSummary[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await supabaseRequest<SupabaseMatchRow[]>(
    `/rest/v1/matches?select=*&or=(winner_id.eq.${encodeURIComponent(userId)},loser_id.eq.${encodeURIComponent(
      userId
    )})&order=completed_at.desc&limit=${limit}`
  );
  return rows.map(fromMatchRow);
}

export async function getFriendsPayload(userId: string, presenceForUser: (targetUserId: string) => PresenceStatus): Promise<FriendsPayload> {
  if (!isSupabaseConfigured()) {
    return { friends: [], incoming: [], outgoing: [] };
  }

  const [friendRows, requestRows] = await Promise.all([
    supabaseRequest<FriendshipRow[]>(`/rest/v1/friendships?select=*&user_id=eq.${encodeURIComponent(userId)}`),
    supabaseRequest<FriendRequestRow[]>(
      `/rest/v1/friend_requests?select=*&or=(from_user_id.eq.${encodeURIComponent(userId)},to_user_id.eq.${encodeURIComponent(
        userId
      )})&status=eq.pending&order=created_at.desc`
    )
  ]);

  const profileIds = [
    ...friendRows.map((row) => row.friend_user_id),
    ...requestRows.flatMap((row) => [row.from_user_id, row.to_user_id])
  ];
  const profiles = new Map((await getProfilesByIds(profileIds)).map((profile) => [profile.id, profile]));
  const profileFor = (targetUserId: string) =>
    profiles.get(targetUserId) ?? defaultProfile(targetUserId, targetUserId.slice(0, 8) || "GeoDuelist");

  const friends: FriendSummary[] = friendRows.map((row) => ({
    userId: row.friend_user_id,
    profile: publicProfileFromStored(profileFor(row.friend_user_id), presenceForUser(row.friend_user_id)),
    status: presenceForUser(row.friend_user_id),
    since: row.created_at ? Date.parse(row.created_at) : Date.now()
  }));

  const requests = requestRows.map((row) => requestSummaryFromRow(row, profileFor, presenceForUser));

  return {
    friends,
    incoming: requests.filter((request) => request.toUserId === userId),
    outgoing: requests.filter((request) => request.fromUserId === userId)
  };
}

export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<FriendRequestActionResponse> {
  if (!isSupabaseConfigured() || fromUserId === toUserId) {
    return { status: "alreadyPending", message: "Choose another player." };
  }

  const [existingFriendship, outgoingRequest, incomingRequest] = await Promise.all([
    supabaseRequest<FriendshipRow[]>(
      `/rest/v1/friendships?select=*&user_id=eq.${encodeURIComponent(fromUserId)}&friend_user_id=eq.${encodeURIComponent(toUserId)}&limit=1`
    ).catch(() => []),
    supabaseRequest<FriendRequestRow[]>(
      `/rest/v1/friend_requests?select=*&from_user_id=eq.${encodeURIComponent(fromUserId)}&to_user_id=eq.${encodeURIComponent(
        toUserId
      )}&status=eq.pending&limit=1`
    ).catch(() => []),
    supabaseRequest<FriendRequestRow[]>(
      `/rest/v1/friend_requests?select=*&from_user_id=eq.${encodeURIComponent(toUserId)}&to_user_id=eq.${encodeURIComponent(
        fromUserId
      )}&status=eq.pending&limit=1`
    ).catch(() => [])
  ]);

  if (existingFriendship.length > 0) {
    return { status: "alreadyFriends", message: "You are already friends." };
  }

  if (outgoingRequest.length > 0) {
    return { status: "alreadyPending", message: "Friend request already sent." };
  }

  if (incomingRequest.length > 0) {
    return { status: "incomingPending", message: "They already sent you a request. Check incoming requests." };
  }

  try {
    await supabaseRequest("/rest/v1/friend_requests?on_conflict=from_user_id,to_user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          from_user_id: fromUserId,
          to_user_id: toUserId,
          status: "pending",
          updated_at: new Date().toISOString()
        }
      ])
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return { status: "alreadyPending", message: "Friend request already sent." };
    }
    throw err;
  }

  return { status: "sent", message: "Friend request sent." };
}

export async function respondToFriendRequest(requestId: string, userId: string, accepted: boolean): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const rows = await supabaseRequest<FriendRequestRow[]>(
    `/rest/v1/friend_requests?select=*&id=eq.${encodeURIComponent(requestId)}&to_user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );
  const request = rows[0];
  if (!request) return;

  await supabaseRequest(`/rest/v1/friend_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: accepted ? "accepted" : "declined",
      updated_at: new Date().toISOString()
    })
  });

  if (!accepted) return;

  await supabaseRequest("/rest/v1/friendships", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([
      { user_id: request.from_user_id, friend_user_id: request.to_user_id },
      { user_id: request.to_user_id, friend_user_id: request.from_user_id }
    ])
  });
}

export async function removeFriend(userId: string, friendUserId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await Promise.all([
    supabaseRequest(
      `/rest/v1/friendships?user_id=eq.${encodeURIComponent(userId)}&friend_user_id=eq.${encodeURIComponent(friendUserId)}`,
      { method: "DELETE" }
    ),
    supabaseRequest(
      `/rest/v1/friendships?user_id=eq.${encodeURIComponent(friendUserId)}&friend_user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    )
  ]);
}

export async function recordMatch(match: StoredMatch): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("/rest/v1/matches", {
    method: "POST",
    body: JSON.stringify([
      {
        room_code: match.roomCode,
        winner_id: match.winnerId ?? null,
        loser_id: match.loserId ?? null,
        mode: match.mode,
        country_pool: match.countryPool,
        ranked: match.ranked,
        duration_ms: Math.max(0, Math.round(match.durationMs)),
        completed_at: new Date().toISOString()
      }
    ])
  });
}

export async function recordAnalyticsEvent(event: string, pathName: string, detail: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("/rest/v1/analytics_events", {
    method: "POST",
    body: JSON.stringify([
      {
        event,
        path: String(pathName).slice(0, 200),
        detail,
        created_at: new Date().toISOString()
      }
    ])
  });
}

export async function getAdminStats(activeRooms: number): Promise<AdminStats> {
  if (!isSupabaseConfigured()) {
    return {
      totalUsers: 0,
      activeUsers: 0,
      totalGamesPlayed: 0,
      activeRooms,
      rankedGames: 0,
      practiceGames: 0,
      averageGameDurationMs: 0,
      mostUsedRegions: [],
      serverHealth: "degraded"
    };
  }

  const [profiles, matches] = await Promise.all([
    supabaseRequest<SupabaseProfileRow[]>("/rest/v1/profiles?select=id,updated_at"),
    supabaseRequest<Array<{ ranked: boolean; mode: string; country_pool: string; duration_ms: number }>>(
      "/rest/v1/matches?select=ranked,mode,country_pool,duration_ms&limit=1000"
    )
  ]);

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const activeUsers = profiles.filter((profile) => Date.parse(profile.updated_at ?? "") >= oneDayAgo).length;
  const regionCounts = new Map<string, number>();
  let durationTotal = 0;

  for (const match of matches) {
    regionCounts.set(match.country_pool, (regionCounts.get(match.country_pool) ?? 0) + 1);
    durationTotal += Number(match.duration_ms) || 0;
  }

  return {
    totalUsers: profiles.length,
    activeUsers,
    totalGamesPlayed: matches.length,
    activeRooms,
    rankedGames: matches.filter((match) => match.ranked).length,
    practiceGames: matches.filter((match) => match.mode === "practice").length,
    averageGameDurationMs: matches.length > 0 ? durationTotal / matches.length : 0,
    mostUsedRegions: [...regionCounts.entries()]
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7),
    serverHealth: "ok"
  };
}

export async function getAnalyticsSummary(limit = 60): Promise<AdminAnalyticsSummary> {
  if (!isSupabaseConfigured()) {
    return {
      recentEvents: [],
      eventsByName: [],
      visitsByPath: [],
      gameStarts: 0,
      completedMatches: 0
    };
  }

  const [eventRows, matchRows] = await Promise.all([
    supabaseRequest<AnalyticsEventRow[]>(`/rest/v1/analytics_events?select=*&order=created_at.desc&limit=${limit}`),
    supabaseRequest<SupabaseMatchRow[]>("/rest/v1/matches?select=*&order=completed_at.desc&limit=1000").catch(() => [])
  ]);

  const eventsByName = new Map<string, number>();
  const visitsByPath = new Map<string, number>();

  for (const row of eventRows) {
    eventsByName.set(row.event, (eventsByName.get(row.event) ?? 0) + 1);
    if (row.event === "page_visit") {
      visitsByPath.set(row.path, (visitsByPath.get(row.path) ?? 0) + 1);
    }
  }

  return {
    recentEvents: eventRows.map((row) => ({
      id: String(row.id),
      event: row.event,
      path: row.path,
      detail: row.detail ?? {},
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    })),
    eventsByName: [...eventsByName.entries()].map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count),
    visitsByPath: [...visitsByPath.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
    gameStarts: eventRows.filter((row) => row.event === "game_start").length,
    completedMatches: matchRows.length
  };
}

export async function getActiveBan(userId: string | undefined): Promise<StoredBan | undefined> {
  if (!isSupabaseConfigured() || !userId) return undefined;
  const rows = await supabaseRequest<BanRow[]>(
    `/rest/v1/bans?select=*&user_id=eq.${encodeURIComponent(userId)}&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(
      new Date().toISOString()
    )})&limit=1`
  );
  return rows[0] ? fromBanRow(rows[0]) : undefined;
}

export async function getAdminContext(user: SupabaseUser | undefined, adminToken: string | undefined): Promise<AdminContext> {
  if (process.env.ADMIN_TOKEN && adminToken === process.env.ADMIN_TOKEN) {
    return {
      user,
      roles: ["owner"],
      permissions: ALL_ADMIN_PERMISSIONS,
      isOwner: true
    };
  }

  if (!user) {
    return { user, roles: [], permissions: [], isOwner: false };
  }

  const ownerEmails = (process.env.OWNER_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const allowedAdminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email.toLowerCase();
  const isOwner = ownerEmails.includes(email);

  if (isOwner) {
    return {
      user,
      roles: ["owner"],
      permissions: ALL_ADMIN_PERMISSIONS,
      isOwner: true
    };
  }

  const roles = new Set<AdminRole>();
  const permissions = new Set<AdminPermission>();

  if (allowedAdminEmails.includes(email)) {
    roles.add("admin");
    DEFAULT_ROLE_PERMISSIONS.admin.forEach((permission) => permissions.add(permission));
  }

  if (isSupabaseConfigured()) {
    const [roleRows, permissionRows] = await Promise.all([
      supabaseRequest<UserRoleRow[]>(`/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}`).catch(() => []),
      supabaseRequest<RolePermissionRow[]>(
        `/rest/v1/role_permissions?select=permission&user_id=eq.${encodeURIComponent(user.id)}`
      ).catch(() => [])
    ]);

    for (const row of roleRows) {
      if (!isAdminRole(row.role)) continue;
      roles.add(row.role);
      DEFAULT_ROLE_PERMISSIONS[row.role].forEach((permission) => permissions.add(permission));
    }

    for (const row of permissionRows) {
      if (isAdminPermission(row.permission)) permissions.add(row.permission);
    }
  }

  return {
    user,
    roles: [...roles],
    permissions: [...permissions],
    isOwner: false
  };
}

export async function isAdmin(user: SupabaseUser | undefined, adminToken: string | undefined): Promise<boolean> {
  const context = await getAdminContext(user, adminToken);
  return context.permissions.length > 0;
}

export function hasPermission(context: AdminContext, permission: AdminPermission): boolean {
  return context.isOwner || context.permissions.includes(permission);
}

export async function searchAdminUsers(
  query: string,
  presenceForUser: (userId: string) => PresenceStatus
): Promise<Array<{ profile: PublicProfile; roles: AdminRole[]; permissions: AdminPermission[]; banned: boolean; banReason?: string }>> {
  const clean = query.trim();
  const profiles =
    clean.length >= 2
      ? await searchPublicProfiles(clean, presenceForUser)
      : (await getLeaderboard(25)).map((profile) => publicProfileFromStored(profile, presenceForUser(profile.id)));
  const rows = await Promise.all(
    profiles.map(async (profile) => {
      const [roles, permissions, ban] = await Promise.all([getUserRoles(profile.id), getUserPermissions(profile.id), getActiveBan(profile.id)]);
      return {
        profile,
        roles,
        permissions,
        banned: Boolean(ban),
        banReason: ban?.reason
      };
    })
  );
  return rows;
}

export async function updateUserRating(
  actorUserId: string | undefined,
  targetUserId: string,
  rating: number,
  reason: string
): Promise<StoredProfile | undefined> {
  if (!isSupabaseConfigured()) return undefined;
  const profile = await getProfile(targetUserId);
  if (!profile) return undefined;

  const nextRating = Math.min(3000, Math.max(100, Math.round(rating)));
  const updatedProfile: StoredProfile = {
    ...profile,
    rating: nextRating,
    lastRatingDelta: nextRating - profile.rating,
    updatedAt: Date.now()
  };

  await upsertProfile(updatedProfile);
  await writeAuditLog(actorUserId, "elo_updated", targetUserId, {
    previousRating: profile.rating,
    nextRating,
    reason: reason.slice(0, 240) || "Admin rating adjustment"
  });
  return updatedProfile;
}

export async function setUserRoleAndPermissions(
  actorUserId: string | undefined,
  targetUserId: string,
  role: AdminRole,
  permissions: AdminPermission[]
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("/rest/v1/user_roles?on_conflict=user_id,role", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ user_id: targetUserId, role, granted_by: actorUserId ?? null }])
  });
  if (permissions.length > 0) {
    await supabaseRequest("/rest/v1/role_permissions?on_conflict=user_id,permission", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(permissions.map((permission) => ({ user_id: targetUserId, permission, granted_by: actorUserId ?? null })))
    });
  }
  await writeAuditLog(actorUserId, "role_granted", targetUserId, { role, permissions });
}

export async function removeUserRole(actorUserId: string | undefined, targetUserId: string, role: AdminRole): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(targetUserId)}&role=eq.${encodeURIComponent(role)}`, {
    method: "DELETE"
  });
  await writeAuditLog(actorUserId, "role_revoked", targetUserId, { role });
}

export async function banUser(actorUserId: string | undefined, targetUserId: string, reason: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("/rest/v1/bans?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([
      {
        user_id: targetUserId,
        reason: reason.slice(0, 240) || "No reason provided.",
        banned_by: actorUserId ?? null
      }
    ])
  });
  await writeAuditLog(actorUserId, "user_banned", targetUserId, { reason });
}

export async function unbanUser(actorUserId: string | undefined, targetUserId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest(`/rest/v1/bans?user_id=eq.${encodeURIComponent(targetUserId)}`, { method: "DELETE" });
  await writeAuditLog(actorUserId, "user_unbanned", targetUserId, {});
}

export async function writeAuditLog(
  actorUserId: string | undefined,
  action: string,
  targetUserId: string | undefined,
  detail: Record<string, unknown>
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabaseRequest("/rest/v1/audit_logs", {
    method: "POST",
    body: JSON.stringify([
      {
        actor_user_id: actorUserId ?? null,
        action,
        target_user_id: targetUserId ?? null,
        detail
      }
    ])
  });
}

export async function getAuditLogs(limit = 40): Promise<AuditLogEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await supabaseRequest<AuditLogRow[]>(`/rest/v1/audit_logs?select=*&order=created_at.desc&limit=${limit}`);
  return rows.map(fromAuditLogRow);
}

async function getUserRoles(userId: string): Promise<AdminRole[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await supabaseRequest<UserRoleRow[]>(`/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(userId)}`).catch(
    () => []
  );
  return rows.map((row) => row.role).filter(isAdminRole);
}

async function getUserPermissions(userId: string): Promise<AdminPermission[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await supabaseRequest<RolePermissionRow[]>(
    `/rest/v1/role_permissions?select=permission&user_id=eq.${encodeURIComponent(userId)}`
  ).catch(() => []);
  return rows.map((row) => row.permission).filter(isAdminPermission);
}

function isDuplicateKeyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('"code":"23505"') || message.includes("duplicate key value");
}

export function isAdminPermission(permission: unknown): permission is AdminPermission {
  return typeof permission === "string" && ALL_ADMIN_PERMISSIONS.includes(permission as AdminPermission);
}

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && ["owner", "admin", "moderator", "support"].includes(role);
}

export function publicProfileFromStored(
  profile: StoredProfile,
  presence: PresenceStatus,
  recentMatches: PublicMatchSummary[] = []
): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    rating: profile.rating,
    title: getProfileTitle(profile.rating, profile.wins),
    wins: profile.wins,
    losses: profile.losses,
    rankedWins: profile.rankedWins,
    rankedLosses: profile.rankedLosses,
    achievements: profile.achievements,
    achievementsCount: Object.keys(profile.achievements).length,
    bestAnswerStreak: profile.bestAnswerStreak,
    presence,
    recentMatches
  };
}

async function toPublicProfile(profile: StoredProfile, presence: PresenceStatus, recentMatches?: PublicMatchSummary[]): Promise<PublicProfile> {
  return publicProfileFromStored(profile, presence, recentMatches ?? (await getRecentMatches(profile.id)));
}

function requestSummaryFromRow(
  row: FriendRequestRow,
  profileFor: (userId: string) => StoredProfile,
  presenceForUser: (userId: string) => PresenceStatus
): FriendRequestSummary {
  return {
    id: String(row.id),
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    fromProfile: publicProfileFromStored(profileFor(row.from_user_id), presenceForUser(row.from_user_id)),
    toProfile: publicProfileFromStored(profileFor(row.to_user_id), presenceForUser(row.to_user_id))
  };
}

function fromMatchRow(row: SupabaseMatchRow): PublicMatchSummary {
  return {
    id: String(row.id),
    roomCode: row.room_code,
    winnerId: row.winner_id ?? undefined,
    loserId: row.loser_id ?? undefined,
    mode: isGameModeValue(row.mode) ? row.mode : "classic",
    countryPool: isCountryPoolValue(row.country_pool) ? row.country_pool : "world",
    ranked: row.ranked,
    durationMs: row.duration_ms,
    completedAt: row.completed_at ? Date.parse(row.completed_at) : Date.now()
  };
}

function fromBanRow(row: BanRow): StoredBan {
  return {
    userId: row.user_id,
    reason: row.reason,
    bannedBy: row.banned_by ?? undefined,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    expiresAt: row.expires_at ? Date.parse(row.expires_at) : undefined
  };
}

function fromAuditLogRow(row: AuditLogRow): AuditLogEntry {
  return {
    id: String(row.id),
    actorUserId: row.actor_user_id ?? "",
    action: row.action,
    targetUserId: row.target_user_id ?? undefined,
    detail: row.detail ?? {},
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
  };
}

function isGameModeValue(mode: string): mode is GameMode {
  return ["classic", "noSkip", "practice"].includes(mode);
}

function isCountryPoolValue(pool: string): pool is CountryPool {
  return ["world", "europe", "asia", "africa", "northAmerica", "southAmerica", "oceania"].includes(pool);
}

function encodePostgrestPattern(value: string): string {
  return encodeURIComponent(value.replace(/[%*]/g, "").trim());
}

export function summaryFromStoredProfile(profile: StoredProfile): PlayerProfileSummary {
  return {
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    bestStreak: profile.bestAnswerStreak,
    achievementsCount: Object.keys(profile.achievements).length,
    title: getProfileTitle(profile.rating, profile.wins)
  };
}

function defaultProfile(id: string, name: string): StoredProfile {
  return {
    id,
    name: name.slice(0, 18) || "Player",
    rating: 1000,
    wins: 0,
    losses: 0,
    rankedWins: 0,
    rankedLosses: 0,
    gamesPlayed: 0,
    totalCorrect: 0,
    totalWrong: 0,
    totalSkips: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    bestAnswerStreak: 0,
    perfectGames: 0,
    noSkipWins: 0,
    achievements: {},
    lastRatingDelta: 0,
    updatedAt: Date.now()
  };
}

function getProfileTitle(rating: number, wins: number): string {
  if (rating >= 1600) return "World Class";
  if (rating >= 1350) return "Map Shark";
  if (rating >= 1150) return "Border Runner";
  if (wins > 0) return "Rising Explorer";
  return "Unranked Explorer";
}

async function supabaseRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase is not configured.");
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

interface SupabaseProfileRow {
  id: string;
  display_name: string;
  rating: number;
  wins: number;
  losses: number;
  ranked_wins: number;
  ranked_losses: number;
  games_played: number;
  total_correct: number;
  total_wrong: number;
  total_skips: number;
  current_win_streak: number;
  best_win_streak: number;
  best_answer_streak: number;
  perfect_games: number;
  no_skip_wins: number;
  achievements: Record<string, number> | null;
  last_rating_delta: number;
  updated_at?: string;
}

interface SupabaseMatchRow {
  id: number;
  room_code: string;
  winner_id: string | null;
  loser_id: string | null;
  mode: string;
  country_pool: string;
  ranked: boolean;
  duration_ms: number;
  completed_at?: string;
}

interface FriendshipRow {
  user_id: string;
  friend_user_id: string;
  created_at?: string;
}

interface FriendRequestRow {
  id: number;
  from_user_id: string;
  to_user_id: string;
  status: "pending" | "accepted" | "declined";
  created_at?: string;
}

interface UserRoleRow {
  role: string;
}

interface RolePermissionRow {
  permission: string;
}

interface BanRow {
  user_id: string;
  reason: string;
  banned_by: string | null;
  created_at?: string;
  expires_at?: string | null;
}

interface AuditLogRow {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_user_id: string | null;
  detail: Record<string, unknown> | null;
  created_at?: string;
}

interface AnalyticsEventRow {
  id: number;
  event: string;
  path: string;
  detail: Record<string, unknown> | null;
  created_at?: string;
}

function fromProfileRow(row: SupabaseProfileRow): StoredProfile {
  return {
    id: row.id,
    name: row.display_name,
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
    rankedWins: row.ranked_wins,
    rankedLosses: row.ranked_losses,
    gamesPlayed: row.games_played,
    totalCorrect: row.total_correct,
    totalWrong: row.total_wrong,
    totalSkips: row.total_skips,
    currentWinStreak: row.current_win_streak,
    bestWinStreak: row.best_win_streak,
    bestAnswerStreak: row.best_answer_streak,
    perfectGames: row.perfect_games,
    noSkipWins: row.no_skip_wins,
    achievements: row.achievements ?? {},
    lastRatingDelta: row.last_rating_delta,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now()
  };
}

function toProfileRow(profile: StoredProfile): SupabaseProfileRow {
  return {
    id: profile.id,
    display_name: profile.name,
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    ranked_wins: profile.rankedWins,
    ranked_losses: profile.rankedLosses,
    games_played: profile.gamesPlayed,
    total_correct: profile.totalCorrect,
    total_wrong: profile.totalWrong,
    total_skips: profile.totalSkips,
    current_win_streak: profile.currentWinStreak,
    best_win_streak: profile.bestWinStreak,
    best_answer_streak: profile.bestAnswerStreak,
    perfect_games: profile.perfectGames,
    no_skip_wins: profile.noSkipWins,
    achievements: profile.achievements,
    last_rating_delta: profile.lastRatingDelta,
    updated_at: new Date(profile.updatedAt).toISOString()
  };
}
