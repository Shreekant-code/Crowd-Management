import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { UserPlus, Waves, ShieldCheck, ArrowLeft, Radio, Cpu } from "lucide-react";
import { SignUpForm } from "@/components/signup-form";

export default async function SignUpPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-[#080d16] text-slate-100 flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      {/* Background Grid & Scanline */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40 grid-shell" />
      <div className="scanline-effect z-10" />

      <section className="relative z-20 grid w-full max-w-5xl gap-6 lg:grid-cols-[0.95fr_1.05fr] items-center">
        {/* Left Side: High-Contrast Signup Form */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 lg:p-10 shadow-2xl backdrop-blur-2xl">
          <div className="w-full space-y-6">
            <SignUpForm />
            <p className="text-xs text-slate-400 text-center border-t border-slate-800 pt-4">
              Already registered?{" "}
              <Link className="font-bold text-teal-400 hover:text-teal-300 underline underline-offset-2" href="/login">
                Sign in to your account
              </Link>
            </p>
          </div>
        </div>

        {/* Right Side: Platform Highlights */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 p-8 lg:p-12 shadow-2xl backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(239,68,68,0.12),transparent_40%)]" />

          <div className="relative space-y-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>

            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/40 bg-teal-500/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-teal-300">
                <UserPlus className="h-4 w-4" />
                Isolated Workspace
              </div>
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl leading-tight">
                Launch your own crowd safety operations console.
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Connect your cameras, stream 60 FPS LERP canvas overlays, and run real-time dynamic evacuation routing.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <ShieldCheck className="mb-2 h-5 w-5 text-emerald-400" />
                <p className="text-xs font-bold text-white">Private Account Data</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Isolated zones & alert repository</p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <Radio className="mb-2 h-5 w-5 text-teal-400" />
                <p className="text-xs font-bold text-white">Instant RTSP Onboarding</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Automated MediaMTX WHEP router</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
