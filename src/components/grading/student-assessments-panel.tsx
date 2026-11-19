"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Coins,
  ExternalLink,
  Link2,
  MinusCircle,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { round2 } from "@/lib/grading/computeStanding";
import { cn } from "@/lib/utils";

export interface StudentSubmissionDto {
  id: string;
  driveUrl: string;
  normalizedUrl: string;
  driveResourceId: string | null;
  status: "SUBMITTED" | "LATE";
  accessStatus: "PUBLIC_VERIFIED" | "UNVERIFIED" | "PRIVATE_OR_RESTRICTED";
  accessCheckedAt: string | null;
  studentNote: string | null;
  submittedAt: string;
  updatedAt: string;
}

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
  submissionEnabled?: boolean;
  dueAt?: string | null;
  allowLateSubmissions?: boolean;
  requirePublicLink?: boolean;
  mySubmission?: StudentSubmissionDto | null;
  pendingBoost?: {
    count: number;
    totalBoost: number;
    totalPointsEscrowed: number;
  };
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

interface ScoreBoostRewardDto {
  id: string;
  name: string;
  description: string | null;
  rewardType: "SCORE_BOOST" | "FIXED_PERK";
  pointCostPerUnit: number;
  scoreValuePerUnit: number;
  eligibleCategoryIds: string[];
  allowExtraCredit: boolean;
  maxBoostPerAssessment: number | null;
  isActive: boolean;
}

interface StudentAssessmentsPanelProps {
  subjectId: string;
  isArchived?: boolean;
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
 * Student assessment view: displays recorded scores, supports Google Drive link
 * submissions on enabled activities (with zero file uploads), and lets students
 * spend points on eligible Score Boost rewards.
 */
export function StudentAssessmentsPanel({
  subjectId,
  isArchived = false,
}: StudentAssessmentsPanelProps) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [boostingAssessmentId, setBoostingAssessmentId] = useState<
    string | null
  >(null);
  const [selectedRewardId, setSelectedRewardId] = useState<string>("");
  const [units, setUnits] = useState(1);
  const [studentNote, setStudentNote] = useState("");
  const [submittingBoost, setSubmittingBoost] = useState(false);
  const [boostError, setBoostError] = useState<string | null>(null);
  const [boostSuccess, setBoostSuccess] = useState<string | null>(null);

  const [submittingAssessmentId, setSubmittingAssessmentId] = useState<
    string | null
  >(null);
  const [driveUrlInput, setDriveUrlInput] = useState("");
  const [submissionNoteInput, setSubmissionNoteInput] = useState("");
  const [savingSubmission, setSavingSubmission] = useState(false);
  const [withdrawingSubmissionId, setWithdrawingSubmissionId] = useState<
    string | null
  >(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(
    null
  );

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

  const { data: rewardsData } = useQuery<{
    rewards: ScoreBoostRewardDto[];
  }>({
    queryKey: ["subject-rewards", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/rewards`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { rewards: [] };
      return (await res.json()) as { rewards: ScoreBoostRewardDto[] };
    },
  });

  const { data: walletData } = useQuery<{
    wallet: { availableBalance: number; escrowedBalance: number };
  }>({
    queryKey: ["subject-wallet", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/wallet`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        return { wallet: { availableBalance: 0, escrowedBalance: 0 } };
      }
      return (await res.json()) as {
        wallet: { availableBalance: number; escrowedBalance: number };
      };
    },
  });

  const assessments = data?.assessments ?? [];
  const boostRewards = useMemo(
    () =>
      (rewardsData?.rewards ?? []).filter(
        (r) => r.isActive && r.rewardType === "SCORE_BOOST"
      ),
    [rewardsData?.rewards]
  );
  const availableBalance = walletData?.wallet.availableBalance ?? 0;

  function getEligibleRewards(categoryId: string) {
    return boostRewards.filter(
      (r) =>
        r.eligibleCategoryIds.length === 0 ||
        r.eligibleCategoryIds.includes(categoryId)
    );
  }

  function openBoostForm(item: StudentAssessmentDto) {
    const eligible = getEligibleRewards(item.categoryId);
    setBoostingAssessmentId(item.id);
    setSelectedRewardId(eligible[0]?.id ?? "");
    setUnits(1);
    setStudentNote("");
    setBoostError(null);
    setBoostSuccess(null);
  }

