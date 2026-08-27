import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw, ServerCrash } from "lucide-react";

export function DashboardUnavailable({ operatorName, message }) {
  const isOffline = message?.includes("Backend is unreachable");
  const isSecretMismatch = message?.includes("Frontend and backend secrets do not match");

  return (
    <main className="min-h-screen bg-[#080d16] text-slate-100 flex items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      {/* Background Grid & Scanline */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40 grid-shell" />
      <div className="scanline-effect z-10" />

      <div className="relative z-20 mx-auto flex max-w-3xl flex-col gap-6 w-full">
        <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 p-8 sm:p-10 shadow-2xl backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(239,68,68,0.18),transparent_40%),radial-gradient(circle_at_85%_85%,rgba(245,158,11,0.12),transparent_40%)]" />

          <div className="relative space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-red-300">
              <ServerCrash className="h-4 w-4" />
              Backend Connection Alert
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              {isSecretMismatch
                ? "Backend running, but platform secrets do not match."
                : isOffline
                  ? "Express backend service is currently offline."
                  : "Platform service connection error."}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {message}
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8 space-y-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-bold text-white">Operator: {operatorName}</p>
                <p className="text-xs text-slate-300 mt-0.5">
                  {isSecretMismatch
                    ? "Set the same PLATFORM_API_SECRET in frontend/.env.local and backend/.env, then restart both servers."
                    : "Start the Express backend service on port 4000 using run_services.ps1 or npm run dev in backend."}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-teal-300 space-y-1">
                {isSecretMismatch ? (
                  <>
                    <p>frontend/.env.local -&gt; PLATFORM_API_SECRET=platform-secret-change-me</p>
                    <p>backend/.env -&gt; PLATFORM_API_SECRET=platform-secret-change-me</p>
                  </>
                ) : (
                  <>
                    <p>.\run_services.ps1</p>
                    <p className="text-slate-500"># or: cd backend &amp;&amp; npm run dev</p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => window.location.reload()}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry Connection
                </button>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-700"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Return Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
