import cors from "cors";
import express, { type Request } from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { COUNTRIES, type CountryQuestion } from "../../shared/countries.js";
import type {
  ActionAck,
  ClientToServerEvents,
  CreateRoomPayload,
  GameNotice,
  GamePhase,
  GameSettings,
  GameStatus,
  InterServerEvents,
  JoinRoomPayload,
  LeaveRoomAck,
  MatchType,
  PlayerStats,
  PlayerProfileSummary,
  PresenceStatus,
  ProfileUpdatePayload,
  PublicGameState,
  PublicPlayer,
  ReconnectRoomPayload,
  RevealState,
  RoomActionPayload,
  RoomAck,
  RoundHistoryEntry,
  ServerToClientEvents,
  SocketData,
  SubmitAnswerPayload
} from "../../shared/types.js";
import { isAnswerCorrect } from "./answer.js";
import {
  banUser,
  getAdminStats,
  getActiveBan,
  getAdminContext,
  getAuditLogs,
  getLeaderboard,
  getOrCreateProfile,
  getProfile,
  getPublicProfileById,
  getFriendsPayload,
  hasPermission,
  isAdminPermission,
  isAdminRole,
  recordAnalyticsEvent,
  recordMatch,
  removeFriend,
  removeUserRole,
  respondToFriendRequest,
  searchAdminUsers,
  searchPublicProfiles,
  sendFriendRequest,
  setUserRoleAndPermissions,
  summaryFromStoredProfile,
  unbanUser,
  upsertProfile,
  verifyAuthToken,
  writeAuditLog,
  type StoredProfile
} from "./supabase.js";

const DEFAULT_SETTINGS: GameSettings = {
  mode: "classic",
  timerSeconds: 180,
  skipPenaltySeconds: 10,
  wrongPenaltySeconds: 0,
  mapMode: "context",
  countryPool: "world",
  aliasesEnabled: true,
  soundEnabled: true,
  rankedEnabled: true,
  forgivingSpellingEnabled: true,
  showCountryMenuEnabled: false,
  roundsToWin: 1
};

const RANKED_SETTINGS: GameSettings = {
  mode: "classic",
  timerSeconds: 180,
  skipPenaltySeconds: 10,
  wrongPenaltySeconds: 3,
  mapMode: "context",
  countryPool: "world",
  aliasesEnabled: true,
  soundEnabled: true,
  rankedEnabled: true,
  forgivingSpellingEnabled: true,
  showCountryMenuEnabled: false,
  roundsToWin: 2
};

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const TICK_RATE_MS = 400;
const NOTICE_MS = 2200;
const REVEAL_DELAY_MS = 1500;
const ROUND_DELAY_MS = 2600;
const RECONNECT_GRACE_MS = 30_000;
const MAX_HISTORY = 28;

interface InternalPlayer extends PublicPlayer {
  socketId: string;
}

interface InternalRoom {
  roomCode: string;
  matchType: MatchType;
  players: InternalPlayer[];
  status: GameStatus;
  phase: GamePhase;
  settings: GameSettings;
  activePlayerId?: string;
  timers: Record<string, number>;
  scores: Record<string, number>;
  stats: Record<string, PlayerStats>;
  streaks: Record<string, number>;
  currentCountry?: CountryQuestion;
  deck: CountryQuestion[];
  usedCountryIds: string[];
  roundNumber: number;
  turnNumber: number;
  lastTickAt: number;
  turnStartedAt: number;
  history: RoundHistoryEntry[];
  lastNotice?: GameNotice;
  reveal?: RevealState;
  currentTurnStartedAt: number;
  currentWrongGuesses: number;
  currentTurnPenaltyMs: number;
  winnerId?: string;
  loserId?: string;
  matchWinnerId?: string;
  matchLoserId?: string;
  rankedFinalized?: boolean;
  createdAt: number;
  revealTimeout?: NodeJS.Timeout;
  disconnectTimeout?: NodeJS.Timeout;
}

interface RankedQueueEntry {
  userId: string;
  socketId: string;
  playerName: string;
  profile: PlayerProfileSummary;
  queuedAt: number;
}

