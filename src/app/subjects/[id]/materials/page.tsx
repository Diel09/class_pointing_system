"use client";

import { useParams } from "next/navigation";
import { SubjectMaterialsPanel } from "@/components/subjects/subject-materials-panel";
import { SubjectWorkspaceShell } from "@/components/subjects/subject-workspace-shell";

export default function SubjectMaterialsPage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="materials">
      {({ subject, isInstructor }) => (
        <SubjectMaterialsPanel
          subjectId={subjectId}
          isInstructor={isInstructor}
          isArchived={subject.isArchived}
        />
      )}
    </SubjectWorkspaceShell>
  );
}
