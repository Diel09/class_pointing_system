"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Gift,
  Sparkles,
  Tag,
  Undo2,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { StudentAssessmentDto } from "@/components/grading/student-assessments-panel";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { cn } from "@/lib/utils";

export interface RewardItemDto {
  id: string;
  subjectId: string;
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

export interface RedemptionRequestDto {
  id: string;
  subjectId: string;
  enrollmentId: string;
  rewardItemId: string | null;
  isCustomRequest: boolean;
  targetAssessmentId: string | null;
  targetLabel: string | null;
  pointsEscrowed: number;
  requestedUnits: number;
  projectedScoreBoost: number | null;
  studentNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  teacherNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  rewardItem: {
    id: string;
    name: string;
    rewardType: "SCORE_BOOST" | "FIXED_PERK";
    pointCostPerUnit: number;
    scoreValuePerUnit: number;
    allowExtraCredit: boolean;
  } | null;
}

interface StudentRedemptionsPanelProps {
  subjectId: string;
  isArchived: boolean;
  availableBalance: number;
  allowOpenRedemptions: boolean;
}

function getStatusBadge(status: RedemptionRequestDto["status"]) {
  switch (status) {
    case "PENDING":
      return {
        label: "Pending Review",
        className: "bg-amber-50 text-amber-800 border-amber-200",
        Icon: Clock,
      };
    case "APPROVED":
      return {
        label: "Approved",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
        Icon: CheckCircle2,
      };
    case "REJECTED":
      return {
        label: "Rejected (Refunded)",
        className: "bg-rose-50 text-rose-700 border-rose-200",
        Icon: XCircle,
      };
    case "CANCELLED":
      return {
        label: "Cancelled (Refunded)",
        className: "bg-slate-100 text-slate-600 border-slate-200",
        Icon: Undo2,
      };
  }
}

export function StudentRedemptionsPanel({
  subjectId,
  isArchived,
  availableBalance,
  allowOpenRedemptions,
}: StudentRedemptionsPanelProps) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [selectedRewardId, setSelectedRewardId] = useState<string>("");
  const [useCustomRequest, setUseCustomRequest] = useState(false);
  const [units, setUnits] = useState(1);
  const [customPointsCost, setCustomPointsCost] = useState(10);
  const [targetAssessmentId, setTargetAssessmentId] = useState<string>("");
  const [targetLabel, setTargetLabel] = useState("");
  const [studentNote, setStudentNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data: rewardsData, isLoading: loadingRewards } = useQuery<{
    allowOpenRedemptions: boolean;
    rewards: RewardItemDto[];
  }>({
    queryKey: ["subject-rewards", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/rewards`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load reward catalog.");
      return (await res.json()) as {
        allowOpenRedemptions: boolean;
        rewards: RewardItemDto[];
      };
    },
  });

  const { data: redemptionsData, isLoading: loadingRedemptions } = useQuery<{
    redemptions: RedemptionRequestDto[];
  }>({
    queryKey: ["subject-redemptions", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/redemptions`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load redemptions.");
      return (await res.json()) as { redemptions: RedemptionRequestDto[] };
    },
  });

