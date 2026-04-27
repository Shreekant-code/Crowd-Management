import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardUnavailable } from "@/components/dashboard-unavailable";
import { platformFetch } from "@/lib/server/platform-client";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  try {
    const data = await platformFetch("/api/dashboard", session);

    return (
      <DashboardShell
        initialData={data}
        operatorName={session?.user?.name || session?.user?.email || "Platform User"}
      />
    );
  } catch (error) {
    return (
      <DashboardUnavailable
        operatorName={session?.user?.name || session?.user?.email || "Platform User"}
        message={error.message || "Dashboard data could not be loaded."}
      />
    );
  }
}
