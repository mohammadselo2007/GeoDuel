import { FormEvent, type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeHelp,
  BarChart3,
  Check,
  Clipboard,
  Crown,
  Gamepad2,
  Headphones,
  History,
  Home,
  LogIn,
  LogOut,
  Medal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings as SettingsIcon,
  Shield,
  SkipForward,
  Swords,
  Trophy,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import type {
  ActionAck,
  AdminAnalyticsSummary,
  AdminPermission,
  AdminRoomSummary,
  AdminRole,
  AdminUserSummary,
  AuditLogEntry,
  FriendsPayload,
  GameMode,
  GameSettings,
  PlayerStats,
  PublicGameState,
  PublicProfile,
  RoomAck
} from "../../shared/types";
import { COUNTRIES, COUNTRY_POOL_LABELS } from "../../shared/countries";
import { CountryMap } from "./components/CountryMap";
import { TimerPanel } from "./components/TimerPanel";
import { formatPenalty, formatShortTime, formatTimer } from "./lib/format";
import {
  forgetRoom,
  formatGuestId,
  getClientId,
  getRememberedPlayerName,
  getRememberedRoom,
  rememberPlayerName,
  rememberRoom
} from "./lib/session";
import { playSound } from "./lib/sound";
import { socket } from "./lib/socket";
import {
  consumeAuthRedirectSession,
  getStoredSession,
  isAuthConfigured,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  type AuthSession
} from "./lib/auth";
import {
  fetchAdminStats,
  fetchAdminAnalyticsApi,
  fetchAdminRoomsApi,
  banUserApi,
  fetchAuditLogsApi,
  fetchFriends,
  fetchRemoteLeaderboard,
  fetchRemoteProfile,
  recordCompletedMatch,
  removeAdminRoleApi,
  removeFriendApi,
  saveRemoteProfile,
  searchAdminUsersApi,
  searchUsers,
  sendFriendRequestApi,
  setAdminRoleApi,
  respondFriendRequestApi,
  forceEndRoomApi,
  kickPlayerApi,
  trackEvent,
  unbanUserApi,
  updateUserRatingApi,
  type AdminStats
} from "./lib/backend";
import { getClientEnvStatus } from "./lib/env";
import {
  ACHIEVEMENTS,
  applyCompletedMatch,
  getLeaderboard,
  getProfile,
  getProfileSummary,
  getProfileTitle,
  rememberObservedPlayers,
  saveProfile,
  upsertLeaderboard,
  type LeaderboardEntry,
  type MatchProgressResult,
  type PlayerProfile,
  type UnlockedAchievement
} from "./lib/profile";

const TIMER_OPTIONS = [
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "3m", value: 180 },
  { label: "5m", value: 300 }
];

