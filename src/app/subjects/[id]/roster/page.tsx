"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { SubjectWorkspaceShell } from "@/components/subjects/subject-workspace-shell";
import { TeacherRosterPanel } from "@/components/subjects/teacher-roster-panel";

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

export default function SubjectRosterPage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="roster">
      {({ subject, isTeacherOwner }) =>
        isTeacherOwner ? (
          <TeacherRosterPanel subjectId={subjectId} subject={subject} />
        ) : (
          <StudentRosterRedirect subjectId={subjectId} />
        )
      }
    </SubjectWorkspaceShell>
  );
}
