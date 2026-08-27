"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, Lock, Mail } from "lucide-react";
import { useToast } from "@/components/providers/toast-provider";

export function LoginForm({ initialReason = "" }) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    if (!email.trim() || !password.trim()) {
      const reason = "Email and password are both required.";
      setLoading(false);
      setError(reason);
      pushToast({
        title: "Login blocked",
        description: reason,
        tone: "warning",
      });
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      const reason =
        result.error === "CredentialsSignin"
          ? "The email or password is incorrect."
          : result.error;
      setError(reason);
      pushToast({
        title: "Login failed",
        description: reason,
        tone: "error",
      });
      return;
    }

    pushToast({
      title: "Login successful",
      description: "Your monitoring workspace is ready.",
      tone: "success",
    });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-teal-400">
          Operator Access
        </span>
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          Sign In to Command Center
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Access your private surveillance zones, live telemetry feeds, and predictive safety models.
        </p>
      </div>

      {initialReason && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-300">
          {initialReason}
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
          {error}
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Email Address</span>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="operator@crowdsafe.local"
              required
            />
          </div>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Password</span>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
        </label>

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400 disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {loading ? "Authenticating..." : "Sign In to Operations"}
        </button>
      </form>
    </div>
  );
}
