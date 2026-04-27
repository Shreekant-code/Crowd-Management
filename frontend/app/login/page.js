import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { ShieldCheck, Waves, LockKeyhole } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { AuthFeedbackToast } from "@/components/auth-feedback-toast";

export default async function LoginPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  const resolvedSearchParams = await searchParams;
  const authReason = getAuthErrorMessage(resolvedSearchParams?.error);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="panel-dark relative overflow-hidden p-8 lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(72,208,193,0.28),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(255,107,87,0.22),transparent_30%)]" />
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/80">
              <ShieldCheck className="h-4 w-4" />
              Phase-1 cloud operations console
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
                Live crowd intelligence for every zone, stream, and incident.
              </h1>
              <p className="max-w-lg text-base leading-7 text-white/72">
                Monitor RTSP camera zones, process uploaded footage, and react to risk spikes from one operations dashboard.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <Waves className="mb-3 h-5 w-5 text-teal-300" />
                <p className="text-sm text-white/70">Multi-camera live monitoring</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <LockKeyhole className="mb-3 h-5 w-5 text-orange-300" />
                <p className="text-sm text-white/70">Credential protected operator access</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <ShieldCheck className="mb-3 h-5 w-5 text-emerald-300" />
                <p className="text-sm text-white/70">Live alerts with risk-aware triage</p>
              </div>
            </div>
          </div>
        </div>
        <div className="panel flex items-center p-8 lg:p-12">
          <div className="w-full space-y-6">
            <AuthFeedbackToast
              title={authReason ? "Authentication issue" : ""}
              description={authReason}
              tone="error"
            />
            <LoginForm initialReason={authReason} />
            <p className="text-sm text-slate-500">
              New here?{" "}
              <Link className="font-semibold text-slateblue" href="/signup">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
