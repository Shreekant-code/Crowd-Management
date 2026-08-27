"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2, UserPlus, User, Mail, Lock } from "lucide-react";
import { useToast } from "@/components/providers/toast-provider";

export function SignUpForm() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [state, setState] = useState({
    loading: false,
    error: "",
  });

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setState({ loading: true, error: "" });

    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      const reason = "Name, email, and password are required.";
      setState({ loading: false, error: reason });
      pushToast({
        title: "Signup blocked",
        description: reason,
        tone: "warning",
      });
      return;
    }

    try {
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const registerData = await registerResponse.json();

      if (!registerResponse.ok) {
        throw new Error(registerData.message || "Registration failed");
      }

      const loginResult = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      if (loginResult?.error) {
        throw new Error(
          loginResult.error === "CredentialsSignin"
            ? "Account created, but login failed because the credentials were rejected."
            : loginResult.error
        );
      }

      pushToast({
        title: "Account created",
        description: "Welcome in. Your workspace is ready.",
        tone: "success",
      });
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setState({ loading: false, error: error.message });
      pushToast({
        title: "Signup failed",
        description: error.message,
        tone: "error",
      });
      return;
    }

    setState({ loading: false, error: "" });
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-teal-400">
          New Registration
        </span>
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          Create Operator Account
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Set up your credentials to provision isolated surveillance zones and real-time alerts.
        </p>
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
          {state.error}
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Full Name</span>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="Operator Name"
              required
            />
          </div>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Email Address</span>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
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
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
        </label>

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400 disabled:opacity-60"
          disabled={state.loading}
          type="submit"
        >
          {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {state.loading ? "Creating Account..." : "Create Free Account"}
        </button>
      </form>
    </div>
  );
}
