export type MapMode = "context" | "outline";

export type GameMode = "classic" | "noSkip" | "practice";

export type CountryPool =
  | "world"
  | "europe"
  | "asia"
  | "africa"
  | "northAmerica"
  | "southAmerica"
  | "oceania";

export type GameStatus = "lobby" | "playing" | "roundOver" | "gameOver";

export type GamePhase = "waiting" | "guessing" | "reveal" | "paused";

export type HistoryResult = "correct" | "wrong" | "skip" | "timeout" | "roundWin";

export type MatchType = "ranked" | "unranked" | "practice";

export type PresenceStatus = "online" | "offline" | "inGame" | "queue";

export type AdminRole = "owner" | "admin" | "moderator" | "support";

export type AdminPermission =
  | "view_analytics"
  | "view_users"
  | "ban_users"
  | "unban_users"
  | "kick_players"
  | "force_end_games"
  | "view_active_rooms"
  | "manage_reports"
  | "grant_roles"
  | "revoke_roles";

export interface GameSettings {
  mode: GameMode;
  timerSeconds: number;
  skipPenaltySeconds: number;
  wrongPenaltySeconds: number;
  mapMode: MapMode;
  countryPool: CountryPool;
  aliasesEnabled: boolean;
  soundEnabled: boolean;
  rankedEnabled: boolean;
  forgivingSpellingEnabled: boolean;
  showCountryMenuEnabled: boolean;
  roundsToWin: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isConnected: boolean;
  rating: number;
  wins: number;
  losses: number;
  bestStreak: number;
  achievementsCount: number;
  title: string;
}

export interface PublicCountry {
  id: string;
  mapId?: string;
  fallbackPoint?: [number, number];
}

export interface PlayerStats {
  correct: number;
  wrong: number;
  skips: number;
  totalAnswerMs: number;
  answered: number;
  currentStreak: number;
  bestStreak: number;
  penaltiesMs: number;
  roundsWon: number;
}

export interface RoundHistoryEntry {
  id: string;
  roundNumber: number;
  turnNumber: number;
  countryId: string;
  countryName: string;
  playerId: string;
  playerName: string;
  result: HistoryResult;
  answer?: string;
  elapsedMs: number;
  penaltyMs: number;
  wrongGuesses: number;
  createdAt: number;
}

export interface GameNotice {
  id: string;
  type: "correct" | "wrong" | "skipped" | "info" | "danger" | "round";
  text: string;
  countryName?: string;
  playerId?: string;
  penaltyMs?: number;
  expiresAt: number;
}

export interface RevealState {
  result: "correct" | "skip" | "roundWin";
  countryName: string;
  playerId?: string;
  nextPlayerId?: string;
  until: number;
}

export interface CurrentTurnSummary {
  playerId?: string;
  playerName?: string;
  wrongGuesses: number;
  penaltyMs: number;
  elapsedMs: number;
}

export interface PublicGameState {
  roomCode: string;
  matchType: MatchType;
  players: PublicPlayer[];
  status: GameStatus;
  phase: GamePhase;
  settings: GameSettings;
  activePlayerId?: string;
  timers: Record<string, number>;
  scores: Record<string, number>;
  stats: Record<string, PlayerStats>;
  streaks: Record<string, number>;
  currentCountry?: PublicCountry;
  currentTurn?: CurrentTurnSummary;
  usedCount: number;
  totalCountries: number;
  roundNumber: number;
  turnNumber: number;
  history: RoundHistoryEntry[];
  lastNotice?: GameNotice;
  reveal?: RevealState;
  winnerId?: string;
  loserId?: string;
  matchWinnerId?: string;
  matchLoserId?: string;
  serverTime: number;
}

export interface SessionPayload {
  clientId: string;
  playerName?: string;
  profile?: PlayerProfileSummary;
  authToken?: string;
}

export interface PlayerProfileSummary {
  rating: number;
  wins: number;
  losses: number;
  bestStreak: number;
  achievementsCount: number;
  title: string;
}

