"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2, UserPlus } from "lucide-react";
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
    <div className="w-full space-y-8">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Create Account</p>
        <h2 className="text-3xl font-semibold text-slate-900">Start your monitoring workspace</h2>
        <p className="text-sm leading-6 text-slate-600">
          Register a public account to add cameras, track alerts, and monitor your own crowd zones.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Full Name</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-slateblue"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Enter your name"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-slateblue"
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-slateblue"
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            placeholder="Minimum 8 characters"
          />
        </label>

        {state.error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{state.error}</p>
        ) : null}

        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-[#e45743] disabled:opacity-60"
          disabled={state.loading}
          type="submit"
        >
          {state.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {state.loading ? "Creating account..." : "Create Free Account"}
        </button>
      </form>

      <p className="text-sm text-slate-500">
        Already have an account?{" "}
        <Link className="font-semibold text-slateblue" href="/login">
          Login
        </Link>
      </p>
    </div>
  );
}