const rooms = new Map<string, InternalRoom>();
const rankedQueue = new Map<string, RankedQueueEntry>();
const presence = new Map<string, { status: PresenceStatus; roomCode?: string; updatedAt: number }>();
const DEFAULT_ALLOWED_ORIGINS = ["https://geo-duel.vercel.app", "http://localhost:5173"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

const configuredOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins].map(normalizeOrigin).filter(Boolean))];
const corsOrigin: cors.CorsOptions["origin"] =
  allowedOrigins.length > 0
    ? (origin, callback) => {
        const normalizedOrigin = normalizeOrigin(origin);
        if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked origin ${origin}. Set CLIENT_ORIGIN=${normalizedOrigin} on the backend.`));
      }
    : true;

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);
app.options("*", cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, title: "GeoDuel" });
});

app.get("/api/me", async (req, res) => {
  const user = await verifyAuthToken(getBearerToken(req.headers.authorization));
  if (!user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  const profile = await getOrCreateProfile(user, "GeoDuelist");
  res.json(toClientProfile(profile));
});

app.put("/api/me", async (req, res) => {
  const user = await verifyAuthToken(getBearerToken(req.headers.authorization));
  if (!user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  const body = req.body as Partial<StoredProfile>;
  const profile: StoredProfile = {
    id: user.id,
    name: sanitizePlayerName(body.name, "GeoDuelist"),
    rating: clampInteger(body.rating, 100, 3000, 1000),
    wins: clampInteger(body.wins, 0, 99999, 0),
    losses: clampInteger(body.losses, 0, 99999, 0),
    rankedWins: clampInteger(body.rankedWins, 0, 99999, 0),
    rankedLosses: clampInteger(body.rankedLosses, 0, 99999, 0),
    gamesPlayed: clampInteger(body.gamesPlayed, 0, 99999, 0),
    totalCorrect: clampInteger(body.totalCorrect, 0, 999999, 0),
    totalWrong: clampInteger(body.totalWrong, 0, 999999, 0),
    totalSkips: clampInteger(body.totalSkips, 0, 999999, 0),
    currentWinStreak: clampInteger(body.currentWinStreak, 0, 9999, 0),
    bestWinStreak: clampInteger(body.bestWinStreak, 0, 9999, 0),
    bestAnswerStreak: clampInteger(body.bestAnswerStreak, 0, 9999, 0),
    perfectGames: clampInteger(body.perfectGames, 0, 99999, 0),
    noSkipWins: clampInteger(body.noSkipWins, 0, 99999, 0),
    achievements: typeof body.achievements === "object" && body.achievements ? (body.achievements as Record<string, number>) : {},
    lastRatingDelta: clampInteger(body.lastRatingDelta, -1000, 1000, 0),
    updatedAt: Date.now()
  };

  await upsertProfile(profile);
  res.json(toClientProfile(profile));
});

app.get("/api/leaderboard", async (_req, res) => {
  const rows = await getLeaderboard();
  res.json(
    rows.map((profile, index) => ({
      id: profile.id,
      name: profile.name,
      rating: profile.rating,
      wins: profile.wins,
      losses: profile.losses,
      bestStreak: profile.bestAnswerStreak,
      achievementsCount: Object.keys(profile.achievements).length,
      title: summaryFromStoredProfile(profile).title,
      observedAt: Date.now() - index
    }))
  );
});

app.get("/api/users/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  res.json(await searchPublicProfiles(query, presenceStatusFor));
});

app.get("/api/users/:userId", async (req, res) => {
  const profile = await getPublicProfileById(req.params.userId, presenceStatusFor(req.params.userId));
  if (!profile) {
    res.status(404).json({ message: "User not found." });
    return;
  }
  res.json(profile);
});

app.get("/api/friends", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Authentication required." });
  res.json(await getFriendsPayload(user.id, presenceStatusFor));
});

app.post("/api/friends/request", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Authentication required." });
  const targetUserId = sanitizeUserId(req.body?.targetUserId);
  if (!targetUserId || targetUserId === user.id) {
    res.status(400).json({ message: "Choose another player." });
    return;
  }
  await sendFriendRequest(user.id, targetUserId);
  res.status(204).end();
});

app.post("/api/friends/requests/:requestId/accept", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Authentication required." });
  await respondToFriendRequest(req.params.requestId, user.id, true);
  res.status(204).end();
});

app.post("/api/friends/requests/:requestId/decline", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Authentication required." });
  await respondToFriendRequest(req.params.requestId, user.id, false);
  res.status(204).end();
});

app.delete("/api/friends/:friendUserId", async (req, res) => {
  const user = await getRequestUser(req);
  if (!user) return res.status(401).json({ message: "Authentication required." });
  await removeFriend(user.id, req.params.friendUserId);
  res.status(204).end();
});

app.post("/api/matches", async (req, res) => {
  const user = await verifyAuthToken(getBearerToken(req.headers.authorization));
  if (!user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  const body = req.body as {
    roomCode?: string;
    mode?: GameSettings["mode"];
    countryPool?: GameSettings["countryPool"];
    durationMs?: number;
    result?: {
      profile?: StoredProfile;
      ranked?: boolean;
      won?: boolean;
      lost?: boolean;
    };
  };

  if (body.result?.profile) {
    await upsertProfile({ ...body.result.profile, id: user.id, updatedAt: Date.now() });
  }

  await recordMatch({
    roomCode: String(body.roomCode ?? "unknown").slice(0, 16),
    winnerId: body.result?.won ? user.id : undefined,
    loserId: body.result?.lost ? user.id : undefined,
    mode: isGameMode(body.mode) ? body.mode : "classic",
    countryPool: isCountryPool(body.countryPool) ? body.countryPool : "world",
    ranked: false,
    durationMs: Number(body.durationMs) || 0
  });

  res.status(204).end();
});

app.post("/api/analytics", async (req, res) => {
  const body = req.body as { event?: string; path?: string; detail?: unknown };
  await recordAnalyticsEvent(String(body.event ?? "unknown").slice(0, 80), String(body.path ?? "/").slice(0, 200), body.detail ?? {});
  res.status(204).end();
});

app.get("/api/admin/stats", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));

  if (!hasPermission(context, "view_analytics")) {
    res.status(403).json({ message: "Admin access required." });
    return;
  }

  res.json(await getAdminStats(rooms.size));
});

app.get("/api/admin/users", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "view_users")) {
    res.status(403).json({ message: "Missing view users permission." });
    return;
  }
  res.json(await searchAdminUsers(String(req.query.q ?? ""), presenceStatusFor));
});

app.get("/api/admin/audit", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "view_analytics")) {
    res.status(403).json({ message: "Missing audit permission." });
    return;
  }
  res.json(await getAuditLogs());
});

app.post("/api/admin/ban", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "ban_users")) {
    res.status(403).json({ message: "Missing ban permission." });
    return;
  }
  const targetUserId = sanitizeUserId(req.body?.userId);
  if (!targetUserId) return res.status(400).json({ message: "Target user is required." });
  await banUser(context.user?.id, targetUserId, String(req.body?.reason ?? "No reason provided."));
  res.status(204).end();
});

app.post("/api/admin/unban", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "unban_users")) {
    res.status(403).json({ message: "Missing unban permission." });
    return;
  }
  const targetUserId = sanitizeUserId(req.body?.userId);
  if (!targetUserId) return res.status(400).json({ message: "Target user is required." });
  await unbanUser(context.user?.id, targetUserId);
  res.status(204).end();
});

app.post("/api/admin/roles", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "grant_roles")) {
    res.status(403).json({ message: "Missing grant roles permission." });
    return;
  }
  const targetUserId = sanitizeUserId(req.body?.userId);
  const role = req.body?.role;
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.filter(isAdminPermission) : [];
  if (!targetUserId || !isAdminRole(role)) return res.status(400).json({ message: "User and valid role are required." });
  await setUserRoleAndPermissions(context.user?.id, targetUserId, role, permissions);
  res.status(204).end();
});

app.delete("/api/admin/roles/:userId/:role", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "revoke_roles")) {
    res.status(403).json({ message: "Missing revoke roles permission." });
    return;
  }
  if (!isAdminRole(req.params.role)) return res.status(400).json({ message: "Invalid role." });
  await removeUserRole(context.user?.id, req.params.userId, req.params.role);
  res.status(204).end();
});

app.post("/api/admin/rooms/:roomCode/kick", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "kick_players")) {
    res.status(403).json({ message: "Missing kick permission." });
    return;
  }
  const room = rooms.get(req.params.roomCode.toUpperCase());
  const targetUserId = sanitizeUserId(req.body?.userId);
  if (!room || !targetUserId) return res.status(404).json({ message: "Room or player not found." });
  finishMatchByLeave(room, targetUserId, "A moderator removed a player from this match.");
  await writeAuditLog(context.user?.id, "player_kicked", targetUserId, { roomCode: room.roomCode });
  emitRoom(room);
  res.status(204).end();
});

app.post("/api/admin/rooms/:roomCode/end", async (req, res) => {
  const context = await getAdminContext(await getRequestUser(req), getAdminToken(req));
  if (!hasPermission(context, "force_end_games")) {
    res.status(403).json({ message: "Missing force-end permission." });
    return;
  }
  const room = rooms.get(req.params.roomCode.toUpperCase());
  if (!room) return res.status(404).json({ message: "Room not found." });
  forceEndRoom(room, "A moderator ended this game.");
  await writeAuditLog(context.user?.id, "game_force_ended", undefined, { roomCode: room.roomCode });
  emitRoom(room);
  res.status(204).end();
});

const clientDist = path.resolve(__dirname, "../../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: true
  }
});

io.on("connection", (socket) => {
  socket.on("room:create", async (payload, ack) => {
    const gate = await authorizePlayRequest(payload, payload.settings.mode);
    if (!gate.ok) {
      ack({ ok: false, message: gate.message });
      return;
    }

    socket.data.authUserId = gate.user?.id;
    removeFromRankedQueue(socket);
    const result = createRoom(socket.id, payload, "unranked", gate.profile);
    attachSocketToRoom(socket, result.room.roomCode, result.playerId);
    setPresence(result.playerId, result.room.settings.mode === "practice" ? "inGame" : "online", result.room.roomCode);
    ack({ ok: true, playerId: result.playerId, state: toPublicState(result.room) });
    emitRoom(result.room);
  });

  socket.on("room:join", async (payload, ack) => {
    const gate = await authorizePlayRequest(payload, "classic");
    if (!gate.ok) {
      ack({ ok: false, message: gate.message });
      return;
    }

    socket.data.authUserId = gate.user?.id;
    removeFromRankedQueue(socket);
    const response = joinRoom(socket.id, payload, gate.profile);
    if (!response.ok) {
      ack(response);
      return;
    }

    attachSocketToRoom(socket, response.room.roomCode, response.playerId);
    setPresence(response.playerId, "online", response.room.roomCode);
    ack({ ok: true, playerId: response.playerId, state: toPublicState(response.room) });
    emitRoom(response.room);
  });

  socket.on("room:reconnect", async (payload, ack) => {
    const response = await reconnectRoom(socket.id, payload);
    if (!response.ok) {
      ack(response);
      return;
    }

    attachSocketToRoom(socket, response.room.roomCode, response.playerId);
    socket.data.authUserId = response.playerId;
    setPresence(response.playerId, response.room.status === "playing" ? "inGame" : "online", response.room.roomCode);
    ack({ ok: true, playerId: response.playerId, state: toPublicState(response.room) });
    emitRoom(response.room);
  });

  socket.on("ranked:join", async (payload, ack) => {
    const gate = await authorizePlayRequest(payload, "classic", true);
    if (!gate.ok || !gate.user || !gate.profile) {
      ack({ ok: false, message: gate.ok ? "Sign in to play ranked matchmaking." : gate.message });
      return;
    }

    if (rankedQueue.has(gate.user.id)) {
      const existing = rankedQueue.get(gate.user.id)!;
      ack({ ok: true, status: "queued", queuedAt: existing.queuedAt });
      return;
    }

    socket.data.authUserId = gate.user.id;
    socket.data.playerId = gate.user.id;
    socket.data.roomCode = undefined;

    const entry: RankedQueueEntry = {
      userId: gate.user.id,
      socketId: socket.id,
      playerName: sanitizePlayerName(payload.playerName, gate.profile.name),
      profile: summaryFromStoredProfile(gate.profile),
      queuedAt: Date.now()
    };
    rankedQueue.set(entry.userId, entry);
    setPresence(entry.userId, "queue");

    const matched = matchRankedQueue(entry);
    if (matched) {
      ack({ ok: true, status: "matched", playerId: entry.userId, state: toPublicState(matched) });
      return;
    }

    socket.emit("ranked:queue", { status: "queued", queuedAt: entry.queuedAt });
    ack({ ok: true, status: "queued", queuedAt: entry.queuedAt });
  });

  socket.on("ranked:cancel", (ack) => {
    removeFromRankedQueue(socket);
    ack({ ok: true });
  });

  socket.on("game:start", (payload, ack) => {
    const room = requireRoom(payload, ack);
    if (!room) return;
    if (!isHost(room, socket.data.playerId)) {
      fail(ack, "Only the host can start the match.");
      return;
    }
    const started = startMatch(room);
    if (!started.ok) {
      fail(ack, started.message);
      return;
    }
    successAndBroadcast(room, ack);
  });

  socket.on("game:restart", (payload, ack) => {
    const room = requireRoom(payload, ack);
    if (!room) return;
    if (room.matchType === "ranked") {
      fail(ack, "Ranked rematches must go through matchmaking.");
      return;
    }
    const restarted = startMatch(room);
    if (!restarted.ok) {
      fail(ack, restarted.message);
      return;
    }
    successAndBroadcast(room, ack);
  });

  socket.on("room:leave", (payload, ack) => {
    leaveRoom(socket, payload, ack);
  });

  socket.on("answer:submit", (payload, ack) => {
    const room = requireRoom(payload, ack);
    if (!room) return;
    handleAnswer(room, socket.data.playerId, payload, ack);
  });

  socket.on("turn:skip", (payload, ack) => {
    const room = requireRoom(payload, ack);
    if (!room) return;
    handleSkip(room, socket.data.playerId, ack);
  });

  socket.on("profile:update", (payload, ack) => {
    const room = requireRoom(payload, ack);
    if (!room) return;
    updatePlayerProfile(room, socket.data.playerId, payload, ack);
  });

  socket.on("disconnect", () => {
    removeFromRankedQueue(socket, false);
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) {
      if (socket.data.authUserId) setPresence(socket.data.authUserId, "offline");
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player || player.socketId !== socket.id) return;

    player.isConnected = false;
    setPresence(playerId, "offline", roomCode);

    if (room.status === "lobby") {
      removePlayerFromLobby(room, playerId, "Opponent left the room.");
      emitRoom(room);
      return;
    }

    if (room.status === "playing" && room.settings.mode !== "practice") {
      commitActiveTimer(room);
      room.phase = "paused";
      room.lastNotice = makeNotice("info", `${player.name} disconnected. Timers are paused briefly for reconnect.`, {
        playerId
      });
      clearDisconnectTimeout(room);
      room.disconnectTimeout = setTimeout(() => {
        const staleRoom = rooms.get(roomCode);
        if (!staleRoom) return;
        const stalePlayer = staleRoom.players.find((candidate) => candidate.id === playerId);
        if (!stalePlayer || stalePlayer.isConnected || staleRoom.status !== "playing") return;
        finishMatchByLeave(staleRoom, playerId, `${stalePlayer.name} left the match.`);
        emitRoom(staleRoom);
      }, RECONNECT_GRACE_MS);
    }

    emitRoom(room);

    setTimeout(() => {
      const staleRoom = rooms.get(roomCode);
      if (staleRoom && staleRoom.players.every((candidate) => !candidate.isConnected)) {
        clearRoomTimeout(staleRoom);
        clearDisconnectTimeout(staleRoom);
        rooms.delete(roomCode);
      }
    }, 10 * 60_000);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    let shouldEmit = false;

    if (room.lastNotice && room.lastNotice.expiresAt <= now) {
      room.lastNotice = undefined;
      shouldEmit = true;
    }

    if (room.status === "playing" && room.phase === "guessing" && room.activePlayerId) {
      shouldEmit = true;
      if (getTimer(room, room.activePlayerId, now) <= 0) {
        room.timers[room.activePlayerId] = 0;
        endRound(room, room.activePlayerId, "Time ran out.");
      }
    }

    if (shouldEmit) {
      emitRoom(room, now);
    }
  }
}, TICK_RATE_MS);

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  console.log(`GeoDuel server running on http://localhost:${port}`);
});

