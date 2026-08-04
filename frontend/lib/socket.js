"use client";

import { io } from "socket.io-client";

let socket;

function logSocketError(event, error) {
  console.error("socket_error", { event, message: error?.message || String(error), error });
}

export async function getSocket() {
  if (!socket) {
    let response;
    try {
      response = await fetch("/api/platform/socket-token", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Socket token request failed with status ${response.status}`);
      }
    } catch (error) {
      logSocketError("token_request", error);
      throw error;
    }
    const data = await response.json();

    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000", {
      transports: ["websocket"],
      auth: {
        token: data.token,
      },
    });
    socket.on("connect_error", (error) => logSocketError("connect_error", error));
    socket.on("error", (error) => logSocketError("server_error", error));
    socket.on("disconnect", (reason) => {
      if (reason !== "io client disconnect") {
        logSocketError("disconnect", new Error(reason));
      }
    });
  }

  return socket;
}
