import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { ArrowRight, BrainCircuit, Camera, ShieldCheck, Siren, Workflow } from "lucide-react";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="panel-dark relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14 lg:px-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(88,211,195,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,126,96,0.18),transparent_32%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                <ShieldCheck className="h-4 w-4" />
                AI Crowd Monitoring Platform
              </div>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
                  Public cloud monitoring for every venue, camera zone, and response team.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/72 sm:text-lg">
                  Create an account, connect RTSP cameras, monitor crowd pressure in real time, and review alerts from your own secure workspace.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                  href={session ? "/dashboard" : "/signup"}
                >
                  Start Monitoring
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                  href={session ? "/dashboard" : "/login"}
                >
                  {session ? "Open Dashboard" : "Login"}
                </Link>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-5">
                <p className="text-sm text-white/65">Real-time zones</p>
                <p className="mt-3 text-4xl font-semibold text-white">24/7</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-5">
                <p className="text-sm text-white/65">Per-user workspaces</p>
                <p className="mt-3 text-4xl font-semibold text-white">Secure</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-5 sm:col-span-2">
                <p className="text-sm text-white/65">Workflow</p>
                <p className="mt-3 text-xl font-semibold text-white">Signup, add cameras, monitor risk, review alerts, expand to AI later.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Multi-camera monitoring", text: "Manage RTSP streams as separate zones inside your own workspace.", icon: Camera },
            { title: "Real-time alerts", text: "Receive live risk updates and rolling incident alerts per user account.", icon: Siren },
            { title: "AI crowd analysis", text: "Phase-1 mock predictions are ready for model integration later.", icon: BrainCircuit },
            { title: "Evacuation system", text: "Designed to expand into guided response flows in a future release.", icon: Workflow },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="panel p-5">
                <div className="rounded-2xl bg-slate-950 p-3 text-white w-fit">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
              </article>
            );
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {[
            ["1", "Signup", "Create your account and enter your personal monitoring workspace."],
            ["2", "Add camera", "Register RTSP streams and organize them by venue zone."],
            ["3", "Monitor", "Watch counts, risk badges, and alert activity from your dashboard."],
          ].map(([step, title, text]) => (
            <article key={step} className="panel p-6">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-teal text-sm font-semibold text-white">
                {step}
              </div>
              <h3 className="mt-4 text-xl font-semibold text-slate-950">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </section>

        <section className="panel flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Create a free account and start monitoring.</h2>
            <p className="mt-2 text-sm text-slate-600">Each user gets private cameras, private alerts, and an isolated dashboard.</p>
          </div>
          <Link
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-signal px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#e45743]"
            href={session ? "/dashboard" : "/signup"}
          >
            Create Free Account
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
