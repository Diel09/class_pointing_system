"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [accountType, setAccountType] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [institutionalId, setInstitutionalId] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
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
          accountType,
          inviteCode: accountType === "TEACHER" ? inviteCode.trim() || null : null,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        user?: unknown;
        pendingApproval?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "Unable to create account.");
        return;
      }

      if (data.pendingApproval) {
        setPendingApproval(true);
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

  if (pendingApproval) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto">
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <Clock className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              Teacher Account Pending Approval
            </h2>
            <p className="text-sm text-slate-600">
              Your teacher registration has been submitted. An administrator must
              approve your account before you can sign in and create classes.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Return to Sign In
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="space-y-1">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 mb-1">
              <UserPlus className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Create Account</h2>
            <p className="text-xs text-slate-500">
              Register as a student or request a teacher account.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            {(["STUDENT", "TEACHER"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAccountType(type)}
                className={cn(
                  "rounded-lg py-2 text-xs font-semibold transition-colors",
                  accountType === type
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {type === "STUDENT" ? "Student" : "Teacher"}
              </button>
            ))}
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
                {accountType === "STUDENT"
                  ? "Student Number (Optional)"
                  : "Employee ID (Optional)"}
              </label>
              <input
                id="institutionalId"
                type="text"
                value={institutionalId}
                onChange={(e) => setInstitutionalId(e.target.value)}
                placeholder={accountType === "STUDENT" ? "2026-0123" : "EMP-2001"}
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

            {accountType === "TEACHER" && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
                <label
                  htmlFor="inviteCode"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Teacher Invite Code (Optional)
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="TCH-XXXXXXXX"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm uppercase focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <p className="text-[11px] text-slate-500">
                  Enter an Admin-issued invite code for immediate activation, or
                  leave blank to await Admin approval.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {submitting
                  ? "Creating Account..."
                  : accountType === "TEACHER"
                  ? "Register as Teacher"
                  : "Register as Student"}
              </span>
            </button>
          </form>

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
