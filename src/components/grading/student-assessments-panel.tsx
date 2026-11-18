"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  MinusCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface StudentAssessmentDto {
  id: string;
  subjectId: string;
  categoryId: string;
  category: {
    id: string;
    name: string;
    termKey: string;
    categoryType: string;
  };
  title: string;
  description: string | null;
  maxScore: number;
  assessmentDate: string | null;
  myScore: {
    status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
    rawScore: number | null;
    bonusPoints: number;
    allowExtraCredit: boolean;
    effectiveScore: number | null;
    remarks: string | null;
    updatedAt: string | null;
  };
}

interface StudentAssessmentsPanelProps {
  subjectId: string;
}

function getScoreBadge(status: StudentAssessmentDto["myScore"]["status"]) {
  switch (status) {
    case "GRADED":
      return {
        label: "Graded",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
        Icon: CheckCircle2,
      };
    case "MISSING":
      return {
        label: "Missing (0)",
        className: "bg-rose-50 text-rose-700 border-rose-200",
        Icon: XCircle,
      };
    case "EXCUSED":
      return {
        label: "Excused",
        className: "bg-slate-100 text-slate-700 border-slate-200",
        Icon: MinusCircle,
      };
    default:
      return {
        label: "Pending",
        className: "bg-amber-50 text-amber-800 border-amber-200",
        Icon: Clock,
      };
  }
}

/**
 * Strictly read-only student assessment view (zero file uploads or submission controls).
 */
export function StudentAssessmentsPanel({
  subjectId,
}: StudentAssessmentsPanelProps) {
  const { data, isLoading, error } = useQuery<{
    assessments: StudentAssessmentDto[];
  }>({
    queryKey: ["subject-assessments", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/assessments`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Unable to load assessments.");
      }
      return (await res.json()) as { assessments: StudentAssessmentDto[] };
    },
  });

  const assessments = data?.assessments ?? [];

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-indigo-600" />
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Assessments &amp; Recorded Scores
            </h3>
            <p className="text-xs text-slate-500">
              Teacher-recorded scores and applied point boosts. No student
              submissions are required here.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Loading assessments...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
          {error instanceof Error ? error.message : "Failed to load assessments."}
        </div>
      ) : assessments.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          No assessments have been posted for this subject yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {assessments.map((item) => {
            const badge = getScoreBadge(item.myScore.status);
            const StatusIcon = badge.Icon;
            const hasBoost = item.myScore.bonusPoints > 0;

            return (
              <div
                key={item.id}
                className="p-4 flex items-start justify-between gap-4 flex-wrap"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">
                      {item.title}
                    </span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      {item.category.name}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        badge.className
                      )}
                    >
                      <StatusIcon className="h-3 w-3" />
                      <span>{badge.label}</span>
                    </span>
                  </div>

                  {item.description && (
                    <p className="text-xs text-slate-600">{item.description}</p>
                  )}

                  <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
                    <span>Max Score: {item.maxScore}</span>
                    {item.assessmentDate && (
                      <span>
                        Date:{" "}
                        {new Date(item.assessmentDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {item.myScore.remarks && (
                    <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      Teacher remarks: {item.myScore.remarks}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0 space-y-0.5">
                  {item.myScore.status === "GRADED" ? (
                    <>
                      <p className="text-lg font-extrabold text-slate-900">
                        {item.myScore.effectiveScore} / {item.maxScore}
                      </p>
                      {hasBoost && (
                        <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
                          <Sparkles className="h-3 w-3" />
                          <span>
                            {item.myScore.rawScore ?? 0} +{" "}
                            {item.myScore.bonusPoints} boost
                          </span>
                        </p>
                      )}
                    </>
                  ) : item.myScore.status === "MISSING" ? (
                    <p className="text-lg font-extrabold text-rose-700">
                      0 / {item.maxScore}
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-slate-500">
                      — / {item.maxScore}
                    </p>
                  )}
                  {item.myScore.status !== "GRADED" && hasBoost && (
                    <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
                      <Sparkles className="h-3 w-3" />
                      <span>+{item.myScore.bonusPoints} boost banked</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
