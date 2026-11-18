"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, EyeOff, Layers, Sparkles } from "lucide-react";
import type { ComputeStandingResult } from "@/lib/grading/computeStanding";
import { cn } from "@/lib/utils";

interface StudentStandingResponse {
  standingVisible: boolean;
  manualStandingOverride: "NONE" | "INC" | "DRP";
  usingDefaultScale?: boolean;
  standing: ComputeStandingResult | null;
}

interface StudentStandingPanelProps {
  subjectId: string;
}

export function StudentStandingPanel({ subjectId }: StudentStandingPanelProps) {
  const { data, isLoading, error } = useQuery<StudentStandingResponse>({
    queryKey: ["subject-standing", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/standing`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Unable to load class standing.");
      }
      return (await res.json()) as StudentStandingResponse;
    },
  });

  if (isLoading) {
    return (
      <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm text-xs text-slate-500">
        Calculating live class standing...
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="rounded-2xl bg-rose-50 border border-rose-200 p-5 text-xs text-rose-700">
        {error instanceof Error ? error.message : "Unable to load class standing."}
      </section>
    );
  }

  if (!data.standingVisible) {
    return (
      <section className="rounded-2xl bg-slate-900 text-white p-5 shadow-sm flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-amber-300">
            <EyeOff className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Class Standing
            </p>
            <h3 className="text-base font-bold">Grades Hidden by Teacher</h3>
            <p className="text-xs text-slate-300">
              Your instructor is currently in grade encoding/deliberation mode.
              Live percentages and grade equivalents will reappear once published.
            </p>
          </div>
        </div>
        {data.manualStandingOverride !== "NONE" && (
          <span className="rounded-full bg-amber-400/20 border border-amber-300/40 px-3 py-1 text-xs font-bold text-amber-200">
            Status: {data.manualStandingOverride}
          </span>
        )}
      </section>
    );
  }

  const standing = data.standing;
  if (!standing) {
    return null;
  }

  const gradeBadgeTone = standing.isOverridden
    ? "bg-amber-50 text-amber-800 border-amber-200"
    : !standing.hasGradedItems
    ? "bg-slate-100 text-slate-700 border-slate-200"
    : standing.isPassing
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-rose-50 text-rose-700 border-rose-200";

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">
              Live Class Standing
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            Running grade re-normalizes weights across active categories with
            graded items or recorded attendance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Running %
            </p>
            <p className="text-xl font-bold text-slate-900">
              {standing.overallPct !== null ? `${standing.overallPct.toFixed(2)}%` : "—"}
            </p>
          </div>
          <div
            className={cn(
              "rounded-2xl border px-4 py-2 text-center min-w-[96px]",
              gradeBadgeTone
            )}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider">
              {standing.effectiveStatusLabel}
            </p>
            <p className="text-2xl font-extrabold leading-tight">
              {standing.effectiveGradeEquivalent ?? "—"}
            </p>
          </div>
        </div>
      </div>

      {standing.categories.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Your instructor has not configured grade categories for this subject yet.
        </div>
      ) : (
        <div className="space-y-4">
          {standing.terms.length > 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {standing.terms.map((term) => (
                <div
                  key={term.key}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {term.label}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Weight: {term.configuredWeightPct}%
                      {term.isActive &&
                      term.normalizedWeightPct !== term.configuredWeightPct
                        ? ` (Active: ${term.normalizedWeightPct}%)`
                        : ""}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-indigo-700">
                    {term.termPct !== null ? `${term.termPct.toFixed(2)}%` : "Pending"}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Layers className="h-3.5 w-3.5" />
              <span>Category Breakdown</span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {standing.categories.map((cat) => (
                <div
                  key={cat.categoryId}
                  className={cn(
                    "rounded-xl border p-3.5 space-y-1.5",
                    cat.isActive
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50/70 opacity-75"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        {cat.name}
                        {standing.terms.length > 1 ? ` (${cat.termKey})` : ""}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Weight: {cat.configuredWeightPct}%
                        {cat.isActive &&
                        cat.normalizedWeightPct !== cat.configuredWeightPct
                          ? ` • Effective ${cat.normalizedWeightPct}%`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-bold",
                        cat.isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-200 text-slate-600"
                      )}
                    >
                      {cat.categoryPct !== null
                        ? `${cat.categoryPct.toFixed(2)}%`
                        : "Pending"}
                    </span>
                  </div>

                  {cat.categoryType === "ASSESSMENT" && (
                    <p className="text-[11px] text-slate-500 flex items-center justify-between">
                      <span>
                        {cat.activeItemCount} of {cat.totalItemCount} item(s)
                        counted
                      </span>
                      {cat.isActive && (
                        <span>
                          {cat.earnedTotal} / {cat.possibleTotal} pts
                        </span>
                      )}
                    </p>
                  )}

                  {cat.categoryType === "ATTENDANCE" && (
                    <p className="text-[11px] text-slate-500">
                      {cat.activeItemCount} recorded session(s)
                    </p>
                  )}

                  {cat.categoryType === "POINTS_PARTICIPATION" && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-indigo-500" />
                      <span>
                        {cat.earnedTotal} / {cat.possibleTotal} earned pts
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
