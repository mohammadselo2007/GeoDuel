import type { PlayerProfileSummary, PublicGameState } from "../../../shared/types";

export type AchievementId = "ten-streak" | "clutch-win" | "three-win-streak" | "first-perfect" | "no-skip-victory";

export interface AchievementDefinition {
  id: AchievementId;
  title: string;
  description: string;
}

export interface UnlockedAchievement extends AchievementDefinition {
  unlockedAt: number;
}

export interface PlayerProfile {
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
  achievements: Partial<Record<AchievementId, number>>;
  lastRatingDelta: number;
  updatedAt: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  bestStreak: number;
  achievementsCount: number;
  title: string;
  isYou?: boolean;
  observedAt: number;
}

export interface MatchProgressResult {
  profile: PlayerProfile;
  unlocked: UnlockedAchievement[];
  ratingDelta: number;
  oldRating: number;
  newRating: number;
  ranked: boolean;
  won: boolean;
  lost: boolean;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "ten-streak",
    title: "Atlas Flow",
    description: "Get 10 correct answers in a row."
  },
  {
    id: "clutch-win",
    title: "Last Second Legend",
    description: "Win a match with under 5 seconds left."
  },
  {
    id: "three-win-streak",
    title: "Hot Streak",
    description: "Win 3 games in a row."
  },
  {
    id: "first-perfect",
    title: "Perfect Route",
    description: "Win with no wrong answers and no skips."
  },
  {
    id: "no-skip-victory",
    title: "No Escape",
    description: "Win a No Skip match."
  }
];

const PROFILE_KEY = "geoduel:profile-cache";
const LEADERBOARD_KEY = "geoduel:leaderboard-cache";
const STARTING_RATING = 1000;
const K_FACTOR = 32;

export function getProfile(clientId: string, fallbackName: string): PlayerProfile {
  const stored = readJson<PlayerProfile>(PROFILE_KEY);
  if (stored?.id === clientId) {
    return normalizeProfile(stored, clientId, fallbackName);
  }

  return normalizeProfile(undefined, clientId, fallbackName);
}

export function saveProfile(profile: PlayerProfile): PlayerProfile {
  const normalized = normalizeProfile(profile, profile.id, profile.name);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
  upsertLeaderboard(profileToLeaderboardEntry(normalized, true));
  return normalized;
}

export function getProfileSummary(profile: PlayerProfile): PlayerProfileSummary {
  return {
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    bestStreak: profile.bestAnswerStreak,
    achievementsCount: Object.keys(profile.achievements).length,
    title: getProfileTitle(profile)
  };
}

export function getProfileTitle(profile: PlayerProfile): string {
  if (profile.rating >= 1600) return "World Class";
  if (profile.rating >= 1350) return "Map Shark";
  if (profile.rating >= 1150) return "Border Runner";
  if (profile.wins > 0) return "Rising Explorer";
  return "Unranked Explorer";
}

export function getLeaderboard(): LeaderboardEntry[] {
  return readJson<LeaderboardEntry[]>(LEADERBOARD_KEY) ?? [];
}

export function upsertLeaderboard(entry: LeaderboardEntry) {
  const entries = getLeaderboard().filter((candidate) => candidate.id !== entry.id);
  entries.push(entry);
  entries.sort((a, b) => b.rating - a.rating || b.wins - a.wins || b.achievementsCount - a.achievementsCount);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, 25)));
}

export function rememberObservedPlayers(state: PublicGameState, currentProfile: PlayerProfile) {
  for (const player of state.players) {
    upsertLeaderboard({
      id: player.id,
      name: player.id === currentProfile.id ? currentProfile.name : player.name,
      rating: player.id === currentProfile.id ? currentProfile.rating : player.rating,
      wins: player.id === currentProfile.id ? currentProfile.wins : player.wins,
      losses: player.id === currentProfile.id ? currentProfile.losses : player.losses,
      bestStreak: player.id === currentProfile.id ? currentProfile.bestAnswerStreak : player.bestStreak,
      achievementsCount:
        player.id === currentProfile.id ? Object.keys(currentProfile.achievements).length : player.achievementsCount,
      title: player.id === currentProfile.id ? getProfileTitle(currentProfile) : player.title,
      isYou: player.id === currentProfile.id,
      observedAt: Date.now()
    });
  }
}

