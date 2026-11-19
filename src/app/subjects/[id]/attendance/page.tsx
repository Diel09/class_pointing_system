"use client";

import { useParams } from "next/navigation";
import { StudentAttendancePanel } from "@/components/attendance/student-attendance-panel";
import { TeacherAttendancePanel } from "@/components/attendance/teacher-attendance-panel";
import { SubjectWorkspaceShell } from "@/components/subjects/subject-workspace-shell";

export default function SubjectAttendancePage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="attendance">
      {({ subject, enrollment, isTeacherOwner }) => (
        <>
          {enrollment && <StudentAttendancePanel subjectId={subjectId} />}

          {isTeacherOwner && (
            <TeacherAttendancePanel
              subjectId={subjectId}
              isArchived={subject.isArchived}
            />
          )}
        </>
      )}
    </SubjectWorkspaceShell>
  );
}
