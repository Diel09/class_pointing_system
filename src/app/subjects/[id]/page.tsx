"use client";

import { Calculator, ClipboardList } from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { StudentAssessmentsPanel } from "@/components/grading/student-assessments-panel";
import { TeacherAssessmentsPanel } from "@/components/grading/teacher-assessments-panel";
import { TeacherComputationPanel } from "@/components/grading/teacher-computation-panel";
import { AppShell } from "@/components/layout/app-shell";
import { SubjectWorkspaceShell } from "@/components/subjects/subject-workspace-shell";
import { getSubjectTabHref } from "@/components/subjects/subject-workspace-tabs";
import { cn } from "@/lib/utils";

type GradebookView = "assessments" | "computation";

function resolveGradebookView(raw: string | null): GradebookView {
  return raw === "computation" ? "computation" : "assessments";
}

function SubjectGradebookContent() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = params.id;

  const tabQueryValue = searchParams.get("tab");
  const viewQueryValue = searchParams.get("view");
  const [gradebookView, setGradebookView] = useState<GradebookView>(() =>
    resolveGradebookView(viewQueryValue)
  );

  // Preserve backward compatibility for old ?tab= links
  useEffect(() => {
    if (
      tabQueryValue === "attendance" ||
      tabQueryValue === "points" ||
      tabQueryValue === "roster"
    ) {
      router.replace(getSubjectTabHref(subjectId, tabQueryValue));
    }
  }, [router, subjectId, tabQueryValue]);

  useEffect(() => {
    setGradebookView(resolveGradebookView(viewQueryValue));
  }, [viewQueryValue]);

  function handleViewChange(nextView: GradebookView) {
    setGradebookView(nextView);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("tab");
    if (nextView === "assessments") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextView);
    }
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="grades">
      {({ subject, enrollment, isTeacherOwner }) => (
        <>
          {enrollment && (
            <StudentAssessmentsPanel
              subjectId={subjectId}
              isArchived={subject.isArchived}
            />
          )}

          {isTeacherOwner && (
            <div className="space-y-4">
              <div
                role="tablist"
                aria-label="Gradebook workspace views"
                className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={gradebookView === "assessments"}
                  onClick={() => handleViewChange("assessments")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    gradebookView === "assessments"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Gradebook &amp; Standing</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={gradebookView === "computation"}
                  onClick={() => handleViewChange("computation")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    gradebookView === "computation"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Computation &amp; Scale</span>
                </button>
              </div>

              {gradebookView === "assessments" ? (
                <TeacherAssessmentsPanel
                  subjectId={subjectId}
                  isArchived={subject.isArchived}
                />
              ) : (
                <TeacherComputationPanel
                  subjectId={subjectId}
                  isArchived={subject.isArchived}
                  standingVisible={subject.standingVisible}
                />
              )}
            </div>
          )}
        </>
      )}
    </SubjectWorkspaceShell>
  );
}

export default function SubjectDetailPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading subject workspace...
          </div>
        </AppShell>
      }
    >
      <SubjectGradebookContent />
    </Suspense>
  );
}
