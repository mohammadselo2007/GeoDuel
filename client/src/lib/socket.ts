import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../../../shared/types";
import { apiBaseUrl } from "./env";

const serverUrl = apiBaseUrl() || undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  transports: ["websocket", "polling"]
});