export interface CreateRoomPayload extends SessionPayload {
  settings: GameSettings;
  inviteFriendId?: string;
}

export interface JoinRoomPayload extends SessionPayload {
  roomCode: string;
}

export interface ReconnectRoomPayload extends SessionPayload {
  roomCode: string;
}

export interface RoomActionPayload {
  roomCode: string;
}

export interface ProfileUpdatePayload extends RoomActionPayload {
  playerName?: string;
  profile: PlayerProfileSummary;
  authToken?: string;
}

export interface SubmitAnswerPayload {
  roomCode: string;
  answer: string;
}

export interface RankedQueuePayload extends SessionPayload {}

export type RankedQueueAck =
  | {
      ok: true;
      status: "queued";
      queuedAt: number;
    }
  | {
      ok: true;
      status: "matched";
      playerId: string;
      state: PublicGameState;
    }
  | {
      ok: false;
      message: string;
    };

export type RankedCancelAck =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
    };

export interface RankedMatchedPayload {
  playerId: string;
  state: PublicGameState;
}

export interface PublicProfile {
  id: string;
  name: string;
  rating: number;
  title: string;
  wins: number;
  losses: number;
  rankedWins: number;
  rankedLosses: number;
  achievements: Record<string, number>;
  achievementsCount: number;
  bestAnswerStreak: number;
  presence: PresenceStatus;
  recentMatches: PublicMatchSummary[];
}

export interface PublicMatchSummary {
  id: string;
  roomCode: string;
  winnerId?: string;
  loserId?: string;
  mode: GameMode;
  countryPool: CountryPool;
  ranked: boolean;
  durationMs: number;
  completedAt: number;
}

export interface FriendRequestSummary {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
  fromProfile: PublicProfile;
  toProfile: PublicProfile;
}

export interface FriendSummary {
  userId: string;
  profile: PublicProfile;
  status: PresenceStatus;
  since: number;
}

export interface FriendsPayload {
  friends: FriendSummary[];
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
}

export interface AdminUserSummary {
  profile: PublicProfile;
  roles: AdminRole[];
  permissions: AdminPermission[];
  banned: boolean;
  banReason?: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetUserId?: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export type RoomAck =
  | {
      ok: true;
      playerId: string;
      state: PublicGameState;
    }
  | {
      ok: false;
      message: string;
    };

export type ActionAck =
  | {
      ok: true;
      state: PublicGameState;
    }
  | {
      ok: false;
      message: string;
    };

export type LeaveRoomAck =
  | {
      ok: true;
      state?: PublicGameState;
    }
  | {
      ok: false;
      message: string;
    };

export interface ServerToClientEvents {
  "room:state": (state: PublicGameState) => void;
  "room:error": (message: string) => void;
  "ranked:matched": (payload: RankedMatchedPayload) => void;
  "ranked:queue": (payload: { status: "queued" | "cancelled"; queuedAt?: number }) => void;
}

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload, ack: (response: RoomAck) => void) => void;
  "room:join": (payload: JoinRoomPayload, ack: (response: RoomAck) => void) => void;
  "room:reconnect": (payload: ReconnectRoomPayload, ack: (response: RoomAck) => void) => void;
  "game:start": (payload: RoomActionPayload, ack: (response: ActionAck) => void) => void;
  "game:restart": (payload: RoomActionPayload, ack: (response: ActionAck) => void) => void;
  "room:leave": (payload: RoomActionPayload, ack: (response: LeaveRoomAck) => void) => void;
  "answer:submit": (payload: SubmitAnswerPayload, ack: (response: ActionAck) => void) => void;
  "turn:skip": (payload: RoomActionPayload, ack: (response: ActionAck) => void) => void;
  "profile:update": (payload: ProfileUpdatePayload, ack: (response: ActionAck) => void) => void;
  "ranked:join": (payload: RankedQueuePayload, ack: (response: RankedQueueAck) => void) => void;
  "ranked:cancel": (ack: (response: RankedCancelAck) => void) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
  authUserId?: string;
}
