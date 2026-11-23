"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { StudentRedemptionsPanel } from "@/components/points/student-redemptions-panel";
import { StudentWalletPanel } from "@/components/points/student-wallet-panel";
import { TeacherEconomyPanel } from "@/components/points/teacher-economy-panel";
import { TeacherMeritsPanel } from "@/components/points/teacher-merits-panel";
import {
  SubjectWorkspaceShell,
  type SubjectDetailDto,
} from "@/components/subjects/subject-workspace-shell";
import type { RosterItem } from "@/components/subjects/teacher-roster-panel";
import { cn } from "@/lib/utils";

function TeacherPointsSection({
  subjectId,
  subject,
  isOwner,
}: {
  subjectId: string;
  subject: SubjectDetailDto;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const pointsEnabled = subject.pointsEnabled !== false;

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

  async function handleTogglePointsEnabled() {
    setToggling(true);
    setToggleError(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointsEnabled: !pointsEnabled }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setToggleError(err.error ?? "Unable to update Points & Economy setting.");
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
        queryClient.invalidateQueries({ queryKey: ["subjects"] }),
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-sessions", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-roster", subjectId],
        }),
      ]);
    } catch {
      setToggleError("Network error while updating setting.");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Master Section Toggle */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                pointsEnabled
                  ? "bg-indigo-50 text-indigo-600"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              <Coins className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Points &amp; Economy System
                </h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    pointsEnabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {pointsEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {pointsEnabled
                  ? "Students accumulate attendance and merit points, transfer points via QR, and submit reward redemptions."
                  : "Points & Economy is disabled for this section. Existing student balances and ledger history are preserved frozen, and students cannot earn, transfer, or redeem points."}
              </p>
            </div>
          </div>

          {isOwner && (
            <button
              type="button"
              role="switch"
              aria-checked={pointsEnabled}
              aria-label="Enable Points & Economy"
              disabled={toggling}
              onClick={() => void handleTogglePointsEnabled()}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-60",
                pointsEnabled ? "bg-indigo-600" : "bg-slate-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                  pointsEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          )}
        </div>

        {toggleError && (
          <p role="alert" className="text-xs text-rose-700">
            {toggleError}
          </p>
        )}
      </section>

      <TeacherMeritsPanel
        subjectId={subjectId}
        isArchived={subject.isArchived}
        pointsEnabled={pointsEnabled}
        allowNegativeBalance={subject.allowNegativeBalance}
        roster={rosterData?.roster ?? []}
        isOwner={isOwner}
      />

      <TeacherEconomyPanel
        subjectId={subjectId}
        isArchived={subject.isArchived}
        pointsEnabled={pointsEnabled}
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
          {enrollment &&
            (subject.pointsEnabled === false ? (
              <section className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-3 text-center">
                <Coins className="h-8 w-8 text-slate-400 mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Points &amp; Economy Disabled
                  </h3>
                  <p className="text-xs text-slate-500">
                    Your teacher has disabled the Points &amp; Economy system
                    for this section.
                  </p>
                </div>
                <Link
                  href={`/subjects/${subjectId}`}
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Back to Assessments &amp; Standing
                </Link>
              </section>
            ) : (
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
            ))}

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
