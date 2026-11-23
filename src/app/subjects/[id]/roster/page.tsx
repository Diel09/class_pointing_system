"use client";

import { FolderKanban, Users } from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SubjectWorkspaceShell } from "@/components/subjects/subject-workspace-shell";
import { TeacherGroupsPanel } from "@/components/subjects/teacher-groups-panel";
import { TeacherRosterPanel } from "@/components/subjects/teacher-roster-panel";
import { cn } from "@/lib/utils";

type RosterView = "roster" | "groups";

function resolveRosterView(raw: string | null): RosterView {
  return raw === "groups" ? "groups" : "roster";
}

function StudentRosterRedirect({ subjectId }: { subjectId: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/subjects/${subjectId}`);
  }, [router, subjectId]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-2">
      <p className="text-sm font-semibold text-slate-800">
        Roster management is only available to the class instructor.
      </p>
      <Link
        href={`/subjects/${subjectId}`}
        className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:underline"
      >
        Return to class workspace
      </Link>
    </div>
  );
}

function SubjectRosterContent() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = params.id;

  const viewParam = searchParams.get("view");
  const [view, setView] = useState<RosterView>(() =>
    resolveRosterView(viewParam)
  );

  useEffect(() => {
    setView(resolveRosterView(viewParam));
  }, [viewParam]);

  function handleViewChange(nextView: RosterView) {
    setView(nextView);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextView === "roster") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextView);
    }
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="roster">
      {({ subject, isTeacherOwner }) =>
        isTeacherOwner ? (
          <div className="space-y-4">
            <div
              role="tablist"
              aria-label="Roster workspace views"
              className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === "roster"}
                onClick={() => handleViewChange("roster")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  view === "roster"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Class Roster</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "groups"}
                onClick={() => handleViewChange("groups")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  view === "groups"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Student Groups</span>
              </button>
            </div>

            {view === "groups" ? (
              <TeacherGroupsPanel
                subjectId={subjectId}
                isArchived={subject.isArchived}
              />
            ) : (
              <TeacherRosterPanel subjectId={subjectId} subject={subject} />
            )}
          </div>
        ) : (
          <StudentRosterRedirect subjectId={subjectId} />
        )
      }
    </SubjectWorkspaceShell>
  );
}

export default function SubjectRosterPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-slate-500">
          Loading roster workspace...
        </div>
      }
    >
      <SubjectRosterContent />
    </Suspense>
  );
}