const PENALTY_OPTIONS = [0, 5, 10, 15, 20];
const WRONG_PENALTY_OPTIONS = [0, 3, 5, 10];
const ROUNDS_TO_WIN_OPTIONS = [1, 2, 3, 5];
const ADMIN_ROLE_OPTIONS: AdminRole[] = ["owner", "admin", "moderator", "support"];
const ADMIN_PERMISSION_OPTIONS: AdminPermission[] = [
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

const MODE_PRESETS: Record<
  GameMode,
  {
    title: string;
    tag: string;
    description: string;
    icon: typeof Swords;
    settings: Partial<GameSettings>;
  }
> = {
  classic: {
    title: "Classic Duel",
    tag: "Ranked-ready",
    description: "Standard 1v1 chess-clock geography. Use settings below to tune pace and penalties.",
    icon: Swords,
    settings: { mode: "classic" }
  },
  noSkip: {
    title: "No Skip Mode",
    tag: "No escape",
    description: "Skipping is locked. You either know it or keep burning clock.",
    icon: Shield,
    settings: { mode: "noSkip", skipPenaltySeconds: 0 }
  },
  practice: {
    title: "Practice Mode",
    tag: "Solo",
    description: "Single-player training with the same authoritative server clock. Ranked is disabled.",
    icon: Gamepad2,
    settings: { mode: "practice", rankedEnabled: false, roundsToWin: 1 }
  }
};

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

type LandingView = "setup" | "practice" | "profile" | "friends" | "leaderboard" | "settings";

export default function App() {
  const clientId = useMemo(getClientId, []);
  const reconnectAttempted = useRef(false);
  const lastNoticeId = useRef("");
  const lastMessageNoticeId = useRef("");
  const lastGameOverId = useRef("");
  const processedProgressKey = useRef("");

  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<PlayerProfile>(() => getProfile(clientId, getRememberedPlayerName()));
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getStoredSession());
  const [playerName, setPlayerName] = useState(profile.name);
  const [joinCode, setJoinCode] = useState(getRememberedRoom());
  const [playerId, setPlayerId] = useState("");
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [landingView, setLandingView] = useState<LandingView>("setup");
  const [leaderboardVersion, setLeaderboardVersion] = useState(0);
  const [achievementQueue, setAchievementQueue] = useState<UnlockedAchievement[]>([]);
  const [lastProgressResult, setLastProgressResult] = useState<MatchProgressResult | null>(null);
  const [eloOverlayResult, setEloOverlayResult] = useState<MatchProgressResult | null>(null);
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => navigator.onLine);
  const [rankedQueueStartedAt, setRankedQueueStartedAt] = useState<number | null>(null);

  const leaderboard = useMemo<LeaderboardEntry[]>(() => getLeaderboard(), [profile, leaderboardVersion]);
  const effectiveClientId = authSession?.user.id ?? clientId;
  const authToken = authSession?.accessToken;
  const guestId = useMemo(() => formatGuestId(clientId), [clientId]);

  useEffect(() => {
    consumeAuthRedirectSession()
      .then((session) => {
        if (!session) return;
        setAuthSession(session);
        setMessage("Email confirmed. You're signed in to GeoDuel.");
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : "Email confirmation could not be completed.");
      });
  }, []);

  useEffect(() => {
    trackEvent("page_visit", { path: routePath });
  }, [routePath]);

  useEffect(() => {
      const joinMatch = routePath.match(/^\/join\/([A-Za-z0-9]{5})$/);
    if (joinMatch) {
      setJoinCode(joinMatch[1].toUpperCase());
      setLandingView("setup");
      setMessage("Invite link loaded. You can join as a guest or sign in first to use your saved profile.");
    }
  }, [routePath]);

  useEffect(() => {
    function handlePopState() {
      setRoutePath(window.location.pathname);
    }

    function handleOnline() {
      setIsBrowserOnline(true);
    }

    function handleOffline() {
      setIsBrowserOnline(false);
    }

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!authSession) return;
    fetchRemoteProfile(authSession.accessToken).then((remoteProfile) => {
      if (!remoteProfile) return;
      setProfile(remoteProfile);
      setPlayerName(remoteProfile.name);
      setLeaderboardVersion((version) => version + 1);
    });
    fetchRemoteLeaderboard().then((remoteLeaderboard) => {
      if (!remoteLeaderboard) return;
      for (const entry of remoteLeaderboard) {
        // Keep a local cache for offline rendering; Supabase remains source of truth.
        upsertLeaderboard(entry);
      }
      setLeaderboardVersion((version) => version + 1);
    });
  }, [authSession]);

  useEffect(() => {
    function handleState(state: PublicGameState) {
      setGameState(state);
      if (state.status === "lobby" && state.lastNotice && state.lastNotice.id !== lastMessageNoticeId.current) {
        lastMessageNoticeId.current = state.lastNotice.id;
        setMessage(state.lastNotice.text);
      }
    }

    function handleConnect() {
      setIsConnected(true);
      attemptReconnect();
    }

    function handleDisconnect() {
      setIsConnected(false);
    }

    function handleRankedMatched(payload: { playerId: string; state: PublicGameState }) {
      setRankedQueueStartedAt(null);
      setPlayerId(payload.playerId);
      setGameState(payload.state);
      setJoinCode(payload.state.roomCode);
      rememberRoom(payload.state.roomCode);
      playSound("start", payload.state.settings.soundEnabled);
    }

    function handleRankedQueue(payload: { status: "queued" | "cancelled"; queuedAt?: number }) {
      setRankedQueueStartedAt(payload.status === "queued" ? payload.queuedAt ?? Date.now() : null);
    }

    socket.on("room:state", handleState);
    socket.on("room:error", setMessage);
    socket.on("ranked:matched", handleRankedMatched);
    socket.on("ranked:queue", handleRankedQueue);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) {
      attemptReconnect();
    }

    return () => {
      socket.off("room:state", handleState);
      socket.off("room:error", setMessage);
      socket.off("ranked:matched", handleRankedMatched);
      socket.off("ranked:queue", handleRankedQueue);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!gameState?.lastNotice || gameState.lastNotice.id === lastNoticeId.current) return;

    lastNoticeId.current = gameState.lastNotice.id;
    if (gameState.lastNotice.type === "correct") playSound("correct", gameState.settings.soundEnabled);
    if (gameState.lastNotice.type === "wrong") playSound("wrong", gameState.settings.soundEnabled);
    if (gameState.lastNotice.type === "skipped") playSound("skip", gameState.settings.soundEnabled);
    if (gameState.lastNotice.type === "round") playSound("start", gameState.settings.soundEnabled);
  }, [gameState?.lastNotice, gameState?.settings.soundEnabled]);

  useEffect(() => {
    if (!gameState || gameState.status !== "gameOver") return;
    const gameOverKey = `${gameState.roomCode}-${gameState.history[0]?.id ?? gameState.serverTime}-${gameState.matchWinnerId ?? "solo"}`;
    if (lastGameOverId.current === gameOverKey) return;
    lastGameOverId.current = gameOverKey;
    playSound("gameOver", gameState.settings.soundEnabled);
  }, [gameState]);

  useEffect(() => {
    if (!gameState || gameState.status !== "gameOver" || !playerId) return;

    const progressKey = `${gameState.roomCode}-${gameState.history[0]?.id ?? gameState.serverTime}-${gameState.matchWinnerId ?? "practice"}-${gameState.matchLoserId ?? "none"}`;
    if (processedProgressKey.current === progressKey) return;
    processedProgressKey.current = progressKey;

    const result = applyCompletedMatch(profile, gameState, playerId);
    setProfile(result.profile);
    setLastProgressResult(result);
    setEloOverlayResult(result.ranked ? result : null);
    setLeaderboardVersion((version) => version + 1);

    if (result.unlocked.length > 0) {
      setAchievementQueue((current) => [...result.unlocked, ...current].slice(0, 4));
      playSound("correct", gameState.settings.soundEnabled);
    }

    if (socket.connected && gameState.players.some((player) => player.id === playerId)) {
      socket.emit(
        "profile:update",
        { roomCode: gameState.roomCode, playerName: result.profile.name, profile: getProfileSummary(result.profile), authToken },
        () => undefined
      );
    }
    if (authToken && result.ranked) {
      window.setTimeout(() => {
        fetchRemoteProfile(authToken).then((remoteProfile) => {
          if (remoteProfile) setProfile(remoteProfile);
        });
      }, 1800);
    }

    if (authToken && !result.ranked) {
      saveRemoteProfile(authToken, result.profile);
      recordCompletedMatch(authToken, {
        result,
        roomCode: gameState.roomCode,
        mode: gameState.settings.mode,
        countryPool: gameState.settings.countryPool,
        durationMs: gameState.serverTime - (gameState.history.at(-1)?.createdAt ?? gameState.serverTime)
      });
    }
  }, [authToken, gameState, playerId, profile]);

  useEffect(() => {
    if (achievementQueue.length === 0) return;
    const timeout = window.setTimeout(() => {
      setAchievementQueue((current) => current.slice(0, -1));
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [achievementQueue]);

  const me = useMemo(
    () => gameState?.players.find((player) => player.id === playerId),
    [gameState?.players, playerId]
  );
  const activePlayer = gameState?.players.find((player) => player.id === gameState.activePlayerId);
  const winner = gameState?.players.find((player) => player.id === (gameState.matchWinnerId ?? gameState.winnerId));
  const loser = gameState?.players.find((player) => player.id === (gameState.matchLoserId ?? gameState.loserId));
  const canAnswer = gameState?.status === "playing" && gameState.phase === "guessing" && gameState.activePlayerId === playerId;
  const skipDisabled = gameState?.settings.mode === "noSkip";
  const canStart = Boolean(
    me?.isHost &&
      gameState &&
      (gameState.settings.mode === "practice"
        ? gameState.players.length >= 1
        : gameState.players.length === 2 && gameState.players.every((player) => player.isConnected))
  );
  const currentStats = playerId ? gameState?.stats[playerId] : undefined;
  const notice = gameState?.lastNotice;
  const statusLabel = getStatusLabel(gameState, activePlayer?.name);
  const isPracticeRoom = gameState?.settings.mode === "practice";
  const isRankedRoom = gameState?.matchType === "ranked";
  const roomFullness = isPracticeRoom ? "Solo practice" : `${gameState?.players.length ?? 0}/2 players`;

  function navigate(pathName: string) {
    window.history.pushState(null, "", pathName);
    setRoutePath(pathName);
  }

  function syncProfileName() {
    const synced = saveProfile({
      ...profile,
      name: (playerName || profile.name || "Player").trim().slice(0, 18),
      updatedAt: Date.now()
    });
    setProfile(synced);
    setLeaderboardVersion((version) => version + 1);
    return synced;
  }

  function saveAndBroadcastProfile() {
    const synced = syncProfileName();
    if (gameState && socket.connected) {
      socket.emit(
        "profile:update",
        { roomCode: gameState.roomCode, playerName: synced.name, profile: getProfileSummary(synced), authToken },
        handleActionAck
      );
    }
    if (authToken) {
      saveRemoteProfile(authToken, synced);
    }
  }

  function attemptReconnect() {
    if (reconnectAttempted.current) return;
    const roomCode = getRememberedRoom();
    if (!roomCode) return;

    reconnectAttempted.current = true;
    socket.emit("room:reconnect", { roomCode, clientId: effectiveClientId, playerName, profile: getProfileSummary(profile), authToken }, (response) => {
      if (!response.ok) {
        forgetRoom();
        setMessage("Previous room closed. You can create or join a new room.");
        return;
      }
      rememberObservedPlayers(response.state, profile);
      setPlayerId(response.playerId);
      setGameState(response.state);
      setJoinCode(response.state.roomCode);
    });
  }

  function applyMode(mode: GameMode) {
    const preset = MODE_PRESETS[mode].settings;
    setSettings((current) => ({
      ...current,
      ...preset,
      mode,
      aliasesEnabled: current.aliasesEnabled,
      soundEnabled: current.soundEnabled
    }));
  }

  function handleCreateRoom() {
    setMessage("");
    const syncedProfile = syncProfileName();
    const roomSettings: GameSettings = {
      ...(settings.mode === "practice" ? { ...settings, mode: "classic" as const } : settings),
      rankedEnabled: false
    };
    rememberPlayerName(syncedProfile.name);
    socket.emit(
      "room:create",
      { clientId: effectiveClientId, playerName: syncedProfile.name, settings: roomSettings, profile: getProfileSummary(syncedProfile), authToken },
      handleRoomAck
    );
  }

  async function handleAuthSuccess(session: AuthSession) {
    setAuthSession(session);
    const remoteProfile = await fetchRemoteProfile(session.accessToken);
    const nextProfile =
      remoteProfile ??
      saveProfile({
        ...profile,
        id: session.user.id,
        name: playerName || session.user.email.split("@")[0] || "GeoDuelist",
        updatedAt: Date.now()
      });
    setProfile(nextProfile);
    setPlayerName(nextProfile.name);
    if (!remoteProfile) {
      await saveRemoteProfile(session.accessToken, nextProfile);
    }
    setMessage("Signed in. Your GeoDuel profile is ready.");
  }

  async function handleSignOut() {
    await signOut(authSession);
    setAuthSession(null);
    finishLocalLeave("setup");
    setMessage("Signed out.");
  }

  function handlePractice() {
    const syncedProfile = syncProfileName();
    const practiceSettings = {
      ...settings,
      ...MODE_PRESETS.practice.settings,
      mode: "practice" as const,
      soundEnabled: settings.soundEnabled,
      aliasesEnabled: settings.aliasesEnabled,
      countryPool: settings.countryPool,
      forgivingSpellingEnabled: settings.forgivingSpellingEnabled,
      showCountryMenuEnabled: settings.showCountryMenuEnabled
    };

    setMessage("");
    rememberPlayerName(syncedProfile.name);
    socket.emit(
      "room:create",
      { clientId: effectiveClientId, playerName: syncedProfile.name, settings: practiceSettings, profile: getProfileSummary(syncedProfile), authToken },
      (response) => {
        handleRoomAck(response);
        if (response.ok) {
          trackEvent("game_start", { mode: "practice", countryPool: practiceSettings.countryPool });
          socket.emit("game:start", { roomCode: response.state.roomCode }, handleActionAck);
        }
      }
    );
  }

  function finishLocalLeave(destination: LandingView = "setup") {
    forgetRoom();
    reconnectAttempted.current = false;
    setPlayerId("");
    setGameState(null);
    setAnswer("");
    setPendingAction(false);
    setShowHistory(true);
    setEloOverlayResult(null);
    setLandingView(destination);
  }

  function handleLeaveGame(destination: LandingView = "setup") {
    if (!gameState) {
      finishLocalLeave(destination);
      return;
    }

    const isActiveMultiplayer = gameState.settings.mode !== "practice" && gameState.status !== "gameOver";
    if (isActiveMultiplayer && !window.confirm("Leave this multiplayer game? This will remove you from the room.")) {
      return;
    }

    if (!socket.connected) {
      finishLocalLeave(destination);
      return;
    }

    setPendingAction(true);
    socket.emit("room:leave", { roomCode: gameState.roomCode }, (response) => {
      setPendingAction(false);
      if (!response.ok) {
        setMessage(response.message);
        return;
      }
      if (response.state?.status === "gameOver" && playerId && response.state.players.some((player) => player.id === playerId)) {
        const result = applyCompletedMatch(profile, response.state, playerId);
        setProfile(result.profile);
        if (authToken) {
          saveRemoteProfile(authToken, result.profile);
        }
        setLeaderboardVersion((version) => version + 1);
      }
      finishLocalLeave(destination);
    });
  }

  function handleJoinRoom(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const syncedProfile = syncProfileName();
    rememberPlayerName(syncedProfile.name);
    socket.emit(
      "room:join",
      { roomCode: joinCode, clientId: effectiveClientId, playerName: syncedProfile.name, profile: getProfileSummary(syncedProfile), authToken },
      handleRoomAck
    );
  }

  function handleRoomAck(response: RoomAck) {
    if (!response.ok) {
      setMessage(response.message);
      return;
    }

    setPlayerId(response.playerId);
    setGameState(response.state);
    setJoinCode(response.state.roomCode);
    rememberObservedPlayers(response.state, profile);
    setLeaderboardVersion((version) => version + 1);
    rememberRoom(response.state.roomCode);
    setAnswer("");
    playSound("start", response.state.settings.soundEnabled);
  }

  function handleActionAck(response: ActionAck) {
    setPendingAction(false);
    if (!response.ok) {
      setMessage(response.message);
      return;
    }

    setMessage("");
    setGameState(response.state);
    rememberObservedPlayers(response.state, profile);
    setLeaderboardVersion((version) => version + 1);
  }

  function handleStart() {
    if (!gameState || pendingAction) return;
    setPendingAction(true);
    setLastProgressResult(null);
    setEloOverlayResult(null);
    trackEvent("game_start", { mode: gameState.settings.mode, countryPool: gameState.settings.countryPool });
    socket.emit("game:start", { roomCode: gameState.roomCode }, handleActionAck);
  }

  function handleRankedMatchmaking() {
    if (pendingAction || rankedQueueStartedAt) return;
    if (!authToken) {
      setMessage("Sign in to use ranked matchmaking.");
      return;
    }

    const syncedProfile = syncProfileName();
    rememberPlayerName(syncedProfile.name);
    setPendingAction(true);
    socket.emit(
      "ranked:join",
      { clientId: effectiveClientId, playerName: syncedProfile.name, profile: getProfileSummary(syncedProfile), authToken },
      (response) => {
        setPendingAction(false);
        if (!response.ok) {
          setMessage(response.message);
          setRankedQueueStartedAt(null);
          return;
        }
        if (response.status === "queued") {
          setRankedQueueStartedAt(response.queuedAt);
          setMessage("Searching for a ranked opponent...");
          return;
        }
        setRankedQueueStartedAt(null);
        setPlayerId(response.playerId);
        setGameState(response.state);
        setJoinCode(response.state.roomCode);
        rememberRoom(response.state.roomCode);
      }
    );
  }

  function handleCancelRankedQueue() {
    socket.emit("ranked:cancel", (response) => {
      if (!response.ok) {
        setMessage(response.message);
        return;
      }
      setRankedQueueStartedAt(null);
      setMessage("Ranked search cancelled.");
    });
  }

  function handleCreateFriendRoom(friendUserId?: string) {
    const syncedProfile = syncProfileName();
    const roomSettings: GameSettings = {
      ...settings,
      mode: settings.mode === "practice" ? "classic" : settings.mode,
      rankedEnabled: false
    };
    socket.emit(
      "room:create",
      {
        clientId: effectiveClientId,
        playerName: syncedProfile.name,
        settings: roomSettings,
        profile: getProfileSummary(syncedProfile),
        authToken,
        inviteFriendId: friendUserId
      },
      handleRoomAck
    );
  }

  function handleRestart() {
    if (!gameState || pendingAction) return;
    setPendingAction(true);
    setLastProgressResult(null);
    setEloOverlayResult(null);
    setAnswer("");
    socket.emit("game:restart", { roomCode: gameState.roomCode }, handleActionAck);
  }

  function handleSubmitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!gameState || !canAnswer || pendingAction) return;

    setPendingAction(true);
    socket.emit("answer:submit", { roomCode: gameState.roomCode, answer }, (response) => {
      if (response.ok && response.state.lastNotice?.type !== "wrong") {
        setAnswer("");
      }
      handleActionAck(response);
    });
  }

  function handleSkip() {
    if (!gameState || !canAnswer || pendingAction || skipDisabled) return;
    setPendingAction(true);
    socket.emit("turn:skip", { roomCode: gameState.roomCode }, (response) => {
      if (response.ok) {
        setAnswer("");
      }
      handleActionAck(response);
    });
  }

  async function handleCopyRoomCode() {
    if (!gameState) return;
    try {
      await navigator.clipboard.writeText(getInviteLink(gameState.roomCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setMessage(`Invite link: ${getInviteLink(gameState.roomCode)}`);
    }
  }

  if (routePath === "/admin") {
    return (
      <AdminDashboard
        session={authSession}
        profile={profile}
        onAuthSuccess={handleAuthSuccess}
        onSignOut={handleSignOut}
        onBack={() => navigate("/")}
      />
    );
  }

  if (routePath === "/privacy" || routePath === "/terms") {
    return <LegalPage type={routePath === "/privacy" ? "privacy" : "terms"} onBack={() => navigate("/")} />;
  }

  if (!gameState) {
    return (
      <main className="app landing plus-screen">
        {!isBrowserOnline && <OfflineBanner />}
        <section className="hero-panel">
          <div className="hero-copy">
            <div className="brand-row">
              <BrandLogo />
              <span>GeoDuel</span>
            </div>
            <h1>Outguess the map. Outlast the clock.</h1>
            <p>
              A free real-time geography duel with online rooms, ranked Elo, achievements, server-owned clocks,
              and a solo practice lane.
            </p>
          </div>

          <div className="hero-actions">
            <button className="primary-action compact" type="button" onClick={() => setLandingView("setup")} title="Play online">
              <Swords aria-hidden="true" size={18} />
              Play Online
            </button>
            <button className="secondary-action compact" type="button" onClick={() => setLandingView("practice")} title="Practice">
              <Gamepad2 aria-hidden="true" size={18} />
              Practice
            </button>
            <button className="icon-text-button" type="button" onClick={() => setShowHelp(true)} title="How to play">
              <BadgeHelp aria-hidden="true" size={18} />
              How to play
            </button>
          </div>
          <AuthPanel
            session={authSession}
            profile={profile}
            guestId={guestId}
            onAuthSuccess={handleAuthSuccess}
            onSignOut={handleSignOut}
          />
        </section>
        <AdPlaceholder placement="home" />

        <nav className="landing-tabs" aria-label="GeoDuel screens">
          <button className={landingView === "setup" ? "selected" : ""} type="button" onClick={() => setLandingView("setup")}>
            <Swords aria-hidden="true" size={18} />
            Play
          </button>
          <button className={landingView === "practice" ? "selected" : ""} type="button" onClick={() => setLandingView("practice")}>
            <Gamepad2 aria-hidden="true" size={18} />
            Practice
          </button>
          <button className={landingView === "profile" ? "selected" : ""} type="button" onClick={() => setLandingView("profile")}>
            <BarChart3 aria-hidden="true" size={18} />
            Profile
          </button>
          <button className={landingView === "friends" ? "selected" : ""} type="button" onClick={() => setLandingView("friends")}>
            <Users aria-hidden="true" size={18} />
            Friends
          </button>
          <button className={landingView === "leaderboard" ? "selected" : ""} type="button" onClick={() => setLandingView("leaderboard")}>
            <Trophy aria-hidden="true" size={18} />
            Leaderboard
          </button>
          <button className={landingView === "settings" ? "selected" : ""} type="button" onClick={() => setLandingView("settings")}>
            <SettingsIcon aria-hidden="true" size={18} />
            Settings
          </button>
        </nav>

        {landingView === "setup" && (
        <>
        <RankedMatchmakingPanel
          profile={profile}
          isConnected={isConnected}
          isSignedIn={Boolean(authToken)}
          queuedAt={rankedQueueStartedAt}
          pending={pendingAction}
          onSearch={handleRankedMatchmaking}
          onCancel={handleCancelRankedQueue}
        />
        <section className="setup-grid">
          <section className="glass-panel settings-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">Unranked Room</p>
                <h2>Customize friend match rules</h2>
              </div>
              <span className="status-badge">
                <Headphones aria-hidden="true" size={14} />
                Free browser audio
              </span>
            </div>

            <ProfileStrip profile={profile} />
            {!authToken && (
              <div className="guest-note">
                <strong>Playing as {guestId}</strong>
                <span>Unranked rooms and practice work without an account. Sign in only when you want ranked Elo, friends, and saved progression.</span>
              </div>
            )}

            <div className="mode-grid">
              {(["classic", "noSkip"] as GameMode[]).map((mode) => {
                const preset = MODE_PRESETS[mode];
                const Icon = preset.icon;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`mode-card ${settings.mode === mode ? "selected" : ""}`}
                    onClick={() => applyMode(mode)}
                  >
                    <span className="mode-icon">
                      <Icon aria-hidden="true" size={20} />
                    </span>
                    <span>
                      <strong>{preset.title}</strong>
                      <small>{preset.description}</small>
                    </span>
                    <em>{preset.tag}</em>
                  </button>
                );
              })}
            </div>

            <div className="settings-matrix">
              <label className="field">
                <span>Player name</span>
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  maxLength={18}
                  placeholder="Player name"
                />
              </label>

              <SettingButtons
                label="Timer"
                options={TIMER_OPTIONS}
                value={settings.timerSeconds}
                onChange={(timerSeconds) => setSettings((current) => ({ ...current, timerSeconds }))}
              />

              <SettingButtons
                label="Skip penalty"
                options={PENALTY_OPTIONS.map((value) => ({ label: `${value}s`, value }))}
                value={settings.skipPenaltySeconds}
                onChange={(skipPenaltySeconds) => setSettings((current) => ({ ...current, skipPenaltySeconds }))}
                disabled={settings.mode === "noSkip"}
              />

              <SettingButtons
                label="Wrong penalty"
                options={WRONG_PENALTY_OPTIONS.map((value) => ({ label: `${value}s`, value }))}
                value={settings.wrongPenaltySeconds}
                onChange={(wrongPenaltySeconds) => setSettings((current) => ({ ...current, wrongPenaltySeconds }))}
              />

              <SettingButtons
                label="Rounds to win"
                options={ROUNDS_TO_WIN_OPTIONS.map((value) => ({ label: `${value}`, value }))}
                value={settings.roundsToWin}
                onChange={(roundsToWin) => setSettings((current) => ({ ...current, roundsToWin }))}
              />

              <label className="field">
                <span>Country pool</span>
                <select
                  value={settings.countryPool}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, countryPool: event.target.value as GameSettings["countryPool"] }))
                  }
                >
                  {Object.entries(COUNTRY_POOL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="toggle-row">
                <button
                  type="button"
                  className={settings.mapMode === "context" ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, mapMode: "context" }))}
                >
                  Neighbor map
                </button>
                <button
                  type="button"
                  className={settings.mapMode === "outline" ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, mapMode: "outline" }))}
                >
                  Outline map
                </button>
              </div>

              <div className="toggle-row">
                <button
                  type="button"
                  className={settings.forgivingSpellingEnabled ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, forgivingSpellingEnabled: !current.forgivingSpellingEnabled }))}
                >
                  Spelling {settings.forgivingSpellingEnabled ? "forgiving" : "strict"}
                </button>
              </div>

              <div className="toggle-row">
                <button
                  type="button"
                  className={settings.aliasesEnabled ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, aliasesEnabled: !current.aliasesEnabled }))}
                >
                  Aliases {settings.aliasesEnabled ? "on" : "off"}
                </button>
                <button
                  type="button"
                  className={settings.showCountryMenuEnabled ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, showCountryMenuEnabled: !current.showCountryMenuEnabled }))}
                >
                  Country assist {settings.showCountryMenuEnabled ? "on" : "off"}
                </button>
              </div>

              <div className="toggle-row">
                <button
                  type="button"
                  className={settings.soundEnabled ? "toggle selected" : "toggle"}
                  onClick={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
                >
                  {settings.soundEnabled ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}
                  Sound
                </button>
              </div>
            </div>

            <div className="setup-create-footer">
              <button className="primary-action create-room-action" type="button" onClick={handleCreateRoom} disabled={!isConnected} title="Create room">
                <Plus aria-hidden="true" size={21} />
                Create unranked room
              </button>
              {!isConnected && <p className="form-message">Connecting to the game server...</p>}
            </div>
          </section>

          <form className="glass-panel join-panel" onSubmit={handleJoinRoom}>
            <div className="panel-title">
              <div>
                <p className="eyebrow">Squad link</p>
                <h2>Join a room</h2>
              </div>
              <span className={`status-dot ${isConnected ? "online" : "offline"}`} />
            </div>

            <label className="field">
              <span>Room code</span>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={5} placeholder="ABCDE" />
            </label>

            <button className="secondary-action" type="submit" disabled={!joinCode.trim() || !isConnected} title="Join room">
              <LogIn aria-hidden="true" size={20} />
              Join room
            </button>

            {message && <p className="form-message">{message}</p>}
            {!isConnected && <p className="form-message">Connecting to the game server...</p>}
            {!authToken && <p className="success-message">Guest joining is enabled for unranked rooms.</p>}
          </form>
        </section>
        </>
        )}

        {landingView === "practice" && (
          <PracticeSetup
            settings={settings}
            setSettings={setSettings}
            playerName={playerName}
            onPlayerNameChange={setPlayerName}
            onStart={handlePractice}
            isConnected={isConnected}
          />
        )}

        {landingView === "profile" && (
          <ProfileScreen profile={profile} playerName={playerName} onPlayerNameChange={setPlayerName} onSave={saveAndBroadcastProfile} />
        )}

        {landingView === "friends" && (
          <FriendsAndSearchScreen
            authToken={authToken}
            currentProfile={profile}
            onInviteFriend={handleCreateFriendRoom}
            onMessage={setMessage}
          />
        )}

        {landingView === "leaderboard" && <LeaderboardScreen entries={leaderboard} currentProfile={profile} />}

        {landingView === "settings" && (
          <ProductSettingsScreen
            settings={settings}
            setSettings={setSettings}
            isConnected={isConnected}
            authSession={authSession}
            guestId={guestId}
          />
        )}

        {showHelp && <HowToPlayModal onClose={() => setShowHelp(false)} />}
        <AchievementToasts achievements={achievementQueue} />
        <FooterLinks onNavigate={navigate} />
      </main>
    );
  }

  return (
    <main className="app game plus-screen">
      {!isBrowserOnline && <OfflineBanner />}
      <header className="game-header">
        <div className={`room-stack ${isPracticeRoom ? "practice-room-stack" : ""}`}>
          <p className="eyebrow">{isPracticeRoom ? "Mode" : isRankedRoom ? "Ranked" : "Invite"}</p>
          <div className="room-code-row">
            <strong>{isPracticeRoom ? "Solo Practice" : isRankedRoom ? "Matchmaking" : gameState.roomCode}</strong>
            {!isPracticeRoom && !isRankedRoom && (
              <button className="icon-button" type="button" onClick={handleCopyRoomCode} title="Copy invite link">
                {copied ? <Check aria-hidden="true" size={18} /> : <Clipboard aria-hidden="true" size={18} />}
              </button>
            )}
          </div>
        </div>

        <div className="match-status">
          <span className={`phase-pulse ${gameState.phase}`} />
          <div>
            <strong>{statusLabel}</strong>
            <small>
              Round {gameState.roundNumber} · Turn {gameState.turnNumber || 1} · {roomFullness}
            </small>
          </div>
        </div>

        <div className="header-actions">
          <button className="icon-text-button" type="button" onClick={() => setShowHistory((current) => !current)} title="Toggle history">
            <History aria-hidden="true" size={18} />
            {showHistory ? "Hide history" : "Show history"}
          </button>
          <button className="icon-text-button" type="button" onClick={() => setLandingView("profile")} title="Profile">
            <BarChart3 aria-hidden="true" size={18} />
            Profile
          </button>
          <button className="icon-text-button" type="button" onClick={() => setLandingView("leaderboard")} title="Leaderboard">
            <Trophy aria-hidden="true" size={18} />
            Leaders
          </button>
          <button className="icon-text-button" type="button" onClick={() => setShowHelp(true)} title="How to play">
            <BadgeHelp aria-hidden="true" size={18} />
            Help
          </button>
          <button className="icon-text-button" type="button" onClick={() => handleLeaveGame("setup")} disabled={pendingAction} title="Main menu">
            <Home aria-hidden="true" size={18} />
            Main Menu
          </button>
          <button className="danger-action compact nav-danger" type="button" onClick={() => handleLeaveGame("setup")} disabled={pendingAction} title="Leave game">
            <LogOut aria-hidden="true" size={18} />
            Leave Game
          </button>
        </div>
      </header>

      {gameState.status === "lobby" && (
        <section className="lobby-layout">
          <div className="glass-panel lobby-card">
            <p className="eyebrow">Waiting room</p>
            <h2>{gameState.settings.mode === "practice" ? "Solo practice ready" : "Invite one opponent"}</h2>
            <div className="player-list">
              {gameState.players.map((player) => (
                <div className="player-row" key={player.id}>
                  <span>
                    {player.name}
                    <em>
                      {player.rating} · {player.wins}-{player.losses} · {player.title}
                    </em>
                  </span>
                  <small>{player.isHost ? "Host" : "Guest"}</small>
                </div>
              ))}
              {gameState.settings.mode !== "practice" && gameState.players.length < 2 && (
                <div className="player-row empty">
                  <span>Waiting for player 2</span>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel lobby-card">
            <p className="eyebrow">Match rules</p>
            <h2>{getMatchTitle(gameState.settings)}</h2>
            <div className="rule-pills">
              <span>{gameState.settings.timerSeconds}s clock</span>
              <span>{COUNTRY_POOL_LABELS[gameState.settings.countryPool]}</span>
              <span>{gameState.settings.mapMode} map</span>
              <span>{gameState.settings.mode === "noSkip" ? "no skips" : `${gameState.settings.skipPenaltySeconds}s skip`}</span>
              <span>{gameState.settings.wrongPenaltySeconds}s wrong</span>
              <span>first to {gameState.settings.roundsToWin}</span>
              <span>{gameState.matchType === "ranked" ? "ranked matchmaking" : "unranked"}</span>
              <span>{gameState.settings.forgivingSpellingEnabled ? "forgiving spelling" : "strict spelling"}</span>
              <span>{gameState.settings.showCountryMenuEnabled ? "country assist on" : "country assist off"}</span>
            </div>
            {!isPracticeRoom && !isRankedRoom && (
              <div className="invite-copy">
                <span>{getInviteLink(gameState.roomCode)}</span>
                <button className="ghost-action compact" type="button" onClick={handleCopyRoomCode}>
                  {copied ? "Copied" : "Copy invite link"}
                </button>
              </div>
            )}

            {me?.isHost ? (
              <button className="primary-action" type="button" onClick={handleStart} disabled={!canStart || pendingAction} title="Start match">
                <Play aria-hidden="true" size={20} />
                Start match
              </button>
            ) : (
              <p className="form-message">Waiting for the host to start.</p>
            )}
          </div>
        </section>
      )}

      {(gameState.status === "playing" || gameState.status === "roundOver" || gameState.status === "gameOver") && (
        <section className={`play-layout ${notice ? `notice-${notice.type}` : ""}`}>
          <div className="scoreboard">
            {gameState.players.map((player) => (
              <TimerPanel
                key={player.id}
                player={player}
                remainingMs={gameState.timers[player.id] ?? 0}
                isActive={gameState.activePlayerId === player.id && gameState.phase === "guessing"}
                isYou={player.id === playerId}
                status={gameState.status}
                score={gameState.scores[player.id] ?? 0}
                roundsToWin={gameState.settings.roundsToWin}
                stats={gameState.stats[player.id]}
                isPractice={isPracticeRoom}
              />
            ))}
          </div>

          <section className="mission-grid">
            <div className="map-column">
              <CountryMap
                countryId={gameState.currentCountry?.mapId}
                fallbackPoint={gameState.currentCountry?.fallbackPoint}
                mode={gameState.settings.mapMode}
                phase={gameState.phase}
                notice={notice?.text}
                revealName={gameState.reveal?.countryName}
              />

              {gameState.currentTurn && gameState.status === "playing" && (
                <CurrentTurnPanel
                  currentTurn={gameState.currentTurn}
                  canAnswer={Boolean(canAnswer)}
                  activeName={activePlayer?.name}
                  poolLabel={COUNTRY_POOL_LABELS[gameState.settings.countryPool]}
                  menuEnabled={gameState.settings.showCountryMenuEnabled}
                />
              )}

              {gameState.status === "playing" && (
                <form className="answer-bar" onSubmit={handleSubmitAnswer}>
                  <div className="answer-input-wrap">
                    <span className="active-chip">{canAnswer ? "Your move" : `${activePlayer?.name ?? "Opponent"} thinking`}</span>
                    <CountryAnswerInput
                      value={answer}
                      onChange={setAnswer}
                      canAnswer={Boolean(canAnswer)}
                      pending={pendingAction}
                      pool={gameState.settings.countryPool}
                      menuEnabled={gameState.settings.showCountryMenuEnabled}
                      placeholder={canAnswer ? "Type the country name" : "Waiting for turn"}
                    />
                  </div>
                  <button type="submit" className="primary-action compact" disabled={!canAnswer || pendingAction} title="Submit answer">
                    <Send aria-hidden="true" size={19} />
                    Submit
                  </button>
                  <button
                    type="button"
                    className="danger-action compact"
                    onClick={handleSkip}
                    disabled={!canAnswer || pendingAction || skipDisabled}
                    title={skipDisabled ? "Skipping disabled" : "Skip country"}
                  >
                    <SkipForward aria-hidden="true" size={19} />
                    Skip
                  </button>
                </form>
              )}

              {gameState.status === "gameOver" && (
                <GameOverPanel
                  winnerName={winner?.name}
                  loserName={loser?.name}
                  stats={gameState.stats}
                  players={gameState.players}
                  onRestart={handleRestart}
                  pending={pendingAction}
                  isPractice={gameState.settings.mode === "practice"}
                  isRanked={gameState.matchType === "ranked"}
                  progressResult={lastProgressResult}
                  adPlaceholder={<AdPlaceholder placement="postgame" />}
                />
              )}
            </div>

            <aside className={`side-rail ${showHistory ? "" : "collapsed"}`}>
              <StatsPanel stats={currentStats} remainingMs={playerId ? gameState.timers[playerId] : 0} />
              <HistoryPanel entries={gameState.history} />
            </aside>
          </section>
        </section>
      )}

      {message && <p className="toast">{message}</p>}
      {showHelp && <HowToPlayModal onClose={() => setShowHelp(false)} />}
      {landingView === "profile" && gameState && (
        <ProfileOverlay
          profile={profile}
          playerName={playerName}
          leaderboard={leaderboard}
          onPlayerNameChange={setPlayerName}
          onSave={saveAndBroadcastProfile}
          onClose={() => setLandingView("setup")}
        />
      )}
      {landingView === "leaderboard" && gameState && (
        <LeaderboardOverlay entries={leaderboard} currentProfile={profile} onClose={() => setLandingView("setup")} />
      )}
      {eloOverlayResult && <EloChangeOverlay result={eloOverlayResult} onContinue={() => setEloOverlayResult(null)} />}
      <AchievementToasts achievements={achievementQueue} />
    </main>
  );
}

interface SettingButtonsProps {
  label: string;
  options: { label: string; value: number }[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

function AuthPanel({
  session,
  profile,
  guestId,
  onAuthSuccess,
  onSignOut
}: {
  session: AuthSession | null;
  profile: PlayerProfile;
  guestId?: string;
  onAuthSuccess: (session: AuthSession) => void;
  onSignOut: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(profile.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const envStatus = getClientEnvStatus();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const nextSession =
        mode === "signin"
          ? await signInWithEmail(email, password)
          : await signUpWithEmail(email, password, displayName || email.split("@")[0]);
      onAuthSuccess(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAuthConfigured()) {
    return (
      <section className="auth-panel">
        <p className="eyebrow">Accounts</p>
        <h2>Supabase needs attention</h2>
        <p>{envStatus.errors[0] ?? "Add Supabase environment variables to enable secure email/password accounts."}</p>
        <small>After changing Vercel env vars, redeploy the frontend because Vite bakes them into the build.</small>
      </section>
    );
  }

  if (session) {
    return (
      <section className="auth-panel signed-in">
        <p className="eyebrow">Signed in</p>
        <h2>{profile.name}</h2>
        <div className="rule-pills">
          <span>{profile.rating} Elo</span>
          <span>
            {profile.wins}-{profile.losses} record
          </span>
        </div>
        <button className="ghost-action compact" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    );
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <p className="eyebrow">Account optional</p>
      <h2>{mode === "signin" ? "Save your rank" : "Create account"}</h2>
      <p className="auth-helper">
        {guestId ? `You can play unranked as ${guestId}. ` : ""}
        Sign in for ranked Elo, friends, achievements, and cloud profile history.
      </p>
      {mode === "signup" && (
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={18} placeholder="Display name" />
      )}
      <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" required />
      <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" required minLength={6} />
      <button className="primary-action compact" type="submit" disabled={busy}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button className="ghost-action compact" type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "Need an account?" : "Already have an account?"}
      </button>
      {error && <p className="form-message">{error}</p>}
    </form>
  );
}

function RankedMatchmakingPanel({
  profile,
  isConnected,
  isSignedIn,
  queuedAt,
  pending,
  onSearch,
  onCancel
}: {
  profile: PlayerProfile;
  isConnected: boolean;
  isSignedIn: boolean;
  queuedAt: number | null;
  pending: boolean;
  onSearch: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!queuedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [queuedAt]);

  return (
    <section className={`glass-panel ranked-card ${queuedAt ? "searching" : ""}`}>
      <div className="panel-title">
        <div>
          <p className="eyebrow">Ranked Matchmaking</p>
          <h2>Find a fair opponent</h2>
        </div>
        <span className="status-badge">
          <Crown aria-hidden="true" size={14} />
          {profile.rating} Elo · {getProfileTitle(profile)}
        </span>
      </div>
      <p>
        Ranked uses fixed competitive settings and random online opponents only. Invite rooms are always unranked, so Elo
        cannot be farmed with chosen opponents.
      </p>
      <div className="rule-pills">
        <span>3m clock</span>
        <span>Best of 3</span>
        <span>Whole World</span>
        <span>Context map</span>
        <span>10s skips</span>
        <span>3s wrong</span>
      </div>
      {queuedAt ? (
        <div className="queue-row">
          <strong>Searching for opponent...</strong>
          <span>{formatShortTime(now - queuedAt)}</span>
          <button className="danger-action compact" type="button" onClick={onCancel}>
            <X aria-hidden="true" size={18} />
            Cancel search
          </button>
        </div>
      ) : (
        <button className="primary-action ranked-cta" type="button" onClick={onSearch} disabled={!isConnected || !isSignedIn || pending}>
          <Swords aria-hidden="true" size={21} />
          Ranked Matchmaking
        </button>
      )}
      {!isSignedIn && <p className="form-message">Sign in to play ranked and save Elo.</p>}
    </section>
  );
}

function BrandLogo() {
  return <img className="brand-logo" src="/geoduel-logo.svg" alt="GeoDuel logo" />;
}

function OfflineBanner() {
  return (
    <section className="offline-banner" role="status">
      <Shield aria-hidden="true" size={17} />
      You are offline. Live rooms will reconnect automatically when your connection returns.
    </section>
  );
}

function AdPlaceholder({ placement }: { placement: "home" | "postgame" }) {
  return (
    <section className={`ad-placeholder ${placement}`} aria-label="Future ad slot">
      <span>Future sponsor slot</span>
      <small>{placement === "home" ? "Reserved for optional homepage ads later." : "Reserved for optional post-game ads later."}</small>
    </section>
  );
}

function FooterLinks({ onNavigate }: { onNavigate: (pathName: string) => void }) {
  return (
    <footer className="product-footer">
      <button type="button" onClick={() => onNavigate("/")}>
        GeoDuel
      </button>
      <button type="button" onClick={() => onNavigate("/privacy")}>
        Privacy Policy
      </button>
      <button type="button" onClick={() => onNavigate("/terms")}>
        Terms of Service
      </button>
    </footer>
  );
}

function LegalPage({ type, onBack }: { type: "privacy" | "terms"; onBack: () => void }) {
  const isPrivacy = type === "privacy";
  return (
    <main className="app legal-screen plus-screen">
      <section className="glass-panel legal-card">
        <div className="panel-title">
          <div className="brand-row">
            <BrandLogo />
            <span>GeoDuel</span>
          </div>
          <button className="icon-text-button" type="button" onClick={onBack}>
            <Home aria-hidden="true" size={18} />
            Home
          </button>
        </div>
        <p className="eyebrow">{isPrivacy ? "Privacy Policy" : "Terms of Service"}</p>
        <h1>{isPrivacy ? "Privacy Policy" : "Terms of Service"}</h1>
        {isPrivacy ? (
          <div className="legal-copy">
            <p>
              GeoDuel stores account profile data, ranked statistics, achievements, leaderboard rows, and completed match
              summaries when Supabase is configured. Email/password authentication is handled by Supabase Auth; GeoDuel does
              not store plaintext passwords.
            </p>
            <p>
              Basic analytics record product events such as page visits, game starts, completed matches, room regions, and
              server health. These events are used to keep the game reliable and improve the experience.
            </p>
            <p>
              Do not enter sensitive personal information as your display name. Future ads are not enabled in this version;
              reserved ad slots are placeholders only.
            </p>
          </div>
        ) : (
          <div className="legal-copy">
            <p>
              GeoDuel is a free geography game. Play fairly, do not abuse the room system, and do not attempt to bypass
              server-owned timers, answer validation, ranked progression, or admin protections.
            </p>
            <p>
              Country data and map rendering use free/open-source datasets and libraries. The service is provided as-is;
              uptime and leaderboard availability depend on your chosen free hosting and Supabase project.
            </p>
            <p>
              Administrators may remove abusive data, restrict access, or reset rooms to protect the game and other players.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function AdminDashboard({
  session,
  profile,
  onAuthSuccess,
  onSignOut,
  onBack
}: {
  session: AuthSession | null;
  profile: PlayerProfile;
  onAuthSuccess: (session: AuthSession) => void;
  onSignOut: () => void;
  onBack: () => void;
}) {
  const [adminToken, setAdminToken] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsSummary | null>(null);
  const [activeRooms, setActiveRooms] = useState<AdminRoomSummary[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [roleDraft, setRoleDraft] = useState<AdminRole>("moderator");
  const [permissionDraft, setPermissionDraft] = useState<AdminPermission[]>(["view_users", "view_active_rooms"]);
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, string>>({});
  const [ratingReason, setRatingReason] = useState("Admin Elo adjustment");
  const [activeAdminTab, setActiveAdminTab] = useState<"overview" | "users" | "rooms" | "audit">("overview");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  async function loadDashboard(query = userQuery) {
    setLoading(true);
    setError("");
    setStatusMessage("");
    try {
      const [nextStats, nextUsers, nextAudit, nextAnalytics, nextRooms] = await Promise.all([
        fetchAdminStats(session?.accessToken, adminToken || undefined),
        searchAdminUsersApi(session?.accessToken, adminToken || undefined, query),
        fetchAuditLogsApi(session?.accessToken, adminToken || undefined),
        fetchAdminAnalyticsApi(session?.accessToken, adminToken || undefined),
        fetchAdminRoomsApi(session?.accessToken, adminToken || undefined)
      ]);
      setStats(nextStats);
      setAdminUsers(nextUsers);
      setAuditLogs(nextAudit);
      setAnalytics(nextAnalytics);
      setActiveRooms(nextRooms);
      setUnlocked(true);
      setStatusMessage("Admin dashboard unlocked.");
    } catch (err) {
      setUnlocked(false);
      setError(err instanceof Error ? err.message : "Admin dashboard failed to load.");
    } finally {
      setLoading(false);
    }
  }

  async function runAdminAction(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setStatusMessage("");
    try {
      await action();
      await loadDashboard();
      setStatusMessage("Admin action completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin action failed.");
    } finally {
      setLoading(false);
    }
  }

  function togglePermission(permission: AdminPermission) {
    setPermissionDraft((current) =>
      current.includes(permission) ? current.filter((candidate) => candidate !== permission) : [...current, permission]
    );
  }

  function updateRatingDraft(userId: string, value: string) {
    setRatingDrafts((current) => ({ ...current, [userId]: value.replace(/[^\d]/g, "").slice(0, 4) }));
  }

  async function applyRating(user: AdminUserSummary) {
    const rating = Number(ratingDrafts[user.profile.id] || user.profile.rating);
    await updateUserRatingApi(session?.accessToken, adminToken || undefined, user.profile.id, rating, ratingReason);
  }

  const credentialsReady = Boolean(session?.accessToken || adminToken.trim());

  return (
    <main className="app admin-screen plus-screen">
      <section className="hero-panel admin-hero">
        <div className="hero-copy">
          <div className="brand-row">
            <BrandLogo />
            <span>GeoDuel Admin</span>
          </div>
          <h1>Operations dashboard</h1>
          <p>Unlock with an owner/admin account or the private admin password, then manage users, rooms, analytics, and Elo safely.</p>
        </div>
        <div className="hero-actions">
          <button className="icon-text-button" type="button" onClick={onBack}>
            <Home aria-hidden="true" size={18} />
            Home
          </button>
        </div>
      </section>

      <section className="admin-grid">
        <AuthPanel session={session} profile={profile} onAuthSuccess={onAuthSuccess} onSignOut={onSignOut} />
        <section className="glass-panel admin-token-card">
          <p className="eyebrow">Protected access</p>
          <h2>Unlock operations</h2>
          <p>Use your owner/admin login, or enter the private admin password configured on Render. Management tools stay hidden until unlock succeeds.</p>
          <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} type="password" placeholder="Admin password" />
          <button className="primary-action compact" type="button" onClick={() => loadDashboard()} disabled={loading || !credentialsReady}>
            {loading ? "Checking access..." : unlocked ? "Refresh dashboard" : "Unlock dashboard"}
          </button>
          {error && <p className="form-message">{error}</p>}
          {statusMessage && <p className="success-message">{statusMessage}</p>}
        </section>
      </section>

      {!unlocked && (
        <section className="glass-panel admin-locked-card">
          <p className="eyebrow">Locked</p>
          <h2>Admin tools are hidden</h2>
          <p>
            The user list, Elo editor, roles, bans, force-end controls, analytics, and audit logs only render after the
            backend confirms admin access.
          </p>
        </section>
      )}

      {unlocked && (
        <nav className="admin-tabs" aria-label="Admin dashboard sections">
          {[
            ["overview", "Overview"],
            ["users", "Users & Elo"],
            ["rooms", "Active Rooms"],
            ["audit", "Audit Log"]
          ].map(([value, label]) => (
            <button
              key={value}
              className={activeAdminTab === value ? "selected" : ""}
              type="button"
              onClick={() => setActiveAdminTab(value as typeof activeAdminTab)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {unlocked && activeAdminTab === "overview" && (
      <section className="glass-panel admin-stats-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Live product metrics</p>
            <h2>Server snapshot</h2>
          </div>
          <span className={`status-badge ${stats?.serverHealth === "ok" ? "health-ok" : "health-warn"}`}>
            {stats?.serverHealth ?? "locked"}
          </span>
        </div>
        <div className="stat-grid wide admin-stat-grid">
          <Metric label="Total users" value={stats?.totalUsers ?? 0} />
          <Metric label="Active users" value={stats?.activeUsers ?? 0} />
          <Metric label="Games played" value={stats?.totalGamesPlayed ?? 0} />
          <Metric label="Active rooms" value={stats?.activeRooms ?? 0} />
          <Metric label="Ranked games" value={stats?.rankedGames ?? 0} />
          <Metric label="Practice games" value={stats?.practiceGames ?? 0} />
          <Metric label="Avg duration" value={formatShortTime(stats?.averageGameDurationMs ?? 0)} />
          <Metric label="Health" value={stats?.serverHealth ?? "locked"} />
        </div>
        <div className="admin-overview-grid">
          <div className="region-meter-list">
            <h3>Region usage</h3>
            {(stats?.mostUsedRegions ?? []).length === 0 && <p className="empty-history">No region data yet.</p>}
            {(stats?.mostUsedRegions ?? []).map((region) => (
              <div className="region-meter" key={region.region}>
                <span>{COUNTRY_POOL_LABELS[region.region as GameSettings["countryPool"]] ?? region.region}</span>
                <strong>{region.count}</strong>
              </div>
            ))}
          </div>
          <div className="region-meter-list">
            <h3>Analytics events</h3>
            <div className="region-meter">
              <span>Game starts</span>
              <strong>{analytics?.gameStarts ?? 0}</strong>
            </div>
            <div className="region-meter">
              <span>Completed matches</span>
              <strong>{analytics?.completedMatches ?? 0}</strong>
            </div>
            {(analytics?.eventsByName ?? []).slice(0, 6).map((event) => (
              <div className="region-meter" key={event.event}>
                <span>{event.event.replace(/_/g, " ")}</span>
                <strong>{event.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {unlocked && activeAdminTab === "users" && (
      <section className="glass-panel admin-stats-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">User management</p>
            <h2>Roles, bans, and support actions</h2>
          </div>
          <span className="status-badge">
            <Shield aria-hidden="true" size={14} />
            Server protected
          </span>
        </div>
        <div className="admin-search-row">
          <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search users by display name" />
          <button className="primary-action compact" type="button" onClick={() => loadDashboard(userQuery)} disabled={loading}>
            Search users
          </button>
        </div>
        <div className="admin-role-editor">
          <select value={roleDraft} onChange={(event) => setRoleDraft(event.target.value as AdminRole)}>
            {ADMIN_ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <div className="permission-grid">
            {ADMIN_PERMISSION_OPTIONS.map((permission) => (
              <button
                key={permission}
                type="button"
                className={permissionDraft.includes(permission) ? "toggle selected" : "toggle"}
                onClick={() => togglePermission(permission)}
              >
                {permission.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Elo edit reason</span>
          <input value={ratingReason} onChange={(event) => setRatingReason(event.target.value)} placeholder="Reason shown in audit log" />
        </label>
        <div className="admin-user-list">
          {adminUsers.map((user) => (
            <article className="admin-user-row" key={user.profile.id}>
              <div>
                <strong>{user.profile.name}</strong>
                <span>
                  {user.profile.rating} Elo · {user.profile.presence} · {user.roles.join(", ") || "no role"}
                  {user.banned ? ` · banned: ${user.banReason}` : ""}
                </span>
              </div>
              <div className="mini-actions">
                <input
                  className="elo-edit-input"
                  value={ratingDrafts[user.profile.id] ?? String(user.profile.rating)}
                  onChange={(event) => updateRatingDraft(user.profile.id, event.target.value)}
                  inputMode="numeric"
                  aria-label={`Edit Elo for ${user.profile.name}`}
                />
                <button
                  className="primary-action compact"
                  type="button"
                  onClick={() => runAdminAction(() => applyRating(user))}
                  disabled={loading}
                >
                  Save Elo
                </button>
                <button
                  className="secondary-action compact"
                  type="button"
                  onClick={() =>
                    runAdminAction(() =>
                      setAdminRoleApi(session?.accessToken, adminToken || undefined, user.profile.id, roleDraft, permissionDraft)
                    )
                  }
                  disabled={loading}
                >
                  Assign role
                </button>
                {user.roles.map((role) => (
                  <button
                    className="ghost-action compact"
                    type="button"
                    key={role}
                    onClick={() => runAdminAction(() => removeAdminRoleApi(session?.accessToken, adminToken || undefined, user.profile.id, role))}
                    disabled={loading}
                  >
                    Remove {role}
                  </button>
                ))}
                {user.banned ? (
                  <button
                    className="primary-action compact"
                    type="button"
                    onClick={() => runAdminAction(() => unbanUserApi(session?.accessToken, adminToken || undefined, user.profile.id))}
                    disabled={loading}
                  >
                    Unban
                  </button>
                ) : (
                  <button
                    className="danger-action compact"
                    type="button"
                    onClick={() =>
                      runAdminAction(() =>
                        banUserApi(session?.accessToken, adminToken || undefined, user.profile.id, "Admin moderation action")
                      )
                    }
                    disabled={loading}
                  >
                    Ban
                  </button>
                )}
              </div>
            </article>
          ))}
          {adminUsers.length === 0 && <p className="empty-history">Load the dashboard or search for users.</p>}
        </div>
      </section>
      )}

      {unlocked && activeAdminTab === "rooms" && (
        <section className="glass-panel admin-stats-card">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Active rooms</p>
              <h2>Live match controls</h2>
            </div>
            <span className="status-badge">{activeRooms.length} rooms</span>
          </div>
          <div className="admin-user-list">
            {activeRooms.map((room) => (
              <article className="admin-user-row admin-room-row" key={room.roomCode}>
                <div>
                  <strong>{room.roomCode}</strong>
                  <span>
                    {room.matchType} · {room.status}/{room.phase} · Round {room.roundNumber} · {COUNTRY_POOL_LABELS[room.countryPool]}
                  </span>
                  <span>{room.players.map((player) => `${player.name}${player.isConnected ? "" : " disconnected"}`).join(" vs ") || "No players"}</span>
                </div>
                <div className="mini-actions">
                  {room.players.map((player) => (
                    <button
                      className="ghost-action compact"
                      type="button"
                      key={player.id}
                      onClick={() => runAdminAction(() => kickPlayerApi(session?.accessToken, adminToken || undefined, room.roomCode, player.id))}
                      disabled={loading}
                    >
                      Kick {player.name}
                    </button>
                  ))}
                  <button
                    className="danger-action compact"
                    type="button"
                    onClick={() => runAdminAction(() => forceEndRoomApi(session?.accessToken, adminToken || undefined, room.roomCode))}
                    disabled={loading}
                  >
                    Force end game
                  </button>
                </div>
              </article>
            ))}
            {activeRooms.length === 0 && <p className="empty-history">No active rooms right now.</p>}
          </div>
        </section>
      )}

      {unlocked && activeAdminTab === "audit" && (
      <section className="glass-panel admin-stats-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Audit log</p>
            <h2>Administrative actions</h2>
          </div>
          <span className="status-badge">{auditLogs.length} events</span>
        </div>
        <div className="history-list">
          {auditLogs.map((entry) => (
            <article className="history-entry" key={entry.id}>
              <div>
                <strong>{entry.action.replace(/_/g, " ")}</strong>
                <span>
                  Actor {entry.actorUserId || "system"} · Target {entry.targetUserId || "none"}
                </span>
              </div>
              <small>{new Date(entry.createdAt).toLocaleString()}</small>
            </article>
          ))}
          {auditLogs.length === 0 && <p className="empty-history">No audit events loaded.</p>}
        </div>
      </section>
      )}
    </main>
  );
}

function PracticeSetup({
  settings,
  setSettings,
  playerName,
  onPlayerNameChange,
  onStart,
  isConnected
}: {
  settings: GameSettings;
  setSettings: Dispatch<SetStateAction<GameSettings>>;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onStart: () => void;
  isConnected: boolean;
}) {
  return (
    <section className="practice-setup">
      <div className="glass-panel practice-brief">
        <p className="eyebrow">Solo lab</p>
        <h2>Practice setup</h2>
        <p>
          Train against the same country pools, map modes, spelling rules, and assist settings used in duel rooms.
          Practice stays unranked.
        </p>
        <div className="rule-pills">
          <span>{COUNTRY_POOL_LABELS[settings.countryPool]}</span>
          <span>{settings.mapMode === "outline" ? "outline map" : "neighbor map"}</span>
          <span>{settings.forgivingSpellingEnabled ? "forgiving spelling" : "strict spelling"}</span>
          <span>{settings.showCountryMenuEnabled ? "country assist on" : "country assist off"}</span>
        </div>
      </div>

      <section className="glass-panel practice-card">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Training rules</p>
            <h2>Customize practice</h2>
          </div>
          <span className="status-badge">Unranked</span>
        </div>

        <div className="settings-matrix practice-settings">
          <label className="field">
            <span>Player name</span>
            <input value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} maxLength={18} />
          </label>

          <SettingButtons
            label="Timer"
            options={TIMER_OPTIONS}
            value={settings.timerSeconds}
            onChange={(timerSeconds) => setSettings((current) => ({ ...current, timerSeconds }))}
          />

          <SettingButtons
            label="Skip penalty"
            options={PENALTY_OPTIONS.map((value) => ({ label: `${value}s`, value }))}
            value={settings.skipPenaltySeconds}
            onChange={(skipPenaltySeconds) => setSettings((current) => ({ ...current, skipPenaltySeconds }))}
          />

          <SettingButtons
            label="Wrong penalty"
            options={WRONG_PENALTY_OPTIONS.map((value) => ({ label: `${value}s`, value }))}
            value={settings.wrongPenaltySeconds}
            onChange={(wrongPenaltySeconds) => setSettings((current) => ({ ...current, wrongPenaltySeconds }))}
          />

          <label className="field">
            <span>Country pool</span>
            <select
              value={settings.countryPool}
              onChange={(event) =>
                setSettings((current) => ({ ...current, countryPool: event.target.value as GameSettings["countryPool"] }))
              }
            >
              {Object.entries(COUNTRY_POOL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="toggle-row">
            <button
              type="button"
              className={settings.mapMode === "context" ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, mapMode: "context" }))}
            >
              Neighbor map
            </button>
            <button
              type="button"
              className={settings.mapMode === "outline" ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, mapMode: "outline" }))}
            >
              Outline map
            </button>
          </div>

          <div className="toggle-row">
            <button
              type="button"
              className={settings.forgivingSpellingEnabled ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, forgivingSpellingEnabled: !current.forgivingSpellingEnabled }))}
            >
              Spelling {settings.forgivingSpellingEnabled ? "forgiving" : "strict"}
            </button>
            <button
              type="button"
              className={settings.showCountryMenuEnabled ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, showCountryMenuEnabled: !current.showCountryMenuEnabled }))}
            >
              Country assist {settings.showCountryMenuEnabled ? "on" : "off"}
            </button>
          </div>

          <div className="toggle-row">
            <button
              type="button"
              className={settings.aliasesEnabled ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, aliasesEnabled: !current.aliasesEnabled }))}
            >
              Aliases {settings.aliasesEnabled ? "on" : "off"}
            </button>
            <button
              type="button"
              className={settings.soundEnabled ? "toggle selected" : "toggle"}
              onClick={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
            >
              {settings.soundEnabled ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}
              Sound
            </button>
          </div>
        </div>

        <button className="primary-action" type="button" onClick={onStart} disabled={!isConnected} title="Start practice">
          <Play aria-hidden="true" size={20} />
          Launch practice
        </button>
      </section>
    </section>
  );
}

function ProductSettingsScreen({
  settings,
  setSettings,
  isConnected,
  authSession,
  guestId
}: {
  settings: GameSettings;
  setSettings: Dispatch<SetStateAction<GameSettings>>;
  isConnected: boolean;
  authSession: AuthSession | null;
  guestId: string;
}) {
  return (
    <section className="glass-panel product-settings-screen">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Game and connection preferences</h2>
        </div>
        <span className={`status-badge ${isConnected ? "health-ok" : "health-warn"}`}>{isConnected ? "Server online" : "Connecting"}</span>
      </div>

      <div className="settings-matrix">
        <label className="field">
          <span>Backend URL</span>
          <input value={import.meta.env.VITE_SERVER_URL || "Same-origin / localhost"} readOnly />
        </label>
        <label className="field">
          <span>Account</span>
          <input value={authSession ? authSession.user.email : `${guestId} / guest mode`} readOnly />
        </label>
        <label className="field">
          <span>Default country pool</span>
          <select
            value={settings.countryPool}
            onChange={(event) =>
              setSettings((current) => ({ ...current, countryPool: event.target.value as GameSettings["countryPool"] }))
            }
          >
            {Object.entries(COUNTRY_POOL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="toggle-row">
          <button
            type="button"
            className={settings.soundEnabled ? "toggle selected" : "toggle"}
            onClick={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
          >
            Sound {settings.soundEnabled ? "on" : "off"}
          </button>
          <button
            type="button"
            className={settings.aliasesEnabled ? "toggle selected" : "toggle"}
            onClick={() => setSettings((current) => ({ ...current, aliasesEnabled: !current.aliasesEnabled }))}
          >
            Aliases {settings.aliasesEnabled ? "on" : "off"}
          </button>
        </div>
        <div className="toggle-row">
          <button
            type="button"
            className={settings.forgivingSpellingEnabled ? "toggle selected" : "toggle"}
            onClick={() => setSettings((current) => ({ ...current, forgivingSpellingEnabled: !current.forgivingSpellingEnabled }))}
          >
            Spelling {settings.forgivingSpellingEnabled ? "forgiving" : "strict"}
          </button>
          <button
            type="button"
            className={settings.showCountryMenuEnabled ? "toggle selected" : "toggle"}
            onClick={() => setSettings((current) => ({ ...current, showCountryMenuEnabled: !current.showCountryMenuEnabled }))}
          >
            Country assist {settings.showCountryMenuEnabled ? "on" : "off"}
          </button>
        </div>
      </div>
    </section>
  );
}

function FriendsAndSearchScreen({
  authToken,
  currentProfile,
  onInviteFriend,
  onMessage
}: {
  authToken?: string;
  currentProfile: PlayerProfile;
  onInviteFriend: (friendUserId?: string) => void;
  onMessage: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [friends, setFriends] = useState<FriendsPayload | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PublicProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFriendIds, setPendingFriendIds] = useState<string[]>([]);

  async function refreshFriends() {
    if (!authToken) return;
    const nextFriends = await fetchFriends(authToken);
    setFriends(nextFriends);
    setPendingFriendIds(nextFriends?.outgoing.map((request) => request.toUserId) ?? []);
  }

  useEffect(() => {
    refreshFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      setResults((await searchUsers(query)).filter((profile) => profile.id !== currentProfile.id));
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [currentProfile.id, query]);

  async function addFriend(userId: string) {
    if (!authToken) {
      onMessage("Sign in to add friends.");
      return;
    }
    if (pendingFriendIds.includes(userId)) {
      onMessage("Friend request already sent.");
      return;
    }
    setPendingFriendIds((current) => [...new Set([...current, userId])]);
    setBusy(true);
    try {
      const result = await sendFriendRequestApi(authToken, userId);
      onMessage(result.message);
      await refreshFriends();
    } catch (err) {
      setPendingFriendIds((current) => current.filter((candidate) => candidate !== userId));
      onMessage(err instanceof Error ? err.message : "Friend request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function respond(requestId: string, accepted: boolean) {
    if (!authToken) return;
    setBusy(true);
    try {
      await respondFriendRequestApi(authToken, requestId, accepted);
      await refreshFriends();
    } finally {
      setBusy(false);
    }
  }

  async function remove(friendUserId: string) {
    if (!authToken) return;
    setBusy(true);
    try {
      await removeFriendApi(authToken, friendUserId);
      await refreshFriends();
    } finally {
      setBusy(false);
    }
  }

  function getFriendRelation(userId: string): "friend" | "outgoing" | "incoming" | "none" {
    if ((friends?.friends ?? []).some((friend) => friend.userId === userId)) return "friend";
    if ((friends?.outgoing ?? []).some((request) => request.toUserId === userId) || pendingFriendIds.includes(userId)) return "outgoing";
    if ((friends?.incoming ?? []).some((request) => request.fromUserId === userId)) return "incoming";
    return "none";
  }

  if (!authToken) {
    return (
      <section className="glass-panel friends-screen">
        <p className="eyebrow">Friends</p>
        <h2>Sign in to search players and add friends</h2>
        <p>Friend requests, public profiles, and invites need a GeoDuel account.</p>
      </section>
    );
  }

  return (
    <section className="friends-layout">
      <section className="glass-panel friends-screen">
        <div className="panel-title">
          <div>
            <p className="eyebrow">User Search</p>
            <h2>Find GeoDuel players</h2>
          </div>
          <span className="status-badge">
            <Search aria-hidden="true" size={14} />
            Public profiles
          </span>
        </div>
        <label className="field">
          <span>Search by display name</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players" />
        </label>
        <div className="profile-card-list">
          {results.map((profile) => (
            <PublicProfileCard
              key={profile.id}
              profile={profile}
              onView={() => setSelectedProfile(profile)}
              onAddFriend={() => addFriend(profile.id)}
              onInvite={() => onInviteFriend(profile.id)}
              relation={getFriendRelation(profile.id)}
              busy={busy}
            />
          ))}
          {query.trim().length >= 2 && results.length === 0 && <p className="empty-history">No players found.</p>}
        </div>
      </section>

      <section className="glass-panel friends-screen">
        <div className="panel-title">
          <div>
            <p className="eyebrow">Friends</p>
            <h2>Requests and online friends</h2>
          </div>
          <button className="ghost-action compact" type="button" onClick={refreshFriends}>
            Refresh
          </button>
        </div>

        <FriendRequestList title="Incoming requests" requests={friends?.incoming ?? []} onRespond={respond} busy={busy} />
        <FriendRequestList title="Sent requests" requests={friends?.outgoing ?? []} busy={busy} />

        <div className="profile-card-list">
          {(friends?.friends ?? []).map((friend) => (
            <article className="mini-profile-card" key={friend.userId}>
              <div>
                <strong>{friend.profile.name}</strong>
                <span>
                  {friend.profile.rating} Elo · {friend.profile.title} · {friend.status}
                </span>
              </div>
              <div className="mini-actions">
                <button className="ghost-action compact" type="button" onClick={() => setSelectedProfile(friend.profile)}>
                  View
                </button>
                <button className="primary-action compact" type="button" onClick={() => onInviteFriend(friend.userId)}>
                  Invite
                </button>
                <button className="danger-action compact" type="button" onClick={() => remove(friend.userId)} disabled={busy}>
                  Remove
                </button>
              </div>
            </article>
          ))}
          {(friends?.friends ?? []).length === 0 && <p className="empty-history">No friends yet. Search for a player to send a request.</p>}
        </div>
      </section>

      {selectedProfile && <PublicProfileModal profile={selectedProfile} onClose={() => setSelectedProfile(null)} />}
    </section>
  );
}

function PublicProfileCard({
  profile,
  onView,
  onAddFriend,
  onInvite,
  relation,
  busy
}: {
  profile: PublicProfile;
  onView: () => void;
  onAddFriend: () => void;
  onInvite: () => void;
  relation: "friend" | "outgoing" | "incoming" | "none";
  busy: boolean;
}) {
  const friendButtonLabel =
    relation === "friend" ? "Friends" : relation === "outgoing" ? "Request sent" : relation === "incoming" ? "Respond in requests" : "Add friend";

  return (
    <article className="mini-profile-card">
      <div>
        <strong>{profile.name}</strong>
        <span>
          {profile.rating} Elo · {profile.title} · {profile.wins}-{profile.losses} · {profile.presence}
        </span>
      </div>
      <div className="mini-actions">
        <button className="ghost-action compact" type="button" onClick={onView}>
          View profile
        </button>
        <button className="secondary-action compact" type="button" onClick={onAddFriend} disabled={busy || relation !== "none"}>
          <UserPlus aria-hidden="true" size={16} />
          {friendButtonLabel}
        </button>
        <button className="primary-action compact" type="button" onClick={onInvite} disabled={profile.presence === "offline"}>
          Challenge
        </button>
      </div>
    </article>
  );
}

function FriendRequestList({
  title,
  requests,
  onRespond,
  busy
}: {
  title: string;
  requests: FriendsPayload["incoming"];
  onRespond?: (requestId: string, accepted: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="request-list">
      <h3>{title}</h3>
      {requests.map((request) => {
        const profile = onRespond ? request.fromProfile : request.toProfile;
        return (
          <article className="request-row" key={request.id}>
            <span>
              <strong>{profile.name}</strong>
              <small>{profile.rating} Elo</small>
            </span>
            {onRespond && (
              <div className="mini-actions">
                <button className="primary-action compact" type="button" onClick={() => onRespond(request.id, true)} disabled={busy}>
                  Accept
                </button>
                <button className="danger-action compact" type="button" onClick={() => onRespond(request.id, false)} disabled={busy}>
                  Decline
                </button>
              </div>
            )}
          </article>
        );
      })}
      {requests.length === 0 && <p className="empty-history">None right now.</p>}
    </div>
  );
}

function PublicProfileModal({ profile, onClose }: { profile: PublicProfile; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal public-profile-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Public profile</p>
            <h2>{profile.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close profile">
            <Check aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="stat-grid wide">
          <Metric label="Elo" value={profile.rating} />
          <Metric label="Rank" value={profile.title} />
          <Metric label="Record" value={`${profile.wins}-${profile.losses}`} />
          <Metric label="Badges" value={profile.achievementsCount} />
        </div>
        <div className="achievement-grid compact-achievements">
          {ACHIEVEMENTS.map((achievement) => (
            <article className={`achievement-tile ${profile.achievements[achievement.id] ? "unlocked" : ""}`} key={achievement.id}>
              <Trophy aria-hidden="true" size={17} />
              <div>
                <strong>{achievement.title}</strong>
                <span>{achievement.description}</span>
              </div>
            </article>
          ))}
        </div>
        <HistoryPanel
          entries={profile.recentMatches.map((match) => ({
            id: match.id,
            roundNumber: 1,
            turnNumber: 1,
            countryId: "match",
            countryName: match.ranked ? "Ranked match" : "Unranked match",
            playerId: profile.id,
            playerName: profile.name,
            result: match.winnerId === profile.id ? "roundWin" : "timeout",
            elapsedMs: match.durationMs,
            penaltyMs: 0,
            wrongGuesses: 0,
            createdAt: match.completedAt
          }))}
        />
      </section>
    </div>
  );
}

function ProfileStrip({ profile }: { profile: PlayerProfile }) {
  return (
    <section className="profile-strip">
      <div>
        <p className="eyebrow">Ranked profile</p>
        <strong>{profile.name}</strong>
        <span>{getProfileTitle(profile)}</span>
      </div>
      <div className="profile-strip-metrics">
        <Metric label="Elo" value={profile.rating} />
        <Metric label="Record" value={`${profile.wins}-${profile.losses}`} />
        <Metric label="Badges" value={Object.keys(profile.achievements).length} />
      </div>
    </section>
  );
}

function ProfileScreen({
  profile,
  playerName,
  onPlayerNameChange,
  onSave
}: {
  profile: PlayerProfile;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onSave: () => void;
}) {
  const unlockedIds = new Set(Object.keys(profile.achievements));
  return (
    <section className="profile-layout">
      <div className="glass-panel profile-hero-card">
        <p className="eyebrow">Progression</p>
        <h2>{profile.name}</h2>
        <div className="rank-orbit">
          <div className="rank-orbit-core">
            <strong>{profile.rating}</strong>
            <span>Elo</span>
          </div>
        </div>
        <div className="profile-rank-summary">
          <strong>{getProfileTitle(profile)}</strong>
          <span>
            {profile.wins}-{profile.losses} record · {Object.keys(profile.achievements).length} badges
          </span>
        </div>
        <label className="field">
          <span>Display name</span>
          <input value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} maxLength={18} />
        </label>
        <button className="primary-action compact" type="button" onClick={onSave}>
          <Check aria-hidden="true" size={18} />
          Save profile
        </button>
      </div>

      <div className="glass-panel profile-detail-card">
        <p className="eyebrow">Career stats</p>
        <div className="stat-grid wide">
          <Metric label="Wins" value={profile.wins} />
          <Metric label="Losses" value={profile.losses} />
          <Metric label="Ranked" value={`${profile.rankedWins}-${profile.rankedLosses}`} />
          <Metric label="Win streak" value={profile.currentWinStreak} />
          <Metric label="Best answer streak" value={profile.bestAnswerStreak} />
          <Metric label="Correct" value={profile.totalCorrect} />
          <Metric label="Wrong" value={profile.totalWrong} />
          <Metric label="Skips" value={profile.totalSkips} />
        </div>
      </div>

      <div className="glass-panel achievement-card">
        <p className="eyebrow">Achievements</p>
        <div className="achievement-grid">
          {ACHIEVEMENTS.map((achievement) => (
            <article className={`achievement-tile ${unlockedIds.has(achievement.id) ? "unlocked" : ""}`} key={achievement.id}>
              <Trophy aria-hidden="true" size={19} />
              <div>
                <strong>{achievement.title}</strong>
                <span>{achievement.description}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function LeaderboardScreen({ entries, currentProfile }: { entries: LeaderboardEntry[]; currentProfile: PlayerProfile }) {
  const rows = entries.length > 0 ? entries : [profileToFallbackEntry(currentProfile)];
  return (
    <section className="glass-panel leaderboard-screen">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Leaderboard</p>
          <h2>Ranked GeoDuel rivals</h2>
        </div>
        <span className="status-badge">
          <Trophy aria-hidden="true" size={14} />
          Online-ready
        </span>
      </div>
      <div className="leaderboard-list">
        {rows.map((entry, index) => (
          <article className={`leaderboard-row ${entry.id === currentProfile.id ? "you" : ""}`} key={entry.id}>
            <strong>#{index + 1}</strong>
            <div>
              <span>{entry.name}</span>
              <small>{entry.title}</small>
            </div>
            <span>{entry.rating}</span>
            <span>
              {entry.wins}-{entry.losses}
            </span>
            <span>{entry.achievementsCount} badges</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProfileOverlay({
  profile,
  playerName,
  leaderboard,
  onPlayerNameChange,
  onSave,
  onClose
}: {
  profile: PlayerProfile;
  playerName: string;
  leaderboard: LeaderboardEntry[];
  onPlayerNameChange: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Progression snapshot</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close profile">
            <Check aria-hidden="true" size={18} />
          </button>
        </div>
        <ProfileScreen profile={profile} playerName={playerName} onPlayerNameChange={onPlayerNameChange} onSave={onSave} />
        <LeaderboardScreen entries={leaderboard} currentProfile={profile} />
      </section>
    </div>
  );
}

function LeaderboardOverlay({
  entries,
  currentProfile,
  onClose
}: {
  entries: LeaderboardEntry[];
  currentProfile: PlayerProfile;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal leaderboard-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Leaderboard</p>
            <h2>Ranked rivals</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close leaderboard">
            <Check aria-hidden="true" size={18} />
          </button>
        </div>
        <LeaderboardScreen entries={entries} currentProfile={currentProfile} />
      </section>
    </div>
  );
}

function EloChangeOverlay({ result, onContinue }: { result: MatchProgressResult; onContinue: () => void }) {
  const [displayRating, setDisplayRating] = useState(result.oldRating);
  const title = getProfileTitle(result.profile);
  const deltaLabel = `${result.ratingDelta >= 0 ? "+" : ""}${result.ratingDelta}`;

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const duration = 1300;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayRating(Math.round(result.oldRating + (result.newRating - result.oldRating) * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    setDisplayRating(result.oldRating);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [result.newRating, result.oldRating]);

  return (
    <div className="elo-overlay-backdrop" role="presentation">
      <section className={`elo-overlay-card ${result.ratingDelta >= 0 ? "positive" : "negative"}`} role="dialog" aria-modal="true">
        <p className="eyebrow">Ranked result</p>
        <h2>{result.ratingDelta >= 0 ? "Rating gained" : "Rating lost"}</h2>
        <div className="elo-animation-grid">
          <div>
            <span>Before</span>
            <strong>{result.oldRating}</strong>
          </div>
          <div className="elo-live-number">
            <em>{deltaLabel}</em>
            <strong>{displayRating}</strong>
          </div>
          <div>
            <span>After</span>
            <strong>{result.newRating}</strong>
          </div>
        </div>
        <div className="elo-title-row">
          <Trophy aria-hidden="true" size={18} />
          <span>{title}</span>
          <small>
            {result.profile.wins}-{result.profile.losses} record
          </small>
        </div>
        <button className="primary-action compact" type="button" onClick={onContinue}>
          Continue to results
        </button>
      </section>
    </div>
  );
}

function AchievementToasts({ achievements }: { achievements: UnlockedAchievement[] }) {
  if (achievements.length === 0) return null;

  return (
    <div className="achievement-toast-stack" aria-live="polite">
      {achievements.map((achievement) => (
        <article className="achievement-toast" key={`${achievement.id}-${achievement.unlockedAt}`}>
          <Trophy aria-hidden="true" size={20} />
          <div>
            <strong>Achievement unlocked</strong>
            <span>{achievement.title}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function SettingButtons({ label, options, value, onChange, disabled }: SettingButtonsProps) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="mini-segmented">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsPanel({ stats, remainingMs }: { stats?: PlayerStats; remainingMs?: number }) {
  const average = stats && stats.answered > 0 ? stats.totalAnswerMs / stats.answered : 0;

  return (
    <section className="glass-panel stat-card">
      <p className="eyebrow">Your stats</p>
      <div className="stat-grid">
        <Metric label="Correct" value={stats?.correct ?? 0} />
        <Metric label="Wrong" value={stats?.wrong ?? 0} />
        <Metric label="Skips" value={stats?.skips ?? 0} />
        <Metric label="Best streak" value={stats?.bestStreak ?? 0} />
        <Metric label="Avg answer" value={formatShortTime(average)} />
        <Metric label="Remaining" value={formatTimer(remainingMs ?? 0)} />
      </div>
    </section>
  );
}

function CurrentTurnPanel({
  currentTurn,
  canAnswer,
  activeName,
  poolLabel,
  menuEnabled
}: {
  currentTurn: NonNullable<PublicGameState["currentTurn"]>;
  canAnswer: boolean;
  activeName?: string;
  poolLabel: string;
  menuEnabled: boolean;
}) {
  return (
    <section className={`current-turn-panel ${canAnswer ? "you" : ""}`}>
      <div>
        <span className="active-chip inline">{canAnswer ? "Your turn" : `${activeName ?? "Opponent"} on move`}</span>
        <strong>
          Current country — {currentTurn.wrongGuesses} wrong {currentTurn.wrongGuesses === 1 ? "guess" : "guesses"}
        </strong>
      </div>
      <div className="turn-meta">
        <span>{poolLabel}</span>
        <span>{formatShortTime(currentTurn.elapsedMs)}</span>
        {currentTurn.penaltyMs > 0 && <span>-{formatPenalty(currentTurn.penaltyMs)} penalties</span>}
        {menuEnabled && <span>autocomplete on</span>}
      </div>
    </section>
  );
}

function CountryAnswerInput({
  value,
  onChange,
  canAnswer,
  pending,
  pool,
  menuEnabled,
  placeholder
}: {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  canAnswer: boolean;
  pending: boolean;
  pool: GameSettings["countryPool"];
  menuEnabled: boolean;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const trimmedQuery = value.trim();
  const countryPool = useMemo(
    () => (pool === "world" ? COUNTRIES : COUNTRIES.filter((country) => country.continent === pool)),
    [pool]
  );
  const suggestions = useMemo(() => {
    if (!menuEnabled || !focused || !canAnswer || pending || trimmedQuery.length < 2) return [];

    const normalizedQuery = normalizeCountryMenuSearch(trimmedQuery);
    return countryPool
      .filter((country) => {
        const searchableNames = [country.name, ...(country.aliases ?? [])];
        return searchableNames.some((name) => normalizeCountryMenuSearch(name).includes(normalizedQuery));
      })
      .slice(0, 12);
  }, [canAnswer, countryPool, focused, menuEnabled, pending, trimmedQuery]);

  return (
    <>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder={placeholder}
        disabled={!canAnswer || pending}
        autoFocus={canAnswer}
        aria-autocomplete={menuEnabled ? "list" : "none"}
        aria-expanded={suggestions.length > 0}
      />

      {suggestions.length > 0 && (
        <div className="country-autocomplete" role="listbox" aria-label="Country suggestions">
          <div className="country-autocomplete-meta">
            <span>Country assist</span>
            <small>{COUNTRY_POOL_LABELS[pool]}</small>
          </div>
          <div className="country-autocomplete-list">
            {suggestions.map((country) => (
              <button
                key={country.id}
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(country.name);
                  setFocused(false);
                }}
              >
                {country.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function normalizeCountryMenuSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryPanel({ entries }: { entries: PublicGameState["history"] }) {
  return (
    <section className="glass-panel history-card">
      <div className="panel-title slim">
        <p className="eyebrow">Round history</p>
        <History aria-hidden="true" size={17} />
      </div>
      <div className="history-list">
        {entries.length === 0 && <p className="empty-history">No actions yet.</p>}
        {entries.slice(0, 10).map((entry) => (
          <article className={`history-entry ${entry.result}`} key={entry.id}>
            <div>
              <strong>{entry.countryName}</strong>
              <span>
                R{entry.roundNumber} · {entry.playerName} · {historyResultLabel(entry.result)} after {entry.wrongGuesses} wrong{" "}
                {entry.wrongGuesses === 1 ? "guess" : "guesses"}
              </span>
            </div>
            <small>
              {formatShortTime(entry.elapsedMs)}
              {entry.penaltyMs > 0 ? ` · -${formatPenalty(entry.penaltyMs)}` : ""}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function historyResultLabel(result: PublicGameState["history"][number]["result"]): string {
  if (result === "correct") return "correct";
  if (result === "skip") return "skipped";
  if (result === "timeout") return "failed";
  if (result === "roundWin") return "round win";
  return "resolved";
}

function GameOverPanel({
  winnerName,
  loserName,
  stats,
  players,
  onRestart,
  pending,
  isPractice,
  isRanked,
  progressResult,
  adPlaceholder
}: {
  winnerName?: string;
  loserName?: string;
  stats: PublicGameState["stats"];
  players: PublicGameState["players"];
  onRestart: () => void;
  pending: boolean;
  isPractice: boolean;
  isRanked: boolean;
  progressResult: MatchProgressResult | null;
  adPlaceholder?: ReactNode;
}) {
  return (
    <section className="game-over">
      <div>
        <p className="eyebrow">Match complete</p>
        <h2>{isPractice ? "Practice run complete" : `${winnerName ?? "Winner"} wins`}</h2>
        {!isPractice && <p>{loserName ?? "Opponent"} ran out of time.</p>}
      </div>

      {progressResult?.ranked && (
        <div className={`rating-change ${progressResult.ratingDelta >= 0 ? "positive" : "negative"}`}>
          <span>Ranked Elo</span>
          <strong>
            {progressResult.ratingDelta >= 0 ? "+" : ""}
            {progressResult.ratingDelta}
          </strong>
          <small>
            {progressResult.oldRating} → {progressResult.newRating}
          </small>
        </div>
      )}

      <div className="final-stats">
        {players.map((player) => {
          const playerStats = stats[player.id];
          return (
            <div className="final-stat-row" key={player.id}>
              <span>
                <Medal aria-hidden="true" size={17} />
                {player.name}
              </span>
              <strong>
                {playerStats?.correct ?? 0} correct · {playerStats?.bestStreak ?? 0} best streak
              </strong>
            </div>
          );
        })}
      </div>

      {isRanked ? (
        <p className="form-message">Ranked rematches use matchmaking, so your next opponent stays fair.</p>
      ) : (
        <button className="primary-action compact" type="button" onClick={onRestart} disabled={pending} title="Restart match">
          <RotateCcw aria-hidden="true" size={19} />
          Rematch
        </button>
      )}
      {adPlaceholder}
    </section>
  );
}

function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Quick briefing</p>
            <h2 id="help-title">How to play</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close help">
            <Check aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="help-grid">
          <p>Player 1 creates a room and shares the invite link. Player 2 joins from another browser anywhere the deployed server is reachable.</p>
          <p>Only the active player can answer. Their server-owned clock runs until they answer correctly, skip, or run out of time.</p>
          <p>Correct answers switch turns after a short reveal. Skips reveal the country and subtract the selected penalty.</p>
          <p>Practice Mode starts with one player. Best of X keeps playing rounds until someone reaches the target score.</p>
        </div>
      </section>
    </div>
  );
}

function getStatusLabel(state: PublicGameState | null, activeName?: string): string {
  if (!state) return "Not connected";
  if (state.phase === "paused") return "Paused for reconnect";
  if (state.phase === "reveal") return "Country reveal";
  if (state.status === "gameOver") return "Game over";
  if (state.status === "roundOver") return "Round over";
  if (state.status === "lobby") return "Lobby";
  return `${activeName ?? "Player"} is guessing`;
}

function getMatchTitle(settings: GameSettings): string {
  if (settings.mode === "practice") return "Practice Mode";
  const base = settings.mode === "noSkip" ? "No Skip Duel" : "Classic Duel";
  return settings.roundsToWin > 1 ? `${base}, Best of ${settings.roundsToWin}` : base;
}

function profileToFallbackEntry(profile: PlayerProfile): LeaderboardEntry {
  return {
    id: profile.id,
    name: profile.name,
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    bestStreak: profile.bestAnswerStreak,
    achievementsCount: Object.keys(profile.achievements).length,
    title: getProfileTitle(profile),
    isYou: true,
    observedAt: Date.now()
  };
}

function getInviteLink(roomCode: string): string {
  return `${window.location.origin}/join/${roomCode}`;
}
