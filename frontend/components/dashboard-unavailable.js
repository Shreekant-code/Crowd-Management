import Link from "next/link";
import { AlertTriangle, RefreshCw, ServerCrash } from "lucide-react";

export function DashboardUnavailable({ operatorName, message }) {
  const isOffline = message?.includes("Backend is unreachable");
  const isSecretMismatch = message?.includes("Frontend and backend secrets do not match");

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <section className="panel-dark relative overflow-hidden p-8 sm:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(88,211,195,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,126,96,0.18),transparent_32%)]" />
          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <ServerCrash className="h-4 w-4" />
              Backend Connection Required
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold text-white sm:text-4xl">
                {isSecretMismatch
                  ? "Your backend is running, but platform secrets do not match."
                  : isOffline
                    ? "Your dashboard is ready, but the backend is offline."
                    : "Your dashboard could not connect to the platform services."}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-white/75">
                {message}
              </p>
            </div>
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">{operatorName}</p>
                <p className="text-sm text-slate-600">
                  {isSecretMismatch
                    ? "Use the same PLATFORM_API_SECRET in frontend/.env.local and backend/.env, then restart both servers."
                    : "Start the backend server on `http://localhost:4000`, then refresh the dashboard."}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                {isSecretMismatch ? (
                  <>
                    <p><code>frontend/.env.local -&gt; PLATFORM_API_SECRET=platform-secret-change-me</code></p>
                    <p><code>backend/.env -&gt; PLATFORM_API_SECRET=platform-secret-change-me</code></p>
                  </>
                ) : (
                  <>
                    <p>`cd backend`</p>
                    <p>`npm run dev`</p>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                  href="/dashboard"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry Dashboard
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  href="/"
                >
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
