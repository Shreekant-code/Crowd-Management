"use client";

import { SessionAppProvider } from "./session-app-provider";
import { ToastProvider } from "./toast-provider";

export function AppProviders({ children, session }) {
  return (
    <SessionAppProvider session={session}>
      <ToastProvider>{children}</ToastProvider>
    </SessionAppProvider>
  );
}

