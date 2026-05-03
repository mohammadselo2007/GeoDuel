export function formatTimer(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatShortTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0.0s";
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function formatPenalty(milliseconds: number): string {
  if (!milliseconds) return "0s";
  return `${Math.round(milliseconds / 1000)}s`;
}