export function applyCompletedMatch(profile: PlayerProfile, state: PublicGameState, playerId: string): MatchProgressResult {
  const next = normalizeProfile(profile, profile.id, profile.name);
  const ownStats = state.stats[playerId];
  const won = state.matchWinnerId === playerId;
  const lost = state.matchLoserId === playerId;
  const multiplayer = state.settings.mode !== "practice" && state.players.length === 2;
  const ranked = Boolean(state.matchType === "ranked" && multiplayer && (won || lost));
  const oldRating = next.rating;
  let ratingDelta = 0;

  next.totalCorrect += ownStats?.correct ?? 0;
  next.totalWrong += ownStats?.wrong ?? 0;
  next.totalSkips += ownStats?.skips ?? 0;
  next.bestAnswerStreak = Math.max(next.bestAnswerStreak, ownStats?.bestStreak ?? 0);

  if (won || lost) {
    next.gamesPlayed += 1;
  }

  if (won) {
    next.wins += 1;
    next.currentWinStreak += 1;
    next.bestWinStreak = Math.max(next.bestWinStreak, next.currentWinStreak);
  }

  if (lost) {
    next.losses += 1;
    next.currentWinStreak = 0;
  }

  if (ranked) {
    const opponent = state.players.find((player) => player.id !== playerId);
    ratingDelta = calculateEloDelta(next.rating, opponent?.rating ?? STARTING_RATING, won ? 1 : 0);
    next.rating = Math.max(100, next.rating + ratingDelta);
    next.lastRatingDelta = ratingDelta;
    if (won) {
      next.rankedWins += 1;
    } else {
      next.rankedLosses += 1;
    }
  } else {
    next.lastRatingDelta = 0;
  }

  const perfectWin = won && (ownStats?.correct ?? 0) > 0 && (ownStats?.wrong ?? 0) === 0 && (ownStats?.skips ?? 0) === 0;
  if (perfectWin) {
    next.perfectGames += 1;
  }

  if (won && state.settings.mode === "noSkip") {
    next.noSkipWins += 1;
  }

  next.updatedAt = Date.now();
  const unlocked = unlockAchievements(next, state, playerId, won, perfectWin);
  const saved = saveProfile(next);
  rememberObservedPlayers(state, saved);

  return {
    profile: saved,
    unlocked,
    ratingDelta,
    oldRating,
    newRating: saved.rating,
    ranked,
    won,
    lost
  };
}

export function profileToLeaderboardEntry(profile: PlayerProfile, isYou = false): LeaderboardEntry {
  return {
    id: profile.id,
    name: profile.name,
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    bestStreak: profile.bestAnswerStreak,
    achievementsCount: Object.keys(profile.achievements).length,
    title: getProfileTitle(profile),
    isYou,
    observedAt: Date.now()
  };
}

function unlockAchievements(
  profile: PlayerProfile,
  state: PublicGameState,
  playerId: string,
  won: boolean,
  perfectWin: boolean
): UnlockedAchievement[] {
  const ownStats = state.stats[playerId];
  const remainingMs = state.timers[playerId] ?? 0;
  const checks: Array<[AchievementId, boolean]> = [
    ["ten-streak", (ownStats?.bestStreak ?? 0) >= 10 || profile.bestAnswerStreak >= 10],
    ["clutch-win", won && remainingMs > 0 && remainingMs < 5000],
    ["three-win-streak", profile.currentWinStreak >= 3],
    ["first-perfect", perfectWin && profile.perfectGames === 1],
    ["no-skip-victory", won && state.settings.mode === "noSkip"]
  ];

  const unlocked: UnlockedAchievement[] = [];
  for (const [id, earned] of checks) {
    if (!earned || profile.achievements[id]) continue;
    const definition = ACHIEVEMENTS.find((achievement) => achievement.id === id);
    if (!definition) continue;
    const unlockedAt = Date.now();
    profile.achievements[id] = unlockedAt;
    unlocked.push({ ...definition, unlockedAt });
  }

  return unlocked;
}

function calculateEloDelta(playerRating: number, opponentRating: number, score: 0 | 1): number {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  return Math.round(K_FACTOR * (score - expected));
}

function normalizeProfile(profile: PlayerProfile | undefined, clientId: string, fallbackName: string): PlayerProfile {
  return {
    id: clientId,
    name: (profile?.name || fallbackName || "Player").trim().slice(0, 18),
    rating: clamp(profile?.rating, 100, 3000, STARTING_RATING),
    wins: clamp(profile?.wins, 0, 9999, 0),
    losses: clamp(profile?.losses, 0, 9999, 0),
    rankedWins: clamp(profile?.rankedWins, 0, 9999, 0),
    rankedLosses: clamp(profile?.rankedLosses, 0, 9999, 0),
    gamesPlayed: clamp(profile?.gamesPlayed, 0, 9999, 0),
    totalCorrect: clamp(profile?.totalCorrect, 0, 999999, 0),
    totalWrong: clamp(profile?.totalWrong, 0, 999999, 0),
    totalSkips: clamp(profile?.totalSkips, 0, 999999, 0),
    currentWinStreak: clamp(profile?.currentWinStreak, 0, 9999, 0),
    bestWinStreak: clamp(profile?.bestWinStreak, 0, 9999, 0),
    bestAnswerStreak: clamp(profile?.bestAnswerStreak, 0, 9999, 0),
    perfectGames: clamp(profile?.perfectGames, 0, 9999, 0),
    noSkipWins: clamp(profile?.noSkipWins, 0, 9999, 0),
    achievements: profile?.achievements ?? {},
    lastRatingDelta: clamp(profile?.lastRatingDelta, -999, 999, 0),
    updatedAt: profile?.updatedAt ?? Date.now()
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function readJson<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}
