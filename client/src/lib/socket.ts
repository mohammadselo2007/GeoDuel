import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../../../shared/types";

const serverUrl = import.meta.env.VITE_SERVER_URL || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  transports: ["websocket", "polling"]
});