async function authorizePlayRequest(
  payload: { authToken?: string; playerName?: string; profile?: PlayerProfileSummary },
  mode: GameSettings["mode"],
  requireAuth = false
): Promise<{ ok: true; user?: Awaited<ReturnType<typeof verifyAuthToken>>; profile?: StoredProfile } | { ok: false; message: string }> {
  if (!payload.authToken && (requireAuth || mode !== "practice")) {
    return { ok: false, message: "Sign in to play online matches." };
  }

  if (!payload.authToken) {
    return { ok: true };
  }

  const user = await verifyAuthToken(payload.authToken);
  if (!user) {
    return { ok: false, message: "Your session expired. Sign in again." };
  }

  const ban = await getActiveBan(user.id);
  if (ban) {
    return { ok: false, message: `This account is banned: ${ban.reason}` };
  }

  const profile = await getOrCreateProfile(user, sanitizePlayerName(payload.playerName, "GeoDuelist"));
  return { ok: true, user, profile };
}

function matchRankedQueue(entry: RankedQueueEntry): InternalRoom | undefined {
  for (const opponent of rankedQueue.values()) {
    if (opponent.userId === entry.userId) continue;
    const opponentSocket = io.sockets.sockets.get(opponent.socketId);
    const currentSocket = io.sockets.sockets.get(entry.socketId);
    if (!opponentSocket) {
      rankedQueue.delete(opponent.userId);
      setPresence(opponent.userId, "offline");
      continue;
    }
    if (!currentSocket) {
      rankedQueue.delete(entry.userId);
      setPresence(entry.userId, "offline");
      return undefined;
    }

    rankedQueue.delete(opponent.userId);
    rankedQueue.delete(entry.userId);
    const room = createRankedRoom(opponent, entry);
    rooms.set(room.roomCode, room);

    attachSocketToRoom(opponentSocket, room.roomCode, opponent.userId);
    attachSocketToRoom(currentSocket, room.roomCode, entry.userId);
    opponentSocket.data.authUserId = opponent.userId;
    currentSocket.data.authUserId = entry.userId;

    startMatch(room);
    const state = toPublicState(room);
    opponentSocket.emit("ranked:matched", { playerId: opponent.userId, state });
    currentSocket.emit("ranked:matched", { playerId: entry.userId, state });
    emitRoom(room);
    return room;
  }

  return undefined;
}

