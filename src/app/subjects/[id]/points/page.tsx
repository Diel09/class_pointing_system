"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { StudentRedemptionsPanel } from "@/components/points/student-redemptions-panel";
import { StudentWalletPanel } from "@/components/points/student-wallet-panel";
import { TeacherEconomyPanel } from "@/components/points/teacher-economy-panel";
import { TeacherMeritsPanel } from "@/components/points/teacher-merits-panel";
import {
  SubjectWorkspaceShell,
  type SubjectDetailDto,
} from "@/components/subjects/subject-workspace-shell";
import type { RosterItem } from "@/components/subjects/teacher-roster-panel";

function TeacherPointsSection({
  subjectId,
  subject,
  isOwner,
}: {
  subjectId: string;
  subject: SubjectDetailDto;
  isOwner: boolean;
}) {
  const { data: rosterData } = useQuery<{ roster: RosterItem[] }>({
    queryKey: ["subject-roster", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/roster`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { roster: [] };
      return (await res.json()) as { roster: RosterItem[] };
    },
    enabled: Boolean(subjectId),
  });

  return (
    <div className="space-y-6">
      <TeacherMeritsPanel
        subjectId={subjectId}
        isArchived={subject.isArchived}
        allowNegativeBalance={subject.allowNegativeBalance}
        roster={rosterData?.roster ?? []}
        isOwner={isOwner}
      />

      <TeacherEconomyPanel
        subjectId={subjectId}
        isArchived={subject.isArchived}
        allowP2pTransfers={subject.allowP2pTransfers}
        p2pMaxPerTransfer={subject.p2pMaxPerTransfer}
        p2pMaxPerDay={subject.p2pMaxPerDay}
        p2pMaxPerTerm={subject.p2pMaxPerTerm}
        allowOpenRedemptions={subject.allowOpenRedemptions}
        isOwner={isOwner}
      />
    </div>
  );
}

export default function SubjectPointsPage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;

  return (
    <SubjectWorkspaceShell subjectId={subjectId} activeTab="points">
      {({ subject, enrollment, isTeacherOwner, isInstructor }) => (
        <>
          {enrollment && (
            <div className="space-y-6">
              <StudentWalletPanel
                subjectId={subjectId}
                subjectCode={subject.code}
                initialAvailableBalance={enrollment.availableBalance}
                initialEscrowedBalance={enrollment.escrowedBalance}
                manualStandingOverride={enrollment.manualStandingOverride}
                allowNegativeBalance={subject.allowNegativeBalance}
                allowP2pTransfers={subject.allowP2pTransfers}
                isArchived={subject.isArchived}
                p2pMaxPerTransfer={subject.p2pMaxPerTransfer}
                p2pMaxPerDay={subject.p2pMaxPerDay}
                p2pMaxPerTerm={subject.p2pMaxPerTerm}
              />

              <StudentRedemptionsPanel
                subjectId={subjectId}
                isArchived={subject.isArchived}
                availableBalance={enrollment.availableBalance}
                allowOpenRedemptions={subject.allowOpenRedemptions}
              />
            </div>
          )}

          {isInstructor && (
            <TeacherPointsSection
              subjectId={subjectId}
              subject={subject}
              isOwner={isTeacherOwner}
            />
          )}
        </>
      )}
    </SubjectWorkspaceShell>
  );
}
