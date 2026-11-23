"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  Gift,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { RewardItemDto } from "./student-redemptions-panel";

interface TeacherRedemptionItem {
  id: string;
  isCustomRequest: boolean;
  targetLabel: string | null;
  pointsEscrowed: number;
  requestedUnits: number;
  projectedScoreBoost: number | null;
  studentNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  teacherNote: string | null;
  createdAt: string;
  rewardItem: {
    id: string;
    name: string;
    rewardType: "SCORE_BOOST" | "FIXED_PERK";
    pointCostPerUnit: number;
    scoreValuePerUnit: number;
    allowExtraCredit: boolean;
  } | null;
  targetAssessment?: {
    id: string;
    title: string;
    maxScore: number;
    currentScore: {
      status: string;
      rawScore: number | null;
      bonusPoints: number;
      allowExtraCredit: boolean;
    } | null;
  };
  enrollment?: {
    id: string;
    availableBalance: number;
    escrowedBalance: number;
    student: {
      id: string;
      fullName: string;
      institutionalId: string | null;
      email: string;
    };
  };
}

interface TeacherEconomyPanelProps {
  subjectId: string;
  isArchived: boolean;
  allowP2pTransfers: boolean;
  p2pMaxPerTransfer: number | null;
  p2pMaxPerDay: number | null;
  p2pMaxPerTerm: number | null;
  allowOpenRedemptions: boolean;
  isOwner?: boolean;
}