  async function handleSubmitBoost(
    event: FormEvent<HTMLFormElement>,
    item: StudentAssessmentDto,
    activeReward: ScoreBoostRewardDto
  ) {
    event.preventDefault();
    if (!navigator.onLine) {
      setBoostError(
        "Internet connection required to spend points. Reconnect and try again."
      );
      return;
    }

    setSubmittingBoost(true);
    setBoostError(null);
    setBoostSuccess(null);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: activeReward.id,
          requestedUnits: units,
          targetAssessmentId: item.id,
          targetLabel: item.title,
          studentNote: studentNote.trim() || undefined,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        redemption?: { pointsEscrowed: number };
      };
      if (!res.ok || !payload.redemption) {
        setBoostError(payload.error ?? "Unable to submit score boost.");
        return;
      }

      setBoostingAssessmentId(null);
      setStudentNote("");
      setUnits(1);
      setBoostSuccess(
        `Escrowed ${payload.redemption.pointsEscrowed} pts to boost "${item.title}". Waiting for teacher approval.`
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-redemptions", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-wallet", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-ledger", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
      ]);
    } catch {
      setBoostError("Network error while submitting score boost.");
    } finally {
      setSubmittingBoost(false);
    }
  }

  function openSubmissionForm(item: StudentAssessmentDto) {
    setSubmittingAssessmentId(item.id);
    setDriveUrlInput(item.mySubmission?.driveUrl ?? "");
    setSubmissionNoteInput(item.mySubmission?.studentNote ?? "");
    setSubmissionError(null);
    setSubmissionSuccess(null);
  }

  async function handleSaveSubmission(
    event: FormEvent<HTMLFormElement>,
    item: StudentAssessmentDto
  ) {
    event.preventDefault();
    if (!navigator.onLine) {
      setSubmissionError(
        "Internet connection required to submit your Google Drive link. Reconnect and try again."
      );
      return;
    }

    setSavingSubmission(true);
    setSubmissionError(null);
    setSubmissionSuccess(null);

    try {
      const res = await fetch(`/api/assessments/${item.id}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveUrl: driveUrlInput.trim(),
          studentNote: submissionNoteInput.trim() || null,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        submission?: StudentSubmissionDto;
        accessWarning?: string | null;
      };
      if (!res.ok || !payload.submission) {
        setSubmissionError(
          payload.error ?? "Unable to save Google Drive link."
        );
        return;
      }

      setSubmittingAssessmentId(null);
      setDriveUrlInput("");
      setSubmissionNoteInput("");
      setSubmissionSuccess(
        payload.accessWarning
          ? `Saved Google Drive link for "${item.title}". Note: ${payload.accessWarning}`
          : `Google Drive link submitted for "${item.title}".`
      );
      await queryClient.invalidateQueries({
        queryKey: ["subject-assessments", subjectId],
      });
    } catch {
      setSubmissionError("Network error while saving Google Drive link.");
    } finally {
      setSavingSubmission(false);
    }
  }

  async function handleWithdrawSubmission(item: StudentAssessmentDto) {
    if (!navigator.onLine) {
      setSubmissionError(
        "Internet connection required to withdraw your submission."
      );
      return;
    }

    setWithdrawingSubmissionId(item.id);
    setSubmissionError(null);
    setSubmissionSuccess(null);

    try {
      const res = await fetch(`/api/assessments/${item.id}/submission`, {
        method: "DELETE",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setSubmissionError(payload.error ?? "Unable to withdraw submission.");
        return;
      }

      if (submittingAssessmentId === item.id) {
        setSubmittingAssessmentId(null);
      }
      setSubmissionSuccess(`Withdrew Google Drive link for "${item.title}".`);
      await queryClient.invalidateQueries({
        queryKey: ["subject-assessments", subjectId],
      });
    } catch {
      setSubmissionError("Network error while withdrawing submission.");
    } finally {
      setWithdrawingSubmissionId(null);
    }
  }

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
              View your teacher-recorded scores, submit Google Drive links on
              enabled activities, or spend points to boost an eligible
              assessment.
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">
          <Coins className="h-3.5 w-3.5 text-indigo-600" />
          <span>Available: {availableBalance} pts</span>
        </div>
      </div>

      {!isOnline && (boostingAssessmentId || submittingAssessmentId) && (
        <OfflineBanner message="Internet connection required to submit updates." />
      )}

      {submissionSuccess && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
        >
          {submissionSuccess}
        </p>
      )}

      {boostSuccess && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
        >
          {boostSuccess}
        </p>
      )}

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
            const hasPendingBoost = (item.pendingBoost?.totalBoost ?? 0) > 0;
            const eligibleRewards = getEligibleRewards(item.categoryId);
            const alreadyMaxedWithoutExtraCredit =
              item.myScore.status === "GRADED" &&
              (item.myScore.rawScore ?? 0) + item.myScore.bonusPoints >=
                item.maxScore &&
              !item.myScore.allowExtraCredit &&
              !eligibleRewards.some((r) => r.allowExtraCredit);

            const canBoost =
              !isArchived &&
              eligibleRewards.length > 0 &&
              item.myScore.status !== "EXCUSED" &&
              item.myScore.status !== "MISSING" &&
              !alreadyMaxedWithoutExtraCredit;

            const isBoostOpen = boostingAssessmentId === item.id;
            const isSubmissionOpen = submittingAssessmentId === item.id;
            const isScoreLocked =
              item.myScore.status === "GRADED" ||
              item.myScore.status === "EXCUSED";
            const isPastDue = Boolean(
              item.dueAt && Date.now() > new Date(item.dueAt).getTime()
            );
            const isHardClosed = isPastDue && item.allowLateSubmissions === false;
            const canSubmitLink =
              Boolean(item.submissionEnabled) &&
              !isArchived &&
              !isScoreLocked &&
              !isHardClosed;
            const activeReward =
              eligibleRewards.find((r) => r.id === selectedRewardId) ??
              eligibleRewards[0] ??
              null;

            const maxUnitsByBoostCap =
              activeReward && activeReward.maxBoostPerAssessment !== null
                ? Math.max(
                    1,
                    Math.floor(
                      activeReward.maxBoostPerAssessment /
                        activeReward.scoreValuePerUnit
                    )
                  )
                : 100;
            const totalCost = activeReward
              ? units * activeReward.pointCostPerUnit
              : 0;
            const projectedBoost = activeReward
              ? round2(units * activeReward.scoreValuePerUnit)
              : 0;
            const projectedGradedScore =
              item.myScore.status === "GRADED" && activeReward
                ? round2(
                    item.myScore.allowExtraCredit ||
                      activeReward.allowExtraCredit
                      ? (item.myScore.rawScore ?? 0) +
                          item.myScore.bonusPoints +
                          projectedBoost
                      : Math.min(
                          item.maxScore,
                          (item.myScore.rawScore ?? 0) +
                            item.myScore.bonusPoints +
                            projectedBoost
                        )
                  )
                : null;

            return (
              <div key={item.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
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
                      {hasPendingBoost && item.pendingBoost && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          <Clock className="h-3 w-3" />
                          <span>
                            +{item.pendingBoost.totalBoost} boost pending (
                            {item.pendingBoost.totalPointsEscrowed} pts)
                          </span>
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="text-xs text-slate-600">
                        {item.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
                      <span>Max Score: {item.maxScore}</span>
                      {item.assessmentDate && (
                        <span>
                          Date:{" "}
                          {new Date(item.assessmentDate).toLocaleDateString()}
                        </span>
                      )}
                      {item.submissionEnabled && item.dueAt && (
                        <span
                          className={
                            isPastDue ? "text-rose-700 font-medium" : ""
                          }
                        >
                          Due: {new Date(item.dueAt).toLocaleString()}
                          {isPastDue && item.allowLateSubmissions === false
                            ? " (Closed)"
                            : ""}
                        </span>
                      )}
                    </div>

                    {item.submissionEnabled && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                            <Link2 className="h-3.5 w-3.5 text-indigo-600" />
                            {item.mySubmission ? (
                              <>
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 font-semibold border",
                                    item.mySubmission.status === "LATE"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  )}
                                >
                                  {item.mySubmission.status === "LATE"
                                    ? "Submitted (Late)"
                                    : "Submitted"}
                                </span>
                                <a
                                  href={item.mySubmission.normalizedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline"
                                >
                                  <span>View Submitted Drive Link</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                {item.mySubmission.accessStatus ===
                                  "UNVERIFIED" && (
                                  <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800">
                                    Access unverified
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="font-medium text-slate-600">
                                Google Drive link required (not submitted yet)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {canSubmitLink && (
                              <button
                                type="button"
                                onClick={() =>
                                  isSubmissionOpen
                                    ? setSubmittingAssessmentId(null)
                                    : openSubmissionForm(item)
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                              >
                                <Link2 className="h-3 w-3" />
                                <span>
                                  {isSubmissionOpen
                                    ? "Close"
                                    : item.mySubmission
                                    ? "Update Link"
                                    : "Submit Drive Link"}
                                </span>
                              </button>
                            )}
                            {canSubmitLink && item.mySubmission && (
                              <button
                                type="button"
                                disabled={withdrawingSubmissionId === item.id}
                                onClick={() =>
                                  void handleWithdrawSubmission(item)
                                }
                                aria-label={`Withdraw submission for ${item.title}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>
                                  {withdrawingSubmissionId === item.id
                                    ? "..."
                                    : "Withdraw"}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>

                        {item.mySubmission && (
                          <p className="text-[10px] text-slate-500">
                            Updated{" "}
                            {new Date(
                              item.mySubmission.updatedAt
                            ).toLocaleString()}
                            {item.mySubmission.studentNote
                              ? ` • Note: ${item.mySubmission.studentNote}`
                              : ""}
                          </p>
                        )}
                        {!canSubmitLink && isScoreLocked && (
                          <p className="text-[10px] text-slate-500">
                            Submission locked because this assessment has been
                            graded.
                          </p>
                        )}
                        {!canSubmitLink && !isScoreLocked && isHardClosed && (
                          <p className="text-[10px] text-rose-700">
                            Submission deadline passed and late submissions are
                            closed.
                          </p>
                        )}
                      </div>
                    )}

                    {item.myScore.remarks && (
                      <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                        Teacher remarks: {item.myScore.remarks}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0 space-y-1">
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

                    {canBoost && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            isBoostOpen
                              ? setBoostingAssessmentId(null)
                              : openBoostForm(item)
                          }
                          className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>
                            {isBoostOpen
                              ? "Close Boost"
                              : "Boost Score with Points"}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isSubmissionOpen && canSubmitLink && (
                  <form
                    onSubmit={(e) => void handleSaveSubmission(e, item)}
                    className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5 space-y-2.5"
                  >
                    <p className="text-[11px] text-slate-600">
                      {item.requirePublicLink !== false
                        ? "Upload your file to Google Drive → click Share → under General access select 'Anyone with the link' → paste the link below."
                        : "Upload your file to Google Drive (school/restricted links are allowed for this activity) and paste the share link below."}
                    </p>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label
                          htmlFor={`drive-url-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Google Drive Link
                        </label>
                        <input
                          id={`drive-url-${item.id}`}
                          type="url"
                          required
                          placeholder="https://drive.google.com/file/d/.../view"
                          value={driveUrlInput}
                          onChange={(e) => setDriveUrlInput(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor={`drive-note-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Note for Teacher (optional)
                        </label>
                        <input
                          id={`drive-note-${item.id}`}
                          type="text"
                          maxLength={500}
                          placeholder="Optional comment..."
                          value={submissionNoteInput}
                          onChange={(e) =>
                            setSubmissionNoteInput(e.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    {submissionError && (
                      <p
                        role="alert"
                        className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700"
                      >
                        {submissionError}
                      </p>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={!isOnline || savingSubmission}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        <span>
                          {savingSubmission
                            ? "Verifying & Saving..."
                            : item.mySubmission
                            ? "Update Google Drive Link"
                            : "Submit Google Drive Link"}
                        </span>
                      </button>
                    </div>
                  </form>
                )}

                {isBoostOpen && activeReward && (
                  <form
                    onSubmit={(e) =>
                      void handleSubmitBoost(e, item, activeReward)
                    }
                    className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5 space-y-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label
                          htmlFor={`boost-reward-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Score Boost Reward
                        </label>
                        <select
                          id={`boost-reward-${item.id}`}
                          value={activeReward.id}
                          onChange={(e) => {
                            setSelectedRewardId(e.target.value);
                            setUnits(1);
                            setBoostError(null);
                          }}
                          className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        >
                          {eligibleRewards.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.pointCostPerUnit} pts = +
                              {r.scoreValuePerUnit})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`boost-units-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Boost Units (+{activeReward.scoreValuePerUnit} each)
                        </label>
                        <input
                          id={`boost-units-${item.id}`}
                          type="number"
                          min={1}
                          max={maxUnitsByBoostCap}
                          required
                          value={units}
                          onChange={(e) =>
                            setUnits(
                              Math.max(
                                1,
                                Math.min(
                                  maxUnitsByBoostCap,
                                  Number.parseInt(e.target.value, 10) || 1
                                )
                              )
                            )
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`boost-note-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Note (optional)
                        </label>
                        <input
                          id={`boost-note-${item.id}`}
                          type="text"
                          maxLength={280}
                          placeholder="Optional note for teacher..."
                          value={studentNote}
                          onChange={(e) => setStudentNote(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    {boostError && (
                      <p
                        role="alert"
                        className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700"
                      >
                        {boostError}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
                      <div className="space-y-0.5 text-slate-600">
                        <p>
                          Cost:{" "}
                          <span className="font-bold text-slate-900">
                            {totalCost} pts
                          </span>
                          <span className="ml-2 font-semibold text-indigo-700">
                            {projectedGradedScore !== null
                              ? `(${item.myScore.effectiveScore} → ${projectedGradedScore} / ${item.maxScore})`
                              : `(Banks +${projectedBoost} boost)`}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Available after submit: {availableBalance - totalCost}{" "}
                          pts
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          !isOnline ||
                          submittingBoost ||
                          totalCost <= 0 ||
                          availableBalance < totalCost
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {submittingBoost
                            ? "Submitting..."
                            : `Spend ${totalCost} pts to Boost`}
                        </span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
