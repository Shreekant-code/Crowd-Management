"use client";

import { SessionProvider } from "next-auth/react";

export function SessionAppProvider({ children, session }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}