function createRankedRoom(playerOne: RankedQueueEntry, playerTwo: RankedQueueEntry): InternalRoom {
  const now = Date.now();
  const players: InternalPlayer[] = [
    {
      id: playerOne.userId,
      socketId: playerOne.socketId,
      name: playerOne.playerName,
      isHost: true,
      isConnected: true,
      ...playerOne.profile
    },
    {
      id: playerTwo.userId,
      socketId: playerTwo.socketId,
      name: playerTwo.playerName,
      isHost: false,
      isConnected: true,
      ...playerTwo.profile
    }
  ];

  return {
    roomCode: generateRoomCode(),
    matchType: "ranked",
    players,
    status: "lobby",
    phase: "waiting",
    settings: RANKED_SETTINGS,
    timers: Object.fromEntries(players.map((player) => [player.id, RANKED_SETTINGS.timerSeconds * 1000])),
    scores: Object.fromEntries(players.map((player) => [player.id, 0])),
    stats: Object.fromEntries(players.map((player) => [player.id, emptyStats()])),
    streaks: Object.fromEntries(players.map((player) => [player.id, 0])),
    deck: [],
    usedCountryIds: [],
    roundNumber: 1,
    turnNumber: 0,
    lastTickAt: now,
    turnStartedAt: now,
    currentTurnStartedAt: now,
    currentWrongGuesses: 0,
    currentTurnPenaltyMs: 0,
    history: [],
    createdAt: now
  };
}

function removeFromRankedQueue(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, notify = true) {
  const userId = socket.data.authUserId ?? socket.data.playerId;
  if (!userId || !rankedQueue.has(userId)) return;
  rankedQueue.delete(userId);
  setPresence(userId, "online");
  if (notify) socket.emit("ranked:queue", { status: "cancelled" });
}

async function finalizeRankedMatch(room: InternalRoom) {
  if (room.matchType !== "ranked" || room.rankedFinalized || !room.matchWinnerId || !room.matchLoserId) return;
  room.rankedFinalized = true;

  const winnerPlayer = room.players.find((player) => player.id === room.matchWinnerId);
  const loserPlayer = room.players.find((player) => player.id === room.matchLoserId);
  if (!winnerPlayer || !loserPlayer) return;

  const winnerProfile = (await getProfile(winnerPlayer.id)) ?? profileFromPublicPlayer(winnerPlayer);
  const loserProfile = (await getProfile(loserPlayer.id)) ?? profileFromPublicPlayer(loserPlayer);
  const winnerDelta = calculateEloDelta(winnerProfile.rating, loserProfile.rating, 1);
  const loserDelta = calculateEloDelta(loserProfile.rating, winnerProfile.rating, 0);

  applyServerMatchProgress(winnerProfile, room, winnerPlayer.id, true, winnerDelta);
  applyServerMatchProgress(loserProfile, room, loserPlayer.id, false, loserDelta);

  await Promise.all([upsertProfile(winnerProfile), upsertProfile(loserProfile)]);
  await recordMatch({
    roomCode: room.roomCode,
    winnerId: winnerPlayer.id,
    loserId: loserPlayer.id,
    mode: room.settings.mode,
    countryPool: room.settings.countryPool,
    ranked: true,
    durationMs: Date.now() - room.createdAt
  });
}

function applyServerMatchProgress(profile: StoredProfile, room: InternalRoom, playerId: string, won: boolean, ratingDelta: number) {
  const stats = room.stats[playerId];
  profile.gamesPlayed += 1;
  profile.totalCorrect += stats?.correct ?? 0;
  profile.totalWrong += stats?.wrong ?? 0;
  profile.totalSkips += stats?.skips ?? 0;
  profile.bestAnswerStreak = Math.max(profile.bestAnswerStreak, stats?.bestStreak ?? 0);
  profile.rating = Math.max(100, profile.rating + ratingDelta);
  profile.lastRatingDelta = ratingDelta;
  if (won) {
    profile.wins += 1;
    profile.rankedWins += 1;
    profile.currentWinStreak += 1;
    profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.currentWinStreak);
  } else {
    profile.losses += 1;
    profile.rankedLosses += 1;
    profile.currentWinStreak = 0;
  }
  profile.updatedAt = Date.now();
}

function calculateEloDelta(playerRating: number, opponentRating: number, score: 0 | 1): number {
  const expected = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
  return Math.round(32 * (score - expected));
}

function profileFromPublicPlayer(player: PublicPlayer): StoredProfile {
  return {
    id: player.id,
    name: player.name,
    rating: player.rating,
    wins: player.wins,
    losses: player.losses,
    rankedWins: 0,
    rankedLosses: 0,
    gamesPlayed: player.wins + player.losses,
    totalCorrect: 0,
    totalWrong: 0,
    totalSkips: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    bestAnswerStreak: player.bestStreak,
    perfectGames: 0,
    noSkipWins: 0,
    achievements: {},
    lastRatingDelta: 0,
    updatedAt: Date.now()
  };
}

function createRoom(
  socketId: string,
  payload: CreateRoomPayload,
  matchType: MatchType = "unranked",
  storedProfile?: StoredProfile
): { room: InternalRoom; playerId: string } {
  const roomCode = generateRoomCode();
  const playerId = storedProfile?.id ?? sanitizeClientId(payload.clientId);
  const settings = matchType === "ranked" ? RANKED_SETTINGS : sanitizeSettings(payload.settings, matchType);
  const profileSummary = storedProfile ? summaryFromStoredProfile(storedProfile) : sanitizeProfile(payload.profile);
  const room: InternalRoom = {
    roomCode,
    matchType,
    players: [
      {
        id: playerId,
        socketId,
        name: sanitizePlayerName(payload.playerName, storedProfile?.name ?? "Player 1"),
        isHost: true,
        isConnected: true,
        ...profileSummary
      }
    ],
    status: "lobby",
    phase: "waiting",
    settings,
    timers: {},
    scores: { [playerId]: 0 },
    stats: { [playerId]: emptyStats() },
    streaks: { [playerId]: 0 },
    deck: [],
    usedCountryIds: [],
    roundNumber: 1,
    turnNumber: 0,
    lastTickAt: Date.now(),
    turnStartedAt: Date.now(),
    currentTurnStartedAt: Date.now(),
    currentWrongGuesses: 0,
    currentTurnPenaltyMs: 0,
    history: [],
    createdAt: Date.now()
  };

  rooms.set(roomCode, room);
  return { room, playerId };
}

