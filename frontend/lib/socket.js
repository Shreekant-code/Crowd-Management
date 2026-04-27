"use client";

import { io } from "socket.io-client";

let socket;

export async function getSocket() {
  if (!socket) {
    const response = await fetch("/api/platform/socket-token", { cache: "no-store" });
    const data = await response.json();

    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000", {
      transports: ["websocket"],
      auth: {
        token: data.token,
      },
    });
  }

  return socket;
}
