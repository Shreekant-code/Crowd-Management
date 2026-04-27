import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { UserPlus, Waves, ShieldCheck } from "lucide-react";
import { SignUpForm } from "@/components/signup-form";

export default async function SignUpPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="panel flex items-center p-8 lg:p-12">
          <div className="w-full space-y-6">
            <SignUpForm />
            <p className="text-sm text-slate-500">
              Already registered?{" "}
              <Link className="font-semibold text-slateblue" href="/login">
                Login
              </Link>
            </p>
          </div>
        </div>
        <div className="panel-dark relative overflow-hidden p-8 lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(72,208,193,0.24),transparent_34%),radial-gradient(circle_at_bottom,rgba(255,107,87,0.2),transparent_34%)]" />
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <UserPlus className="h-4 w-4" />
              Public Platform Access
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
                Launch your own crowd monitoring workspace.
              </h1>
              <p className="max-w-lg text-base leading-7 text-white/72">
                Your account gets isolated cameras, dashboard metrics, uploads, and live alerts from day one.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <ShieldCheck className="mb-3 h-5 w-5 text-emerald-300" />
                <p className="text-sm text-white/70">Private account data</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <Waves className="mb-3 h-5 w-5 text-teal-300" />
                <p className="text-sm text-white/70">RTSP zone onboarding</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <UserPlus className="mb-3 h-5 w-5 text-orange-300" />
                <p className="text-sm text-white/70">Fast self-serve signup</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