function joinRoom(
  socketId: string,
  payload: JoinRoomPayload,
  storedProfile?: StoredProfile
): { ok: true; room: InternalRoom; playerId: string } | { ok: false; message: string } {
  const roomCode = payload.roomCode.trim().toUpperCase();
  const room = rooms.get(roomCode);
  const playerId = storedProfile?.id ?? sanitizeClientId(payload.clientId);

  if (!room) {
    return { ok: false, message: "Room not found." };
  }

  if (room.matchType === "ranked") {
    return { ok: false, message: "Ranked matches are created by matchmaking and cannot be joined by room code." };
  }

  const existingPlayer = room.players.find((player) => player.id === playerId);
  if (existingPlayer) {
    existingPlayer.socketId = socketId;
    existingPlayer.isConnected = true;
    existingPlayer.name = sanitizePlayerName(payload.playerName, storedProfile?.name ?? existingPlayer.name);
    Object.assign(existingPlayer, storedProfile ? summaryFromStoredProfile(storedProfile) : sanitizeProfile(payload.profile));
    maybeResumeAfterReconnect(room);
    return { ok: true, room, playerId };
  }

  if (room.players.length >= 2) {
    return { ok: false, message: "That room already has two players." };
  }

  if (room.status !== "lobby") {
    return { ok: false, message: "That game has already started." };
  }

  room.players.push({
    id: playerId,
    socketId,
    name: sanitizePlayerName(payload.playerName, storedProfile?.name ?? `Player ${room.players.length + 1}`),
    isHost: false,
    isConnected: true,
    ...(storedProfile ? summaryFromStoredProfile(storedProfile) : sanitizeProfile(payload.profile))
  });
  ensurePlayerRecords(room, playerId);

  return { ok: true, room, playerId };
}

async function reconnectRoom(
  socketId: string,
  payload: ReconnectRoomPayload
): Promise<{ ok: true; room: InternalRoom; playerId: string } | { ok: false; message: string }> {
  const room = rooms.get(payload.roomCode.trim().toUpperCase());
  const user = await verifyAuthToken(payload.authToken);
  const playerId = user?.id ?? sanitizeClientId(payload.clientId);

  if (!room) {
    return { ok: false, message: "Room no longer exists." };
  }

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return { ok: false, message: "This browser is not a player in that room." };
  }

  const ban = await getActiveBan(playerId);
  if (ban) {
    return { ok: false, message: `This account is banned: ${ban.reason}` };
  }

  player.socketId = socketId;
  player.isConnected = true;
  player.name = sanitizePlayerName(payload.playerName, player.name);
  Object.assign(player, sanitizeProfile(payload.profile));
  clearDisconnectTimeout(room);
  maybeResumeAfterReconnect(room);

  return { ok: true, room, playerId };
}

function leaveRoom(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  payload: RoomActionPayload,
  ack: (response: LeaveRoomAck) => void
) {
  const roomCode = payload.roomCode.trim().toUpperCase();
  const room = rooms.get(roomCode);
  const playerId = socket.data.playerId;

  socket.leave(roomCode);
  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;

  if (!room || !playerId) {
    ack({ ok: true });
    return;
  }

  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    ack({ ok: true });
    return;
  }

  const leavingPlayer = room.players[playerIndex];

  if (room.status === "playing" && room.settings.mode !== "practice") {
    finishMatchByLeave(room, playerId, `${leavingPlayer.name} left the match.`);

    const state = toPublicState(room);
    ack({ ok: true, state });
    io.to(room.roomCode).emit("room:state", state);
    return;
  }

  removePlayerFromLobby(room, playerId, "Opponent left the room.");
  if (!rooms.has(roomCode)) {
    ack({ ok: true });
    return;
  }

  const state = toPublicState(room);
  ack({ ok: true, state });
  io.to(room.roomCode).emit("room:state", state);
}

function removePlayerFromLobby(room: InternalRoom, playerId: string, notice: string) {
  const roomCode = room.roomCode;
  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) return;

  room.players.splice(playerIndex, 1);
  delete room.timers[playerId];
  delete room.scores[playerId];
  delete room.stats[playerId];
  delete room.streaks[playerId];
  room.phase = "waiting";

  if (room.players.length === 0 || room.settings.mode === "practice") {
    clearRoomTimeout(room);
    clearDisconnectTimeout(room);
    rooms.delete(roomCode);
    return;
  }

  if (!room.players.some((player) => player.isHost)) {
    room.players[0].isHost = true;
  }

  room.lastNotice = makeNotice("info", notice);
}

function finishMatchByLeave(room: InternalRoom, leavingPlayerId: string, message: string) {
  commitActiveTimer(room);
  clearRoomTimeout(room);
  clearDisconnectTimeout(room);

  const leavingPlayer = room.players.find((player) => player.id === leavingPlayerId);
  const winner = room.players.find((player) => player.id !== leavingPlayerId);

  room.status = "gameOver";
  room.phase = "waiting";
  room.activePlayerId = undefined;
  room.loserId = leavingPlayerId;
  room.matchLoserId = leavingPlayerId;
  room.winnerId = winner?.id;
  room.matchWinnerId = winner?.id;
  room.timers[leavingPlayerId] = 0;
  room.reveal = undefined;

  if (leavingPlayer) {
    leavingPlayer.isConnected = false;
  }

  room.lastNotice = makeNotice("danger", message, {
    playerId: leavingPlayerId
  });
  for (const player of room.players) {
    setPresence(player.id, player.id === leavingPlayerId ? "offline" : "online");
  }
  void finalizeRankedMatch(room);
}

function startMatch(room: InternalRoom): { ok: true } | { ok: false; message: string } {
  clearRoomTimeout(room);
  clearDisconnectTimeout(room);
  const requiredPlayers = room.settings.mode === "practice" ? 1 : 2;
  const connectedPlayers = room.players.filter((player) => player.isConnected);

  if (connectedPlayers.length < requiredPlayers) {
    return { ok: false, message: room.settings.mode === "practice" ? "A player is required." : "Two connected players are required." };
  }

  room.status = "playing";
  room.phase = "guessing";
  room.roundNumber = 1;
  room.turnNumber = 0;
  room.deck = shuffle(getCountryPool(room.settings.countryPool));
  room.usedCountryIds = [];
  room.history = [];
  room.winnerId = undefined;
  room.loserId = undefined;
  room.matchWinnerId = undefined;
  room.matchLoserId = undefined;
  room.reveal = undefined;
  room.currentWrongGuesses = 0;
  room.currentTurnPenaltyMs = 0;
  room.currentTurnStartedAt = Date.now();
  room.lastNotice = makeNotice("info", `${room.players[0].name} starts the match.`);

  for (const player of room.players) {
    ensurePlayerRecords(room, player.id);
    room.scores[player.id] = 0;
    room.stats[player.id] = emptyStats();
    room.streaks[player.id] = 0;
    setPresence(player.id, "inGame", room.roomCode);
  }

  startRound(room, getRoundStarter(room));
  return { ok: true };
}

function startRound(room: InternalRoom, starterId?: string) {
  clearRoomTimeout(room);
  const now = Date.now();
  const timerMs = room.settings.timerSeconds * 1000;

  room.status = "playing";
  room.phase = "guessing";
  room.activePlayerId = starterId ?? room.players[0]?.id;
  room.timers = Object.fromEntries(room.players.map((player) => [player.id, timerMs]));
  room.winnerId = undefined;
  room.loserId = undefined;
  room.reveal = undefined;
  room.lastTickAt = now;
  room.turnStartedAt = now;
  room.currentTurnStartedAt = now;
  room.currentWrongGuesses = 0;
  room.currentTurnPenaltyMs = 0;
  room.turnNumber = 1;
  pickNextCountry(room);
}