  const { data: assessmentsData } = useQuery<{
    assessments: StudentAssessmentDto[];
  }>({
    queryKey: ["subject-assessments", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/assessments`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { assessments: [] };
      return (await res.json()) as { assessments: StudentAssessmentDto[] };
    },
  });

  const rewards = useMemo(
    () => rewardsData?.rewards ?? [],
    [rewardsData?.rewards]
  );
  const openAllowed =
    rewardsData?.allowOpenRedemptions ?? allowOpenRedemptions;
  const redemptions = redemptionsData?.redemptions ?? [];

  const activeReward = useMemo(
    () => rewards.find((r) => r.id === selectedRewardId) ?? rewards[0] ?? null,
    [rewards, selectedRewardId]
  );

  const eligibleAssessments = useMemo(() => {
    const all = assessmentsData?.assessments ?? [];
    if (!activeReward || activeReward.rewardType !== "SCORE_BOOST") {
      return all;
    }
    if (activeReward.eligibleCategoryIds.length === 0) {
      return all;
    }
    const allowed = new Set(activeReward.eligibleCategoryIds);
    return all.filter((a) => allowed.has(a.categoryId));
  }, [assessmentsData?.assessments, activeReward]);

  const selectedTargetAssessment = useMemo(
    () =>
      eligibleAssessments.find((a) => a.id === targetAssessmentId) ?? null,
    [eligibleAssessments, targetAssessmentId]
  );

  const totalCost = useMemo(() => {
    if (useCustomRequest) {
      return Number.isInteger(customPointsCost) ? customPointsCost : 0;
    }
    if (!activeReward) return 0;
    const count = activeReward.rewardType === "FIXED_PERK" ? 1 : units;
    return count * activeReward.pointCostPerUnit;
  }, [useCustomRequest, customPointsCost, activeReward, units]);

  const projectedBoost = useMemo(() => {
    if (useCustomRequest || !activeReward) return null;
    if (activeReward.rewardType !== "SCORE_BOOST") return null;
    return Number((units * activeReward.scoreValuePerUnit).toFixed(2));
  }, [useCustomRequest, activeReward, units]);

  async function refreshEconomyQueries() {
    await Promise.all([
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
        queryKey: ["subject-assessments", subjectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["subject-standing", subjectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
    ]);
  }

  async function handleSubmitRedemption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setSubmitError(
        "Internet connection required for point redemptions. Reconnect and try again."
      );
      return;
    }
    setSubmitError(null);
    setSubmitSuccess(null);
    setSubmitting(true);

    try {
      const payload = useCustomRequest
        ? {
            isCustomRequest: true,
            customPointsCost,
            targetLabel: targetLabel.trim(),
            studentNote: studentNote.trim() || undefined,
          }
        : {
            rewardItemId: activeReward?.id,
            requestedUnits:
              activeReward?.rewardType === "FIXED_PERK" ? 1 : units,
            targetAssessmentId:
              activeReward?.rewardType === "SCORE_BOOST" && targetAssessmentId
                ? targetAssessmentId
                : undefined,
            targetLabel:
              selectedTargetAssessment?.title ||
              targetLabel.trim() ||
              undefined,
            studentNote: studentNote.trim() || undefined,
          };

      const res = await fetch(`/api/subjects/${subjectId}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        redemption?: RedemptionRequestDto;
      };

      if (!res.ok || !data.redemption) {
        setSubmitError(data.error ?? "Unable to submit redemption request.");
        return;
      }

      setTargetAssessmentId("");
      setTargetLabel("");
      setStudentNote("");
      setUnits(1);
      setSubmitSuccess(
        `Escrowed ${data.redemption.pointsEscrowed} pts. Waiting for teacher approval.`
      );
      await refreshEconomyQueries();
    } catch {
      setSubmitError("Network error while submitting redemption.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelRedemption(redemptionId: string) {
    if (!navigator.onLine) {
      setSubmitError(
        "Internet connection required to cancel a redemption request."
      );
      return;
    }
    setCancellingId(redemptionId);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const res = await fetch(`/api/redemptions/${redemptionId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Unable to cancel redemption.");
        return;
      }
      setSubmitSuccess("Redemption cancelled and points refunded to Available.");
      await refreshEconomyQueries();
    } catch {
      setSubmitError("Network error while cancelling redemption.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-indigo-600" />
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Spend Points &amp; Redemptions
            </h3>
            <p className="text-xs text-slate-500">
              Points are escrowed while your teacher reviews your request.
            </p>
          </div>
        </div>

        {openAllowed && (
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setUseCustomRequest(false)}
              className={cn(
                "rounded-lg px-3 py-1 transition-colors",
                !useCustomRequest
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Reward Catalog
            </button>
            <button
              type="button"
              onClick={() => setUseCustomRequest(true)}
              className={cn(
                "rounded-lg px-3 py-1 transition-colors",
                useCustomRequest
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              )}
            >
              Custom Request
            </button>
          </div>
        )}
      </div>

      {/* Reward Catalog Cards + Request Form */}
      {!isOnline && (
        <OfflineBanner message="Internet connection required for point redemptions and escrow changes." />
      )}
      {loadingRewards ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Loading reward catalog...
        </div>
      ) : rewards.length === 0 && !openAllowed ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Your teacher hasn&apos;t published any rewards for this subject yet.
        </div>
      ) : (
        <form onSubmit={handleSubmitRedemption} className="space-y-4">
          {!useCustomRequest && rewards.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {rewards.map((reward) => {
                const selected = activeReward?.id === reward.id;
                return (
                  <button
                    key={reward.id}
                    type="button"
                    onClick={() => {
                      setSelectedRewardId(reward.id);
                      setTargetAssessmentId("");
                      setUnits(1);
                      setSubmitError(null);
                    }}
                    className={cn(
                      "text-left rounded-xl border p-3.5 transition-colors space-y-1.5",
                      selected
                        ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {reward.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                        {reward.pointCostPerUnit} pts
                        {reward.rewardType === "SCORE_BOOST" ? "/unit" : ""}
                      </span>
                    </div>
                    {reward.description && (
                      <p className="text-xs text-slate-600">
                        {reward.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap pt-0.5 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        {reward.rewardType === "SCORE_BOOST" ? (
                          <>
                            <Sparkles className="h-3 w-3 text-indigo-600" />
                            <span>
                              +{reward.scoreValuePerUnit} score per unit
                            </span>
                          </>
                        ) : (
                          <>
                            <Tag className="h-3 w-3 text-teal-600" />
                            <span>Classroom Perk</span>
                          </>
                        )}
                      </span>
                      {reward.rewardType === "SCORE_BOOST" &&
                        reward.maxBoostPerAssessment !== null && (
                          <span>
                            • Max +{reward.maxBoostPerAssessment} per item
                          </span>
                        )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {useCustomRequest ? (
                <div className="space-y-1">
                  <label
                    htmlFor="redemption-custom-points"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Points to Escrow
                  </label>
                  <input
                    id="redemption-custom-points"
                    type="number"
                    min={1}
                    max={100000}
                    required
                    value={customPointsCost}
                    onChange={(e) =>
                      setCustomPointsCost(
                        Number.parseInt(e.target.value, 10) || 0
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              ) : activeReward?.rewardType === "SCORE_BOOST" ? (
                <div className="space-y-1">
                  <label
                    htmlFor="redemption-units"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Boost Units (+{activeReward.scoreValuePerUnit} each)
                  </label>
                  <input
                    id="redemption-units"
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={units}
                    onChange={(e) =>
                      setUnits(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              ) : null}

              <div
                className={cn(
                  "space-y-1",
                  !useCustomRequest &&
                    activeReward?.rewardType === "FIXED_PERK" &&
                    "sm:col-span-2"
                )}
              >
                {!useCustomRequest &&
                activeReward?.rewardType === "SCORE_BOOST" &&
                eligibleAssessments.length > 0 ? (
                  <>
                    <label
                      htmlFor="redemption-target-assessment"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Target Exam / Quiz / Activity (Required)
                    </label>
                    <select
                      id="redemption-target-assessment"
                      required
                      value={targetAssessmentId}
                      onChange={(e) => setTargetAssessmentId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">Select target assessment...</option>
                      {eligibleAssessments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({a.category.name} •{" "}
                          {a.myScore.status === "GRADED"
                            ? `${a.myScore.rawScore ?? 0}/${a.maxScore}`
                            : a.myScore.status}
                          )
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <label
                      htmlFor="redemption-target-label"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      {useCustomRequest ||
                      activeReward?.rewardType === "SCORE_BOOST"
                        ? "Target Exam / Quiz / Activity (Required)"
                        : "Where to Apply (Optional)"}
                    </label>
                    <input
                      id="redemption-target-label"
                      type="text"
                      maxLength={140}
                      required={
                        useCustomRequest ||
                        activeReward?.rewardType === "SCORE_BOOST"
                      }
                      placeholder={
                        activeReward?.rewardType === "SCORE_BOOST"
                          ? "e.g. Midterm Exam, Quiz 2, Lab 3"
                          : "e.g. Lab Activity 4 deadline"
                      }
                      value={targetLabel}
                      onChange={(e) => setTargetLabel(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="redemption-student-note"
                className="block text-xs font-semibold text-slate-700"
              >
                Student Note (Optional)
              </label>
              <input
                id="redemption-student-note"
                type="text"
                maxLength={280}
                placeholder="Any extra context for your teacher..."
                value={studentNote}
                onChange={(e) => setStudentNote(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <div className="text-xs text-slate-600 space-y-0.5">
                <p>
                  Escrow Cost:{" "}
                  <span className="font-bold text-slate-900">
                    {totalCost} pts
                  </span>
                  {projectedBoost !== null && (
                    <span className="ml-2 font-semibold text-indigo-700">
                      (Projected Boost: +{projectedBoost})
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500">
                  Available after submit: {availableBalance - totalCost} pts
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  !isOnline ||
                  submitting ||
                  isArchived ||
                  totalCost <= 0 ||
                  availableBalance < totalCost ||
                  (!useCustomRequest && !activeReward)
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Gift className="h-3.5 w-3.5" />
                <span>
                  {submitting
                    ? "Submitting..."
                    : `Submit Redemption (${totalCost} pts)`}
                </span>
              </button>
            </div>
          </div>
        </form>
      )}

      {submitError && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700"
        >
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
        >
          {submitSuccess}
        </p>
      )}

      {/* Student Redemption History */}
      <div className="space-y-2.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          My Redemption Requests
        </h4>
        {loadingRedemptions ? (
          <p className="text-xs text-slate-500">Loading redemption history...</p>
        ) : redemptions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            No redemption requests submitted yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {redemptions.map((req) => {
              const badge = getStatusBadge(req.status);
              const StatusIcon = badge.Icon;
              return (
                <div
                  key={req.id}
                  className="p-3.5 flex items-start justify-between gap-3 flex-wrap"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                          badge.className
                        )}
                      >
                        <StatusIcon className="h-3 w-3" />
                        <span>{badge.label}</span>
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {req.isCustomRequest
                          ? "Custom Spend Request"
                          : req.rewardItem?.name ?? "Reward"}
                      </span>
                      {req.projectedScoreBoost !== null && (
                        <span className="text-[11px] font-semibold text-indigo-700">
                          (+{req.projectedScoreBoost} score)
                        </span>
                      )}
                    </div>
                    {req.targetLabel && (
                      <p className="text-xs text-slate-700">
                        Target: <span className="font-medium">{req.targetLabel}</span>
                      </p>
                    )}
                    {req.studentNote && (
                      <p className="text-[11px] text-slate-500">
                        Note: {req.studentNote}
                      </p>
                    )}
                    {req.teacherNote && (
                      <p className="text-[11px] text-slate-600 font-medium">
                        Teacher note: {req.teacherNote}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">
                        {req.pointsEscrowed} pts
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(req.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {req.status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => void handleCancelRedemption(req.id)}
                        disabled={!isOnline || cancellingId === req.id}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        {cancellingId === req.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
