import { withAuth } from "next-auth/middleware";

const authSecret =
  process.env.NEXTAUTH_SECRET || "crowd-monitoring-dev-secret-change-me";

export default withAuth({
  secret: authSecret,
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