function handleAnswer(
  room: InternalRoom,
  playerId: string | undefined,
  payload: SubmitAnswerPayload,
  ack: (response: ActionAck) => void
) {
  if (!canAct(room, playerId, ack)) return;

  const answer = payload.answer.trim();
  if (!answer) {
    handleSkip(room, playerId, ack);
    return;
  }

  if (!room.currentCountry || !playerId) {
    fail(ack, "No country is active.");
    return;
  }

  if (
    !isAnswerCorrect(answer, room.currentCountry, {
      aliasesEnabled: room.settings.aliasesEnabled,
      forgivingSpellingEnabled: room.settings.forgivingSpellingEnabled,
      countryPool: getCountryPool(room.settings.countryPool)
    })
  ) {
    handleWrongAnswer(room, playerId, ack);
    return;
  }

  const now = Date.now();
  const elapsedMs = now - room.currentTurnStartedAt;
  commitActiveTimer(room, now);
  updateStats(room, playerId, "correct", elapsedMs, 0);
  addHistory(room, playerId, "correct", {
    answer,
    elapsedMs,
    penaltyMs: room.currentTurnPenaltyMs
  });

  const nextPlayerId = getNextPlayerId(room, playerId);
  room.lastNotice = makeNotice("correct", `${getPlayerName(room, playerId)} nailed it: ${room.currentCountry.name}`, {
    countryName: room.currentCountry.name,
    playerId
  });
  revealThenContinue(room, "correct", playerId, nextPlayerId, REVEAL_DELAY_MS);
  successAndBroadcast(room, ack);
}

function handleWrongAnswer(room: InternalRoom, playerId: string, ack: (response: ActionAck) => void) {
  const now = Date.now();
  const elapsedMs = now - room.currentTurnStartedAt;
  const penaltyMs = room.settings.wrongPenaltySeconds * 1000;
  commitActiveTimer(room, now);

  if (penaltyMs > 0) {
    room.timers[playerId] = Math.max(0, getCommittedTimer(room, playerId) - penaltyMs);
  }

  room.currentWrongGuesses += 1;
  room.currentTurnPenaltyMs += penaltyMs;
  updateStats(room, playerId, "wrong", elapsedMs, penaltyMs);

  if (getCommittedTimer(room, playerId) <= 0) {
    endRound(room, playerId, "A wrong answer ran out the clock.");
    successAndBroadcast(room, ack);
    return;
  }

  room.phase = "guessing";
  room.lastTickAt = Date.now();
  room.lastNotice = makeNotice(
    "wrong",
    `Current country — ${room.currentWrongGuesses} wrong ${room.currentWrongGuesses === 1 ? "guess" : "guesses"}${
      penaltyMs > 0 ? ` · -${room.settings.wrongPenaltySeconds}s` : ""
    }`,
    {
      playerId,
      penaltyMs
    }
  );
  successAndBroadcast(room, ack);
}

function handleSkip(room: InternalRoom, playerId: string | undefined, ack: (response: ActionAck) => void) {
  if (!canAct(room, playerId, ack)) return;
  if (!room.currentCountry || !playerId) {
    fail(ack, "No country is active.");
    return;
  }

  if (room.settings.mode === "noSkip") {
    fail(ack, "Skipping is disabled in No Skip Mode.");
    return;
  }

  const now = Date.now();
  const elapsedMs = now - room.currentTurnStartedAt;
  const penaltyMs = room.settings.skipPenaltySeconds * 1000;
  const skippedCountryName = room.currentCountry.name;

  commitActiveTimer(room, now);
  room.timers[playerId] = Math.max(0, getCommittedTimer(room, playerId) - penaltyMs);
  updateStats(room, playerId, "skip", elapsedMs, penaltyMs);
  addHistory(room, playerId, "skip", {
    elapsedMs,
    penaltyMs: room.currentTurnPenaltyMs + penaltyMs
  });

  if (getCommittedTimer(room, playerId) <= 0) {
    endRound(room, playerId, `Skipped: ${skippedCountryName}`, { addTimeoutHistory: false });
    successAndBroadcast(room, ack);
    return;
  }

  const nextPlayerId = getNextPlayerId(room, playerId);
  room.lastNotice = makeNotice("skipped", `Skipped: ${skippedCountryName}`, {
    countryName: skippedCountryName,
    playerId,
    penaltyMs
  });
  revealThenContinue(room, "skip", playerId, nextPlayerId, REVEAL_DELAY_MS);
  successAndBroadcast(room, ack);
}

function updatePlayerProfile(
  room: InternalRoom,
  playerId: string | undefined,
  payload: ProfileUpdatePayload,
  ack: (response: ActionAck) => void
) {
  if (!playerId) {
    fail(ack, "Player session missing. Refresh and rejoin the room.");
    return;
  }

  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    fail(ack, "Player not found in this room.");
    return;
  }

  player.name = sanitizePlayerName(payload.playerName, player.name);
  Object.assign(player, sanitizeProfile(payload.profile));
  successAndBroadcast(room, ack);
}

function canAct(room: InternalRoom, playerId: string | undefined, ack: (response: ActionAck) => void): boolean {
  if (!playerId) {
    fail(ack, "Player session missing. Refresh and rejoin the room.");
    return false;
  }

  if (room.status !== "playing") {
    fail(ack, "The game is not accepting answers right now.");
    return false;
  }

  if (room.phase === "paused") {
    fail(ack, "Timers are paused while a player reconnects.");
    return false;
  }

  if (room.phase !== "guessing") {
    fail(ack, "Wait for the next country.");
    return false;
  }

  if (room.activePlayerId !== playerId) {
    fail(ack, "It is not your turn.");
    return false;
  }

  return true;
}

function revealThenContinue(
  room: InternalRoom,
  result: "correct" | "skip",
  playerId: string,
  nextPlayerId: string | undefined,
  delayMs: number
) {
  const countryName = room.currentCountry?.name ?? "Unknown country";
  const now = Date.now();

  clearRoomTimeout(room);
  room.phase = "reveal";
  room.reveal = {
    result,
    countryName,
    playerId,
    nextPlayerId,
    until: now + delayMs
  };

  room.revealTimeout = setTimeout(() => {
    if (room.status !== "playing" || room.phase !== "reveal") return;

    room.phase = "guessing";
    room.reveal = undefined;
    room.activePlayerId = nextPlayerId ?? playerId;
    room.turnNumber += 1;
    room.lastTickAt = Date.now();
    room.turnStartedAt = room.lastTickAt;
    room.currentTurnStartedAt = room.lastTickAt;
    room.currentWrongGuesses = 0;
    room.currentTurnPenaltyMs = 0;
    pickNextCountry(room);
    emitRoom(room);
  }, delayMs);
}

function endRound(room: InternalRoom, loserId: string, message: string, options: { addTimeoutHistory?: boolean } = {}) {
  const now = Date.now();
  clearRoomTimeout(room);

  if (room.status === "playing") {
    commitActiveTimer(room, now);
  }

  const winnerId = room.settings.mode === "practice" ? undefined : room.players.find((player) => player.id !== loserId)?.id;
  room.status = room.settings.mode === "practice" ? "gameOver" : "roundOver";
  room.phase = "reveal";
  room.activePlayerId = undefined;
  room.loserId = loserId;
  room.winnerId = winnerId;
  room.timers[loserId] = 0;

  const shouldAddTimeoutHistory = options.addTimeoutHistory ?? true;
  if (shouldAddTimeoutHistory) {
    addHistory(room, loserId, "timeout", {
      elapsedMs: Math.max(0, now - room.currentTurnStartedAt),
      penaltyMs: room.currentTurnPenaltyMs
    });
  }

  if (winnerId) {
    room.scores[winnerId] = (room.scores[winnerId] ?? 0) + 1;
    room.stats[winnerId].roundsWon += 1;
  }

  const countryName = room.currentCountry?.name ?? "the country";
  room.lastNotice = makeNotice("round", winnerId ? `${getPlayerName(room, winnerId)} wins round ${room.roundNumber}.` : message, {
    countryName
  });
  room.reveal = {
    result: "roundWin",
    countryName,
    playerId: winnerId,
    until: now + ROUND_DELAY_MS
  };

  if (!winnerId || room.scores[winnerId] >= room.settings.roundsToWin) {
    room.status = "gameOver";
    room.matchWinnerId = winnerId;
    room.matchLoserId = loserId;
    void finalizeRankedMatch(room);
    for (const player of room.players) {
      setPresence(player.id, "online");
    }
    room.revealTimeout = setTimeout(() => {
      room.phase = "waiting";
      room.reveal = undefined;
      emitRoom(room);
    }, ROUND_DELAY_MS);
    return;
  }

  room.revealTimeout = setTimeout(() => {
    room.roundNumber += 1;
    room.lastNotice = makeNotice("info", `Round ${room.roundNumber} begins.`);
    startRound(room, getRoundStarter(room));
    emitRoom(room);
  }, ROUND_DELAY_MS);
}

