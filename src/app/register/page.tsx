"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [institutionalId, setInstitutionalId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          institutionalId: institutionalId.trim() || null,
          password,
          accountType: "STUDENT",
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        user?: unknown;
      };

      if (!response.ok) {
        setError(data.error ?? "Unable to create account.");
        return;
      }

      queryClient.setQueryData(["auth", "me"], data.user);
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error during registration.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="space-y-1">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 mb-1">
              <UserPlus className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Create Student Account
            </h2>
            <p className="text-xs text-slate-500">
              Register as a student to join classes and track your points.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="space-y-1">
              <label
                htmlFor="fullName"
                className="block text-xs font-semibold text-slate-700"
              >
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Juan Dela Cruz"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-700"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="juan@university.edu"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="institutionalId"
                className="block text-xs font-semibold text-slate-700"
              >
                Student Number (Optional)
              </label>
              <input
                id="institutionalId"
                type="text"
                value={institutionalId}
                onChange={(e) => setInstitutionalId(e.target.value)}
                placeholder="2026-0123"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-700"
              >
                Password (min. 8 characters)
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {submitting ? "Creating Account..." : "Register as Student"}
              </span>
            </button>
          </form>

          <p className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 text-center">
            Teacher accounts are provisioned directly by an administrator.
          </p>

          <p className="text-center text-xs text-slate-500">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
