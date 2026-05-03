const CLIENT_ID_KEY = "geoduel:client-id";
const ROOM_CODE_KEY = "geoduel:room-code";
const PLAYER_NAME_KEY = "geoduel:player-name";

export function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

export function rememberRoom(roomCode: string) {
  localStorage.setItem(ROOM_CODE_KEY, roomCode);
}

export function forgetRoom() {
  localStorage.removeItem(ROOM_CODE_KEY);
}

export function getRememberedRoom(): string {
  return localStorage.getItem(ROOM_CODE_KEY) ?? "";
}

export function rememberPlayerName(name: string) {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function getRememberedPlayerName(): string {
  return localStorage.getItem(PLAYER_NAME_KEY) ?? "";
}