function maybeResumeAfterReconnect(room: InternalRoom) {
  const requiredPlayers = room.settings.mode === "practice" ? 1 : 2;
  const connectedCount = room.players.filter((player) => player.isConnected).length;

  if (room.status === "playing" && room.phase === "paused" && connectedCount >= requiredPlayers) {
    clearDisconnectTimeout(room);
    room.phase = "guessing";
    room.lastTickAt = Date.now();
    room.turnStartedAt = Date.now();
    room.currentTurnStartedAt = room.turnStartedAt;
    room.lastNotice = makeNotice("info", "Both players are back. Timer resumed.");
  }
}

function pickNextCountry(room: InternalRoom) {
  if (room.deck.length === 0) {
    room.deck = shuffle(getCountryPool(room.settings.countryPool));
    room.usedCountryIds = [];
  }

  const nextCountry = room.deck.pop();
  if (!nextCountry) return;

  room.currentCountry = nextCountry;
  room.usedCountryIds.push(nextCountry.id);
  room.currentWrongGuesses = 0;
  room.currentTurnPenaltyMs = 0;
  room.currentTurnStartedAt = Date.now();
}

function commitActiveTimer(room: InternalRoom, now = Date.now()) {
  if (room.status !== "playing" || room.phase !== "guessing" || !room.activePlayerId) return;

  // Timers are committed only by the server. Browsers receive countdown values,
  // but answer, skip, penalty, and win/loss decisions all happen here.
  room.timers[room.activePlayerId] = getTimer(room, room.activePlayerId, now);
  room.lastTickAt = now;
}

function getTimer(room: InternalRoom, playerId: string, now = Date.now()): number {
  const committed = getCommittedTimer(room, playerId);

  if (room.status === "playing" && room.phase === "guessing" && room.activePlayerId === playerId) {
    return Math.max(0, committed - (now - room.lastTickAt));
  }

  return Math.max(0, committed);
}

function getCommittedTimer(room: InternalRoom, playerId: string): number {
  return room.timers[playerId] ?? room.settings.timerSeconds * 1000;
}

function updateStats(
  room: InternalRoom,
  playerId: string,
  result: "correct" | "wrong" | "skip",
  elapsedMs: number,
  penaltyMs: number
) {
  ensurePlayerRecords(room, playerId);
  const stats = room.stats[playerId];

  stats.penaltiesMs += penaltyMs;

  if (result === "correct") {
    stats.correct += 1;
    stats.answered += 1;
    stats.totalAnswerMs += elapsedMs;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    room.streaks[playerId] = stats.currentStreak;
    return;
  }

  if (result === "wrong") {
    stats.wrong += 1;
  } else {
    stats.skips += 1;
  }

  stats.currentStreak = 0;
  room.streaks[playerId] = 0;
}

function addHistory(
  room: InternalRoom,
  playerId: string,
  result: RoundHistoryEntry["result"],
  detail: Pick<RoundHistoryEntry, "elapsedMs" | "penaltyMs"> & { answer?: string }
) {
  const country = room.currentCountry;
  const entry: RoundHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roundNumber: room.roundNumber,
    turnNumber: room.turnNumber,
    countryId: country?.id ?? "000",
    countryName: country?.name ?? "Unknown country",
    playerId,
    playerName: getPlayerName(room, playerId),
    result,
    answer: detail.answer,
    elapsedMs: detail.elapsedMs,
    penaltyMs: detail.penaltyMs,
    wrongGuesses: room.currentWrongGuesses,
    createdAt: Date.now()
  };

  room.history = [entry, ...room.history].slice(0, MAX_HISTORY);
}

function toPublicState(room: InternalRoom, now = Date.now()): PublicGameState {
  const timers = Object.fromEntries(room.players.map((player) => [player.id, getTimer(room, player.id, now)]));

  return {
    roomCode: room.roomCode,
    matchType: room.matchType,
    players: room.players.map(({ socketId: _socketId, ...player }) => player),
    status: room.status,
    phase: room.phase,
    settings: room.settings,
    activePlayerId: room.activePlayerId,
    timers,
    scores: room.scores,
    stats: room.stats,
    streaks: room.streaks,
    currentCountry: room.currentCountry
      ? { id: room.currentCountry.id, mapId: room.currentCountry.mapId, fallbackPoint: room.currentCountry.fallbackPoint }
      : undefined,
    currentTurn: room.currentCountry
      ? {
          playerId: room.activePlayerId,
          playerName: room.activePlayerId ? getPlayerName(room, room.activePlayerId) : undefined,
          wrongGuesses: room.currentWrongGuesses,
          penaltyMs: room.currentTurnPenaltyMs,
          elapsedMs: Math.max(0, now - room.currentTurnStartedAt)
        }
      : undefined,
    usedCount: room.usedCountryIds.length,
    totalCountries: getCountryPool(room.settings.countryPool).length,
    roundNumber: room.roundNumber,
    turnNumber: room.turnNumber,
    history: room.history,
    lastNotice: room.lastNotice && room.lastNotice.expiresAt > now ? room.lastNotice : undefined,
    reveal: room.reveal && room.reveal.until > now ? room.reveal : undefined,
    winnerId: room.winnerId,
    loserId: room.loserId,
    matchWinnerId: room.matchWinnerId,
    matchLoserId: room.matchLoserId,
    serverTime: now
  };
}

function emitRoom(room: InternalRoom, now = Date.now()) {
  io.to(room.roomCode).emit("room:state", toPublicState(room, now));
}

function successAndBroadcast(room: InternalRoom, ack: (response: ActionAck) => void) {
  const state = toPublicState(room);
  ack({ ok: true, state });
  io.to(room.roomCode).emit("room:state", state);
}

function requireRoom(payload: RoomActionPayload, ack: (response: ActionAck) => void): InternalRoom | undefined {
  const room = rooms.get(payload.roomCode.trim().toUpperCase());
  if (!room) {
    fail(ack, "Room not found.");
    return undefined;
  }

  return room;
}

function fail(ack: (response: ActionAck) => void, message: string) {
  ack({ ok: false, message });
}

function attachSocketToRoom(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  roomCode: string,
  playerId: string
) {
  socket.data.roomCode = roomCode;
  socket.data.playerId = playerId;
  socket.join(roomCode);
}

function isHost(room: InternalRoom, playerId: string | undefined): boolean {
  return Boolean(playerId && room.players.some((player) => player.id === playerId && player.isHost));
}

function getPlayerName(room: InternalRoom, playerId: string): string {
  return room.players.find((player) => player.id === playerId)?.name ?? "Player";
}

function getNextPlayerId(room: InternalRoom, playerId: string): string | undefined {
  if (room.settings.mode === "practice") return playerId;
  return room.players.find((player) => player.id !== playerId)?.id ?? playerId;
}

function getRoundStarter(room: InternalRoom): string | undefined {
  if (room.settings.mode === "practice") return room.players[0]?.id;
  return room.players[(room.roundNumber - 1) % room.players.length]?.id ?? room.players[0]?.id;
}

