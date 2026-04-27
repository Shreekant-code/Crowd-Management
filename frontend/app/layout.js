import "./globals.css";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppProviders } from "@/components/providers/app-providers";

export const metadata = {
  title: "Crowd Monitoring Cloud",
  description: "Phase-1 cloud crowd monitoring dashboard",
};

export default async function RootLayout({ children }) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body className="grid-shell">
        <AppProviders session={session}>{children}</AppProviders>
      </body>
    </html>
  );
}
