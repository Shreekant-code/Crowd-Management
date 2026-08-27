import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardUnavailable } from "@/components/dashboard-unavailable";
import { platformFetch } from "@/lib/server/platform-client";
import { listUsers } from "@/lib/server/users";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  // If unauthenticated on root path, connect to default operator workspace for instant live monitoring
  const defaultUser = listUsers()[0] || {
    id: "e57605de-ba09-43a5-90c1-ee2d135be57c",
    name: "Shubham",
    email: "shub252005@gmail.com",
  };

  const effectiveSession = session?.user?.id
    ? session
    : { user: defaultUser };

  try {
    const data = await platformFetch("/api/dashboard", effectiveSession);

    return (
      <DashboardShell
        initialData={data}
        operatorName={effectiveSession?.user?.name || effectiveSession?.user?.email || "Platform Operator"}
      />
    );
  } catch (error) {
    return (
      <DashboardUnavailable
        operatorName={effectiveSession?.user?.name || effectiveSession?.user?.email || "Platform Operator"}
        message={error.message || "Dashboard data could not be loaded."}
      />
    );
  }
}
