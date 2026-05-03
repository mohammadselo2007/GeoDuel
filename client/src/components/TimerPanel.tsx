import { Crown, Flame, PlugZap, ShieldAlert, Trophy } from "lucide-react";
import type { CSSProperties } from "react";
import type { GameStatus, PlayerStats, PublicPlayer } from "../../../shared/types";
import { formatTimer } from "../lib/format";

interface TimerPanelProps {
  player: PublicPlayer;
  remainingMs: number;
  isActive: boolean;
  isYou: boolean;
  status: GameStatus;
  score: number;
  roundsToWin: number;
  stats?: PlayerStats;
  isPractice?: boolean;
}

export function TimerPanel({
  player,
  remainingMs,
  isActive,
  isYou,
  status,
  score,
  roundsToWin,
  stats,
  isPractice
}: TimerPanelProps) {
  const isLow = remainingMs <= 10_000 && status === "playing";
  const progress = Math.min(1, Math.max(0, remainingMs / 300_000));
  const streak = stats?.currentStreak ?? 0;

  return (
    <section className={`timer-panel ${isActive ? "active" : ""} ${isLow ? "low" : ""}`}>
      <div className="timer-topline">
        <div>
          <div className="timer-name-row">
            <span className="timer-name">{player.name}</span>
            {isYou && <span className="badge you">You</span>}
            {player.isHost && !isPractice && <Crown className="host-crown" aria-label="Host" size={16} />}
          </div>
          <div className="rating-line">
            <strong>{player.rating}</strong>
            <span>{player.title}</span>
            {!isPractice && <span>{player.wins}-{player.losses}</span>}
          </div>
          <span className={`connection-badge ${player.isConnected ? "online" : "offline"}`}>
            <PlugZap aria-hidden="true" size={13} />
            {isPractice ? "Solo practice" : player.isConnected ? "Live" : status === "gameOver" ? "Left" : "Reconnecting"}
          </span>
        </div>

        <div className="round-score" title="Rounds won">
          <Trophy aria-hidden="true" size={16} />
          {score}/{roundsToWin}
        </div>
      </div>

      <div className="clock-face" style={{ "--clock-progress": progress } as CSSProperties}>
        <div className="timer-value">{formatTimer(remainingMs)}</div>
        <div className="clock-label">{isActive ? "On move" : "Waiting"}</div>
      </div>

      <div className="timer-stats">
        <span>
          <Flame aria-hidden="true" size={15} />
          {streak} streak
        </span>
        <span>
          <ShieldAlert aria-hidden="true" size={15} />
          {stats?.wrong ?? 0} wrong
        </span>
      </div>
    </section>
  );
}
