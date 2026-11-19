"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { AssessmentGradingGrid } from "@/components/grading/assessment-grading-grid";
import { AppShell, type CurrentUserDto } from "@/components/layout/app-shell";

interface SubjectSummaryResponse {
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
    isArchived: boolean;
    teacher: { id: string; fullName: string; email: string };
    term: { id: string; name: string; isActive: boolean };
  };
}

interface SubjectAssessmentOption {
  id: string;
  title: string;
  maxScore: number;
  category: {
    id: string;
    name: string;
  };
}

export default function AssessmentGradingPage() {
  const params = useParams<{ id: string; assessmentId: string }>();
  const router = useRouter();
  const subjectId = params.id;
  const assessmentId = params.assessmentId;

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { data: user, isLoading: loadingUser } =
    useQuery<CurrentUserDto | null>({
      queryKey: ["auth", "me"],
      queryFn: async () => {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (!res.ok) return null;
        const payload = (await res.json()) as { user: CurrentUserDto };
        return payload.user;
      },
    });

  const {
    data: subjectData,
    isLoading: loadingSubject,
    error: subjectError,
  } = useQuery<SubjectSummaryResponse>({
    queryKey: ["subject", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Unable to load subject.");
      }
      return (await res.json()) as SubjectSummaryResponse;
    },
    enabled: Boolean(subjectId),
  });

  const isTeacherOwner =
    user?.role === "TEACHER" &&
    subjectData?.subject.teacher.id === user.id;

  const { data: assessmentsData } = useQuery<{
    assessments: SubjectAssessmentOption[];
  }>({
    queryKey: ["subject-assessments", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/assessments`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { assessments: [] };
      return (await res.json()) as { assessments: SubjectAssessmentOption[] };
    },
    enabled: Boolean(isTeacherOwner),
  });

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const confirmLeaveIfDirty = useCallback((): boolean => {
    if (!hasUnsavedChanges || typeof window === "undefined") {
      return true;
    }
    return window.confirm(
      "You have unsaved score changes. Discard them and leave this assessment?"
    );
  }, [hasUnsavedChanges]);

  function handleBackClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!confirmLeaveIfDirty()) {
      event.preventDefault();
    }
  }

  function handleSwitchAssessment(nextId: string) {
    if (!nextId || nextId === assessmentId) return;
    if (!confirmLeaveIfDirty()) return;
    router.push(`/subjects/${subjectId}/assessments/${nextId}`);
  }

  const assessments = assessmentsData?.assessments ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href={`/subjects/${subjectId}`}
            onClick={handleBackClick}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Gradebook</span>
          </Link>

          {isTeacherOwner && assessments.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="assessment-switcher"
                className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1"
              >
                <ClipboardList className="h-3.5 w-3.5 text-indigo-600" />
                <span>Assessment:</span>
              </label>
              <select
                id="assessment-switcher"
                value={assessmentId}
                onChange={(e) => handleSwitchAssessment(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
              >
                {assessments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.category.name} • /{a.maxScore})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loadingUser || loadingSubject ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading grading workspace...
          </div>
        ) : subjectError || !subjectData ? (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
            {subjectError instanceof Error
              ? subjectError.message
              : "Subject not found."}
          </div>
        ) : !isTeacherOwner ? (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
            Only the subject instructor can grade students in assessments.
          </div>
        ) : (
          <>
            <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {subjectData.subject.code} • {subjectData.subject.section}
                  </span>
                  <span className="text-xs text-slate-500">
                    {subjectData.subject.term.name}
                  </span>
                  {subjectData.subject.isArchived && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Archived
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-bold text-slate-900">
                  {subjectData.subject.title} — Grade Students
                </h1>
              </div>
            </section>

            <AssessmentGradingGrid
              subjectId={subjectId}
              assessmentId={assessmentId}
              isArchived={subjectData.subject.isArchived}
              onUnsavedChangesChange={setHasUnsavedChanges}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
