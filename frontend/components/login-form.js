"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
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
    <div className="w-full space-y-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">User Login</p>
        <h2 className="text-3xl font-semibold text-slate-900">Access your monitoring dashboard</h2>
        <p className="text-sm leading-6 text-slate-600">
          Sign in to manage your own cameras, uploads, alerts, and live crowd views.
        </p>
      </div>

      {initialReason ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {initialReason}
        </p>
      ) : null}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-slateblue"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter email"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-slateblue"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
          />
        </label>

        {error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slateblue px-4 py-3 text-sm font-medium text-white transition hover:bg-[#11294a] disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