function parseOptionalCap(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function TeacherEconomyPanel({
  subjectId,
  isArchived,
  allowP2pTransfers,
  p2pMaxPerTransfer,
  p2pMaxPerDay,
  p2pMaxPerTerm,
  allowOpenRedemptions,
  isOwner = true,
}: TeacherEconomyPanelProps) {
  const queryClient = useQueryClient();

  // Guardrails state
  const [p2pEnabled, setP2pEnabled] = useState(allowP2pTransfers);
  const [openRedemptions, setOpenRedemptions] = useState(allowOpenRedemptions);
  const [maxPerTransfer, setMaxPerTransfer] = useState(
    p2pMaxPerTransfer !== null ? String(p2pMaxPerTransfer) : ""
  );
  const [maxPerDay, setMaxPerDay] = useState(
    p2pMaxPerDay !== null ? String(p2pMaxPerDay) : ""
  );
  const [maxPerTerm, setMaxPerTerm] = useState(
    p2pMaxPerTerm !== null ? String(p2pMaxPerTerm) : ""
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  // Reward CRUD state
  const [showRewardForm, setShowRewardForm] = useState(false);
  const [rewardName, setRewardName] = useState("");
  const [rewardType, setRewardType] = useState<"SCORE_BOOST" | "FIXED_PERK">(
    "SCORE_BOOST"
  );
  const [pointCostPerUnit, setPointCostPerUnit] = useState(10);
  const [scoreValuePerUnit, setScoreValuePerUnit] = useState(1);
  const [maxBoostPerAssessment, setMaxBoostPerAssessment] = useState("");
  const [allowExtraCredit, setAllowExtraCredit] = useState(false);
  const [eligibleCategoryIds, setEligibleCategoryIds] = useState<string[]>([]);
  const [rewardDescription, setRewardDescription] = useState("");
  const [rewardSaving, setRewardSaving] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);

  // Redemptions queue state
  const [queueFilter, setQueueFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const { data: rewardsData } = useQuery<{ rewards: RewardItemDto[] }>({
    queryKey: ["subject-rewards-teacher", subjectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/subjects/${subjectId}/rewards?includeInactive=true`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("Unable to load rewards.");
      return (await res.json()) as { rewards: RewardItemDto[] };
    },
  });

  const { data: redemptionsData } = useQuery<{
    redemptions: TeacherRedemptionItem[];
  }>({
    queryKey: ["subject-redemptions-teacher", subjectId, queueFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/subjects/${subjectId}/redemptions?status=${queueFilter}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("Unable to load redemption queue.");
      return (await res.json()) as { redemptions: TeacherRedemptionItem[] };
    },
  });

  const { data: compData } = useQuery<{
    categories: { id: string; name: string; categoryType: string }[];
  }>({
    queryKey: ["subject-computation", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/computation`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { categories: [] };
      return (await res.json()) as {
        categories: { id: string; name: string; categoryType: string }[];
      };
    },
  });

  const assessmentCategories = (compData?.categories ?? []).filter(
    (c) => c.categoryType === "ASSESSMENT"
  );

  const rewards = rewardsData?.rewards ?? [];
  const redemptions = redemptionsData?.redemptions ?? [];

  async function saveEconomySettings(overrides?: {
    allowP2pTransfers?: boolean;
    allowOpenRedemptions?: boolean;
  }) {
    setSettingsSaving(true);
    setSettingsMessage(null);
    try {
      const nextP2p = overrides?.allowP2pTransfers ?? p2pEnabled;
      const nextOpen = overrides?.allowOpenRedemptions ?? openRedemptions;
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowP2pTransfers: nextP2p,
          allowOpenRedemptions: nextOpen,
          p2pMaxPerTransfer: parseOptionalCap(maxPerTransfer),
          p2pMaxPerDay: parseOptionalCap(maxPerDay),
          p2pMaxPerTerm: parseOptionalCap(maxPerTerm),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setSettingsMessage(err.error ?? "Unable to save settings.");
        return;
      }
      setSettingsMessage("Point economy guardrails saved.");
      await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
      await queryClient.invalidateQueries({
        queryKey: ["subject-rewards", subjectId],
      });
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleSaveSettingsForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveEconomySettings();
  }

  async function handleCreateReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRewardError(null);
    setRewardSaving(true);

    try {
      const maxBoost = maxBoostPerAssessment.trim()
        ? Number.parseFloat(maxBoostPerAssessment)
        : null;
      const res = await fetch(`/api/subjects/${subjectId}/rewards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rewardName.trim(),
          description: rewardDescription.trim() || null,
          rewardType,
          pointCostPerUnit,
          scoreValuePerUnit:
            rewardType === "SCORE_BOOST" ? scoreValuePerUnit : 1,
          allowExtraCredit:
            rewardType === "SCORE_BOOST" ? allowExtraCredit : false,
          eligibleCategoryIds:
            rewardType === "SCORE_BOOST" ? eligibleCategoryIds : [],
          maxBoostPerAssessment:
            rewardType === "SCORE_BOOST" ? maxBoost : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRewardError(data.error ?? "Unable to create reward.");
        return;
      }
      setRewardName("");
      setRewardDescription("");
      setMaxBoostPerAssessment("");
      setAllowExtraCredit(false);
      setEligibleCategoryIds([]);
      setShowRewardForm(false);
      await queryClient.invalidateQueries({
        queryKey: ["subject-rewards-teacher", subjectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["subject-rewards", subjectId],
      });
    } catch {
      setRewardError("Network error while creating reward.");
    } finally {
      setRewardSaving(false);
    }
  }

  async function handleToggleRewardActive(reward: RewardItemDto) {
    await fetch(`/api/subjects/${subjectId}/rewards/${reward.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !reward.isActive }),
    });
    await queryClient.invalidateQueries({
      queryKey: ["subject-rewards-teacher", subjectId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["subject-rewards", subjectId],
    });
  }

  async function handleReviewRedemption(
    redemptionId: string,
    decision: "APPROVE" | "REJECT"
  ) {
    setReviewingId(redemptionId);
    setReviewError(null);
    try {
      const res = await fetch(`/api/redemptions/${redemptionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          teacherNote: reviewNotes[redemptionId]?.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setReviewError(data.error ?? "Unable to review redemption.");
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-redemptions-teacher", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-roster", subjectId],
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
        queryClient.invalidateQueries({
          queryKey: ["assessment-scores"],
        }),
      ]);
    } catch {
      setReviewError("Network error while reviewing redemption.");
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <section className="space-y-6">
      {/* 1. P2P & Redemption Guardrails (Owner only) */}
      {isOwner && (
      <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-600" />
          <div>
            <h3 className="text-base font-bold text-slate-900">
              P2P Sharing &amp; Redemption Guardrails
            </h3>
            <p className="text-xs text-slate-500">
              Control peer-to-peer QR transfers, anti-farming caps, and custom
              spend requests.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveSettingsForm} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  Allow P2P Transfers
                </p>
                <p className="text-[11px] text-slate-500">
                  Students can share points via same-subject QR.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={p2pEnabled}
                aria-label="Allow P2P Transfers"
                disabled={settingsSaving}
                onClick={() => {
                  const next = !p2pEnabled;
                  setP2pEnabled(next);
                  void saveEconomySettings({ allowP2pTransfers: next });
                }}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  p2pEnabled ? "bg-indigo-600" : "bg-slate-300"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    p2pEnabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  Allow Open Redemptions
                </p>
                <p className="text-[11px] text-slate-500">
                  Students can submit custom spend proposals.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={openRedemptions}
                aria-label="Allow Open Redemptions"
                disabled={settingsSaving}
                onClick={() => {
                  const next = !openRedemptions;
                  setOpenRedemptions(next);
                  void saveEconomySettings({ allowOpenRedemptions: next });
                }}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  openRedemptions ? "bg-indigo-600" : "bg-slate-300"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    openRedemptions ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label
                htmlFor="p2p-max-transfer"
                className="block text-xs font-medium text-slate-700"
              >
                Max per Transfer (pts)
              </label>
              <input
                id="p2p-max-transfer"
                type="number"
                min={1}
                placeholder="No limit"
                value={maxPerTransfer}
                onChange={(e) => setMaxPerTransfer(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="p2p-max-day"
                className="block text-xs font-medium text-slate-700"
              >
                Max per Day (pts)
              </label>
              <input
                id="p2p-max-day"
                type="number"
                min={1}
                placeholder="No limit"
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="p2p-max-term"
                className="block text-xs font-medium text-slate-700"
              >
                Max per Term (pts)
              </label>
              <input
                id="p2p-max-term"
                type="number"
                min={1}
                placeholder="No limit"
                value={maxPerTerm}
                onChange={(e) => setMaxPerTerm(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            {settingsMessage ? (
              <p className="text-xs font-medium text-emerald-700">
                {settingsMessage}
              </p>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={settingsSaving}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {settingsSaving ? "Saving..." : "Save Guardrails"}
            </button>
          </div>
        </form>
      </div>
      )}

      {/* 2. Reward Catalog Management & Pending Redemptions Queue */}
      <div className={cn("grid gap-6", isOwner ? "lg:grid-cols-5" : "grid-cols-1")}>
        {/* Reward Catalog CRUD (Owner only) */}
        {isOwner && (
        <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-bold text-slate-900">
                Reward Catalog
              </h4>
            </div>
            <button
              type="button"
              disabled={isArchived}
              onClick={() => setShowRewardForm((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{showRewardForm ? "Close" : "New Reward"}</span>
            </button>
          </div>

          {showRewardForm && (
            <form
              onSubmit={handleCreateReward}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3"
            >
              <div className="space-y-1">
                <label
                  htmlFor="reward-name"
                  className="block text-xs font-medium text-slate-700"
                >
                  Reward Name
                </label>
                <input
                  id="reward-name"
                  type="text"
                  required
                  placeholder="e.g. Exam Score Boost"
                  value={rewardName}
                  onChange={(e) => setRewardName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor="reward-type"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Type
                  </label>
                  <select
                    id="reward-type"
                    value={rewardType}
                    onChange={(e) =>
                      setRewardType(
                        e.target.value as "SCORE_BOOST" | "FIXED_PERK"
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="SCORE_BOOST">Score Boost</option>
                    <option value="FIXED_PERK">Fixed Perk</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="reward-cost"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Point Cost
                  </label>
                  <input
                    id="reward-cost"
                    type="number"
                    min={1}
                    required
                    value={pointCostPerUnit}
                    onChange={(e) =>
                      setPointCostPerUnit(
                        Number.parseInt(e.target.value, 10) || 1
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {rewardType === "SCORE_BOOST" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="reward-score-val"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Score / Unit
                      </label>
                      <input
                        id="reward-score-val"
                        type="number"
                        step="0.25"
                        min="0.25"
                        required
                        value={scoreValuePerUnit}
                        onChange={(e) =>
                          setScoreValuePerUnit(
                            Number.parseFloat(e.target.value) || 1
                          )
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="reward-max-boost"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Max Boost / Item
                      </label>
                      <input
                        id="reward-max-boost"
                        type="number"
                        step="0.5"
                        min="0.25"
                        placeholder="Optional"
                        value={maxBoostPerAssessment}
                        onChange={(e) =>
                          setMaxBoostPerAssessment(e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={allowExtraCredit}
                      onChange={(e) => setAllowExtraCredit(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Allow extra credit above assessment max score</span>
                  </label>
                  {assessmentCategories.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-[11px] font-medium text-slate-600">
                        Eligible Categories (leave unchecked for all):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {assessmentCategories.map((cat) => {
                          const checked = eligibleCategoryIds.includes(cat.id);
                          return (
                            <label
                              key={cat.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEligibleCategoryIds((prev) =>
                                    e.target.checked
                                      ? [...prev, cat.id]
                                      : prev.filter((id) => id !== cat.id)
                                  )
                                }
                                className="rounded border-slate-300 text-indigo-600"
                              />
                              <span>{cat.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="reward-desc"
                  className="block text-xs font-medium text-slate-700"
                >
                  Description (optional)
                </label>
                <input
                  id="reward-desc"
                  type="text"
                  maxLength={300}
                  value={rewardDescription}
                  onChange={(e) => setRewardDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {rewardError && (
                <p className="text-xs text-rose-700">{rewardError}</p>
              )}

              <button
                type="submit"
                disabled={rewardSaving}
                className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {rewardSaving ? "Creating..." : "Create Reward"}
              </button>
            </form>
          )}

          {rewards.length === 0 ? (
            <p className="text-xs text-slate-500">
              No rewards created yet. Click &ldquo;New Reward&rdquo; to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {rewards.map((reward) => (
                <div
                  key={reward.id}
                  className={cn(
                    "rounded-xl border p-3 flex items-start justify-between gap-2",
                    reward.isActive
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50 opacity-70"
                  )}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        {reward.name}
                      </span>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                        {reward.pointCostPerUnit} pts
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {reward.rewardType === "SCORE_BOOST"
                        ? `+${reward.scoreValuePerUnit} score/unit${
                            reward.maxBoostPerAssessment !== null
                              ? ` • max +${reward.maxBoostPerAssessment}`
                              : ""
                          }`
                        : "Fixed Perk"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleRewardActive(reward)}
                    title={reward.isActive ? "Archive reward" : "Reactivate reward"}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  >
                    {reward.isActive ? (
                      <Archive className="h-3.5 w-3.5" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Pending Redemptions Queue */}
        <div className={cn("rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4", isOwner ? "lg:col-span-3" : "")}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h4 className="text-sm font-bold text-slate-900">
                Redemptions Approval Queue
              </h4>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setQueueFilter("PENDING")}
                className={cn(
                  "rounded-lg px-2.5 py-1",
                  queueFilter === "PENDING"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-600"
                )}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setQueueFilter("ALL")}
                className={cn(
                  "rounded-lg px-2.5 py-1",
                  queueFilter === "ALL"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-600"
                )}
              >
                All
              </button>
            </div>
          </div>

          {reviewError && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700"
            >
              {reviewError}
            </p>
          )}

          {redemptions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              {queueFilter === "PENDING"
                ? "No pending redemption requests right now."
                : "No redemption requests found for this subject."}
            </div>
          ) : (
            <div className="space-y-3">
              {redemptions.map((req) => (
                <div
                  key={req.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">
                          {req.enrollment?.student.fullName ?? "Student"}
                        </span>
                        {req.enrollment?.student.institutionalId && (
                          <span className="text-[11px] font-mono text-slate-500">
                            {req.enrollment.student.institutionalId}
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold border",
                            req.status === "PENDING"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : req.status === "APPROVED"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          )}
                        >
                          {req.status}
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-indigo-800 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {req.isCustomRequest
                            ? "Custom Spend Request"
                            : req.rewardItem?.name ?? "Reward"}
                          {req.projectedScoreBoost !== null
                            ? ` (+${req.projectedScoreBoost} score boost)`
                            : ""}
                        </span>
                      </p>

                      {req.targetLabel && (
                        <p className="text-xs text-slate-700">
                          Target:{" "}
                          <span className="font-semibold">{req.targetLabel}</span>
                          {req.targetAssessment && (
                            <span className="ml-2 text-[11px] text-slate-500">
                              (Current:{" "}
                              {req.targetAssessment.currentScore?.status ===
                              "GRADED"
                                ? `${
                                    (req.targetAssessment.currentScore
                                      .rawScore ?? 0) +
                                    req.targetAssessment.currentScore.bonusPoints
                                  }/${req.targetAssessment.maxScore}`
                                : req.targetAssessment.currentScore?.status ??
                                  "PENDING"}
                              {req.targetAssessment.currentScore?.status ===
                                "GRADED" &&
                              req.projectedScoreBoost !== null
                                ? ` → Projected: ${
                                    req.rewardItem?.allowExtraCredit
                                      ? (req.targetAssessment.currentScore
                                          .rawScore ?? 0) +
                                        req.targetAssessment.currentScore
                                          .bonusPoints +
                                        req.projectedScoreBoost
                                      : Math.min(
                                          req.targetAssessment.maxScore,
                                          (req.targetAssessment.currentScore
                                            .rawScore ?? 0) +
                                            req.targetAssessment.currentScore
                                              .bonusPoints +
                                            req.projectedScoreBoost
                                        )
                                  }/${req.targetAssessment.maxScore}`
                                : ""}
                              )
                            </span>
                          )}
                        </p>
                      )}
                      {req.studentNote && (
                        <p className="text-[11px] text-slate-500">
                          Student note: {req.studentNote}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-base font-bold text-slate-900">
                        {req.pointsEscrowed} pts
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Escrowed
                      </p>
                    </div>
                  </div>

                  {req.status === "PENDING" ? (
                    <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-200">
                      <input
                        type="text"
                        placeholder="Optional teacher note / reason..."
                        aria-label={`Review note for ${
                          req.enrollment?.student.fullName ?? "student"
                        }`}
                        value={reviewNotes[req.id] ?? ""}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({
                            ...prev,
                            [req.id]: e.target.value,
                          }))
                        }
                        className="flex-1 min-w-[160px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={reviewingId === req.id || isArchived}
                        onClick={() =>
                          void handleReviewRedemption(req.id, "APPROVE")
                        }
                        className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === req.id || isArchived}
                        onClick={() =>
                          void handleReviewRedemption(req.id, "REJECT")
                        }
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  ) : (
                    req.teacherNote && (
                      <p className="text-[11px] text-slate-600 border-t border-slate-200 pt-2">
                        Teacher note: {req.teacherNote}
                      </p>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