function ensurePlayerRecords(room: InternalRoom, playerId: string) {
  room.scores[playerId] ??= 0;
  room.stats[playerId] ??= emptyStats();
  room.streaks[playerId] ??= 0;
}

function emptyStats(): PlayerStats {
  return {
    correct: 0,
    wrong: 0,
    skips: 0,
    totalAnswerMs: 0,
    answered: 0,
    currentStreak: 0,
    bestStreak: 0,
    penaltiesMs: 0,
    roundsWon: 0
  };
}

function sanitizeSettings(settings?: Partial<GameSettings>, matchType: MatchType = "unranked"): GameSettings {
  const mode = settings?.mode ?? DEFAULT_SETTINGS.mode;
  const requestedTimer = Number(settings?.timerSeconds);
  const requestedPenalty = Number(settings?.skipPenaltySeconds);
  const requestedWrongPenalty = Number(settings?.wrongPenaltySeconds);
  const requestedRoundsToWin = Number(settings?.roundsToWin);

  const sanitized: GameSettings = {
    mode: isGameMode(mode) ? mode : DEFAULT_SETTINGS.mode,
    timerSeconds: [30, 45, 60, 90, 180, 300].includes(requestedTimer)
      ? requestedTimer
      : DEFAULT_SETTINGS.timerSeconds,
    skipPenaltySeconds: Number.isFinite(requestedPenalty)
      ? Math.min(60, Math.max(0, Math.round(requestedPenalty)))
      : DEFAULT_SETTINGS.skipPenaltySeconds,
    wrongPenaltySeconds: Number.isFinite(requestedWrongPenalty)
      ? Math.min(30, Math.max(0, Math.round(requestedWrongPenalty)))
      : DEFAULT_SETTINGS.wrongPenaltySeconds,
    mapMode: settings?.mapMode === "outline" || settings?.mapMode === "context" ? settings.mapMode : DEFAULT_SETTINGS.mapMode,
    countryPool: isCountryPool(settings?.countryPool) ? settings.countryPool : DEFAULT_SETTINGS.countryPool,
    aliasesEnabled: settings?.aliasesEnabled ?? DEFAULT_SETTINGS.aliasesEnabled,
    soundEnabled: settings?.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    rankedEnabled: matchType === "ranked",
    forgivingSpellingEnabled: settings?.forgivingSpellingEnabled ?? DEFAULT_SETTINGS.forgivingSpellingEnabled,
    showCountryMenuEnabled: settings?.showCountryMenuEnabled ?? DEFAULT_SETTINGS.showCountryMenuEnabled,
    roundsToWin: [1, 2, 3, 5].includes(requestedRoundsToWin) ? requestedRoundsToWin : DEFAULT_SETTINGS.roundsToWin
  };

  if (sanitized.mode === "noSkip") {
    sanitized.skipPenaltySeconds = 0;
  }

  if (sanitized.mode === "practice") {
    sanitized.rankedEnabled = false;
  }

  if (matchType !== "ranked") {
    sanitized.rankedEnabled = false;
  }

  return sanitized;
}

function isGameMode(mode: unknown): mode is GameSettings["mode"] {
  return typeof mode === "string" && ["classic", "noSkip", "practice"].includes(mode);
}

function isCountryPool(pool: unknown): pool is GameSettings["countryPool"] {
  return (
    typeof pool === "string" &&
    ["world", "europe", "asia", "africa", "northAmerica", "southAmerica", "oceania"].includes(pool)
  );
}

function getCountryPool(pool: GameSettings["countryPool"]): CountryQuestion[] {
  return pool === "world" ? COUNTRIES : COUNTRIES.filter((country) => country.continent === pool);
}

function sanitizeProfile(profile: PlayerProfileSummary | undefined): PlayerProfileSummary {
  return {
    rating: clampInteger(profile?.rating, 100, 3000, 1000),
    wins: clampInteger(profile?.wins, 0, 9999, 0),
    losses: clampInteger(profile?.losses, 0, 9999, 0),
    bestStreak: clampInteger(profile?.bestStreak, 0, 999, 0),
    achievementsCount: clampInteger(profile?.achievementsCount, 0, 999, 0),
    title: sanitizeTitle(profile?.title)
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function sanitizeTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed.slice(0, 24) : "Unranked Explorer";
}

function forceEndRoom(room: InternalRoom, message: string) {
  commitActiveTimer(room);
  clearRoomTimeout(room);
  clearDisconnectTimeout(room);
  room.status = "gameOver";
  room.phase = "waiting";
  room.activePlayerId = undefined;
  room.matchWinnerId = undefined;
  room.matchLoserId = undefined;
  room.lastNotice = makeNotice("danger", message);
  for (const player of room.players) {
    setPresence(player.id, "online");
  }
}

function toClientProfile(profile: StoredProfile) {
  return {
    id: profile.id,
    name: profile.name,
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    rankedWins: profile.rankedWins,
    rankedLosses: profile.rankedLosses,
    gamesPlayed: profile.gamesPlayed,
    totalCorrect: profile.totalCorrect,
    totalWrong: profile.totalWrong,
    totalSkips: profile.totalSkips,
    currentWinStreak: profile.currentWinStreak,
    bestWinStreak: profile.bestWinStreak,
    bestAnswerStreak: profile.bestAnswerStreak,
    perfectGames: profile.perfectGames,
    noSkipWins: profile.noSkipWins,
    achievements: profile.achievements,
    lastRatingDelta: profile.lastRatingDelta,
    updatedAt: profile.updatedAt
  };
}

function getBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(" ") ?? [];
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

async function getRequestUser(req: Request) {
  return verifyAuthToken(getBearerToken(req.headers.authorization));
}

function getAdminToken(req: Request): string | undefined {
  const header = req.headers["x-admin-token"];
  return Array.isArray(header) ? header[0] : header;
}

function normalizeOrigin(origin: string | undefined): string {
  const raw = origin?.trim().replace(/\/$/, "") ?? "";
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

function sanitizePlayerName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 18) : fallback;
}

function sanitizeUserId(userId: unknown): string {
  return typeof userId === "string" ? userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) : "";
}

function sanitizeClientId(clientId: string | undefined): string {
  const clean = clientId?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return clean || `player-${Math.random().toString(36).slice(2, 12)}`;
}

function setPresence(userId: string | undefined, status: PresenceStatus, roomCode?: string) {
  if (!userId) return;
  presence.set(userId, {
    status,
    roomCode,
    updatedAt: Date.now()
  });
}

function presenceStatusFor(userId: string): PresenceStatus {
  const state = presence.get(userId);
  if (!state) return "offline";
  if (Date.now() - state.updatedAt > 2 * 60 * 1000) return "offline";
  return state.status;
}

function makeNotice(
  type: GameNotice["type"],
  text: string,
  extra: Omit<Partial<GameNotice>, "id" | "type" | "text" | "expiresAt"> = {}
): GameNotice {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    text,
    expiresAt: Date.now() + NOTICE_MS,
    ...extra
  };
}

function clearRoomTimeout(room: InternalRoom) {
  if (room.revealTimeout) {
    clearTimeout(room.revealTimeout);
    room.revealTimeout = undefined;
  }
}

function clearDisconnectTimeout(room: InternalRoom) {
  if (room.disconnectTimeout) {
    clearTimeout(room.disconnectTimeout);
    room.disconnectTimeout = undefined;
  }
}

function generateRoomCode(): string {
  let code = "";

  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () => {
      const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      return ROOM_CODE_ALPHABET[index];
    }).join("");
  } while (rooms.has(code));

  return code;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}
