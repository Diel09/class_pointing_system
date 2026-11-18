"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  Save,
  Scale,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { round2, type TermSplitConfig } from "@/lib/grading/computeStanding";
import {
  DEFAULT_PH_GRADE_SCALE,
  DEFAULT_SINGLE_TERM_CATEGORIES,
  type GradeScaleRuleInput,
} from "@/lib/grading/default-scale";
import { cn } from "@/lib/utils";
import {
  findGradeScaleGaps,
  validateGradeScaleRules,
} from "@/lib/validations/grading";

interface ScaleRuleDraft extends GradeScaleRuleInput {
  clientKey: string;
  minPctInput: string;
  maxPctInput: string;
}

let nextScaleDraftCounter = 0;

function createScaleRuleDraft(
  rule: GradeScaleRuleInput & { id?: string }
): ScaleRuleDraft {
  nextScaleDraftCounter += 1;
  return {
    ...rule,
    clientKey: rule.id ?? `scale-rule-${nextScaleDraftCounter}`,
    minPctInput: String(rule.minPct),
    maxPctInput: String(rule.maxPct),
  };
}

function parsePctDraft(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return Number.NaN;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface CategoryDraft {
  id?: string;
  termKey: string;
  name: string;
  categoryType: "ASSESSMENT" | "ATTENDANCE" | "POINTS_PARTICIPATION";
  weightPct: number;
  aggregationMethod: "TOTAL_POINTS" | "EQUAL_AVERAGE";
  targetPointsCap: number | null;
  assessmentCount?: number;
}

interface ComputationResponse {
  standingVisible: boolean;
  lateAttendanceCreditPct: number;
  termSplitConfig: TermSplitConfig | null;
  categories: CategoryDraft[];
}

interface GradeScaleResponse {
  isDefaultTemplate: boolean;
  requireGapFree?: boolean;
  rules: (GradeScaleRuleInput & { id?: string })[];
}

interface TeacherComputationPanelProps {
  subjectId: string;
  isArchived: boolean;
  standingVisible: boolean;
}

export function TeacherComputationPanel({
  subjectId,
  isArchived,
  standingVisible: initialStandingVisible,
}: TeacherComputationPanelProps) {
  const queryClient = useQueryClient();

  const [standingVisible, setStandingVisible] = useState(initialStandingVisible);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  const [lateCreditPct, setLateCreditPct] = useState(50);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [terms, setTerms] = useState([
    { key: "MIDTERM", label: "Midterm", weightPct: 40 },
    { key: "FINALS", label: "Finals", weightPct: 60 },
  ]);
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [compSaving, setCompSaving] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [compSuccess, setCompSuccess] = useState<string | null>(null);

  const [scaleRules, setScaleRules] = useState<ScaleRuleDraft[]>([]);
  const [requireGapFree, setRequireGapFree] = useState(true);
  const [scaleSaving, setScaleSaving] = useState(false);
  const [scaleError, setScaleError] = useState<string | null>(null);
  const [scaleSuccess, setScaleSuccess] = useState<string | null>(null);

  const { data: compData } = useQuery<ComputationResponse>({
    queryKey: ["subject-computation", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/computation`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load computation setup.");
      return (await res.json()) as ComputationResponse;
    },
  });

  const { data: scaleData } = useQuery<GradeScaleResponse>({
    queryKey: ["subject-grade-scale", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/grade-scale`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load grade scale.");
      return (await res.json()) as GradeScaleResponse;
    },
  });

  useEffect(() => {
    setStandingVisible(initialStandingVisible);
  }, [initialStandingVisible]);

  useEffect(() => {
    if (!compData) return;
    setLateCreditPct(compData.lateAttendanceCreditPct);
    const hasSplit = Boolean(compData.termSplitConfig?.enabled);
    setSplitEnabled(hasSplit);
    if (hasSplit && compData.termSplitConfig?.terms.length) {
      setTerms(compData.termSplitConfig.terms);
    }
    if (compData.categories.length > 0) {
      setCategories(compData.categories);
    } else {
      setCategories(DEFAULT_SINGLE_TERM_CATEGORIES);
    }
  }, [compData]);

  useEffect(() => {
    if (!scaleData) return;
    setRequireGapFree(scaleData.requireGapFree ?? true);
    const sourceRules =
      scaleData.rules.length > 0 ? scaleData.rules : DEFAULT_PH_GRADE_SCALE;
    setScaleRules(sourceRules.map(createScaleRuleDraft));
  }, [scaleData]);

  const weightValidation = useMemo(() => {
    if (!splitEnabled) {
      const sum = round2(
        categories
          .filter((c) => c.termKey === "DEFAULT")
          .reduce((acc, c) => acc + (Number(c.weightPct) || 0), 0)
      );
      return {
        valid: Math.abs(sum - 100) <= 0.01,
        message: `Total weight: ${sum}% (must equal 100%)`,
      };
    }

    const termSum = round2(
      terms.reduce((acc, t) => acc + (Number(t.weightPct) || 0), 0)
    );
    if (Math.abs(termSum - 100) > 0.01) {
      return {
        valid: false,
        message: `Term weights total ${termSum}% (must equal 100%)`,
      };
    }

    for (const term of terms) {
      const catSum = round2(
        categories
          .filter((c) => c.termKey === term.key)
          .reduce((acc, c) => acc + (Number(c.weightPct) || 0), 0)
      );
      if (Math.abs(catSum - 100) > 0.01) {
        return {
          valid: false,
          message: `${term.label} categories total ${catSum}% (must equal 100%)`,
        };
      }
    }

    return {
      valid: true,
      message: "Term and category weights total 100%.",
    };
  }, [splitEnabled, terms, categories]);

  const scaleValidationMessage = useMemo(
    () => validateGradeScaleRules(scaleRules, { requireGapFree }),
    [scaleRules, requireGapFree]
  );

  const scaleGaps = useMemo(() => findGradeScaleGaps(scaleRules), [scaleRules]);

  async function handleToggleVisibility() {
    setVisibilitySaving(true);
    const next = !standingVisible;
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standingVisible: next }),
      });
      if (res.ok) {
        setStandingVisible(next);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
          queryClient.invalidateQueries({
            queryKey: ["subject-standing", subjectId],
          }),
        ]);
      }
    } finally {
      setVisibilitySaving(false);
    }
  }

  function handleToggleSplit(nextSplit: boolean) {
    setSplitEnabled(nextSplit);
    setCompError(null);
    if (nextSplit) {
      const hasTermCats = categories.some((c) => c.termKey !== "DEFAULT");
      if (!hasTermCats) {
        setCategories([
          {
            termKey: terms[0]?.key ?? "MIDTERM",
            name: "Quizzes & Labs",
            categoryType: "ASSESSMENT",
            weightPct: 40,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
          {
            termKey: terms[0]?.key ?? "MIDTERM",
            name: "Midterm Exam",
            categoryType: "ASSESSMENT",
            weightPct: 50,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
          {
            termKey: terms[0]?.key ?? "MIDTERM",
            name: "Attendance",
            categoryType: "ATTENDANCE",
            weightPct: 10,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
          {
            termKey: terms[1]?.key ?? "FINALS",
            name: "Quizzes & Labs",
            categoryType: "ASSESSMENT",
            weightPct: 40,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
          {
            termKey: terms[1]?.key ?? "FINALS",
            name: "Final Exam",
            categoryType: "ASSESSMENT",
            weightPct: 50,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
          {
            termKey: terms[1]?.key ?? "FINALS",
            name: "Attendance",
            categoryType: "ATTENDANCE",
            weightPct: 10,
            aggregationMethod: "TOTAL_POINTS",
            targetPointsCap: null,
          },
        ]);
      }
    } else {
      const defaultCats = categories.filter((c) => c.termKey === "DEFAULT");
      if (defaultCats.length > 0) {
        setCategories(defaultCats);
      } else {
        setCategories(DEFAULT_SINGLE_TERM_CATEGORIES);
      }
    }
  }

  function handleAddCategory(termKey: string) {
    setCategories((prev) => [
      ...prev,
      {
        termKey,
        name: "New Category",
        categoryType: "ASSESSMENT",
        weightPct: 10,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: null,
      },
    ]);
  }

  async function handleSaveComputation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCompError(null);
    setCompSuccess(null);
    setCompSaving(true);

    try {
      const activeTermKeys = splitEnabled
        ? new Set(terms.map((t) => t.key))
        : new Set(["DEFAULT"]);

      const payloadCategories = categories
        .filter((c) => activeTermKeys.has(c.termKey))
        .map((c, index) => ({
          ...(c.id ? { id: c.id } : {}),
          termKey: c.termKey,
          name: c.name.trim(),
          categoryType: c.categoryType,
          weightPct: Number(c.weightPct),
          aggregationMethod: c.aggregationMethod,
          targetPointsCap:
            c.categoryType === "POINTS_PARTICIPATION"
              ? Number(c.targetPointsCap ?? 100)
              : null,
          sortOrder: index,
        }));

      const res = await fetch(`/api/subjects/${subjectId}/computation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lateAttendanceCreditPct: Number(lateCreditPct),
          termSplitConfig: splitEnabled
            ? {
                enabled: true,
                terms: terms.map((t) => ({
                  key: t.key.trim(),
                  label: t.label.trim(),
                  weightPct: Number(t.weightPct),
                })),
              }
            : null,
          categories: payloadCategories,
        }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCompError(data.error ?? "Unable to save computation setup.");
        return;
      }

      setCompSuccess("Grade computation formula saved.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
      ]);
    } catch {
      setCompError("Network error while saving computation setup.");
    } finally {
      setCompSaving(false);
    }
  }

  async function handleSaveScale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScaleError(null);
    setScaleSuccess(null);
    setScaleSaving(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/grade-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requireGapFree,
          rules: scaleRules.map((r) => ({
            minPct: Number(r.minPct),
            maxPct: Number(r.maxPct),
            gradeEquivalent: r.gradeEquivalent.trim(),
            label: r.label.trim(),
            isPassing: r.isPassing,
          })),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setScaleError(data.error ?? "Unable to save grade scale.");
        return;
      }
      setScaleSuccess("Grade scale saved.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-grade-scale", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
      ]);
    } catch {
      setScaleError("Network error while saving grade scale.");
    } finally {
      setScaleSaving(false);
    }
  }

  const displayedTerms = splitEnabled
    ? terms
    : [{ key: "DEFAULT", label: "Overall Categories", weightPct: 100 }];

  return (
    <section className="space-y-6">
      {/* Visibility Banner / Toggle */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              standingVisible
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            )}
          >
            {standingVisible ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Student Standing Visibility:{" "}
              {standingVisible ? "Live & Visible" : "Hidden (Encoding Mode)"}
            </h3>
            <p className="text-xs text-slate-500">
              {standingVisible
                ? "Students can view their running percentage, breakdown, and grade equivalent."
                : "Running standings are temporarily hidden from students while you encode or deliberate grades."}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={visibilitySaving || isArchived}
          onClick={() => void handleToggleVisibility()}
          className={cn(
            "rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50",
            standingVisible
              ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          )}
        >
          {visibilitySaving
            ? "Updating..."
            : standingVisible
            ? "Hide Grades (Encoding Mode)"
            : "Publish Grades to Students"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Computation Builder */}
        <form
          onSubmit={handleSaveComputation}
          className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-bold text-slate-900">
                Grade Computation Builder
              </h4>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={splitEnabled}
                onChange={(e) => handleToggleSplit(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Multi-Term Split</span>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="late-attendance-credit"
                className="block text-xs font-medium text-slate-700"
              >
                Late Attendance Credit (%)
              </label>
              <input
                id="late-attendance-credit"
                type="number"
                min={0}
                max={100}
                step="1"
                value={lateCreditPct}
                onChange={(e) =>
                  setLateCreditPct(Number.parseFloat(e.target.value) || 0)
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {splitEnabled && (
              <div className="space-y-1">
                <span className="block text-xs font-medium text-slate-700">
                  Term Split Weights (%)
                </span>
                <div className="flex items-center gap-2">
                  {terms.map((term, idx) => (
                    <div key={term.key} className="flex-1">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        aria-label={`${term.label} weight %`}
                        value={term.weightPct}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value) || 0;
                          setTerms((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, weightPct: val } : item
                            )
                          );
                        }}
                        className="w-full rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                      />
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        {term.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {displayedTerms.map((term) => {
              const termCats = categories
                .map((cat, idx) => ({ cat, idx }))
                .filter(({ cat }) => cat.termKey === term.key);

              return (
                <div
                  key={term.key}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      {term.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddCategory(term.key)}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add Category</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {termCats.map(({ cat, idx }) => (
                      <div
                        key={cat.id ?? `draft-${idx}`}
                        className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2"
                      >
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            required
                            aria-label="Category name"
                            value={cat.name}
                            onChange={(e) =>
                              setCategories((prev) =>
                                prev.map((c, i) =>
                                  i === idx ? { ...c, name: e.target.value } : c
                                )
                              )
                            }
                            className="col-span-6 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-900"
                          />
                          <div className="col-span-4 flex items-center gap-1">
                            <input
                              type="number"
                              min={0.01}
                              max={100}
                              step="0.01"
                              required
                              aria-label="Category weight %"
                              value={cat.weightPct}
                              onChange={(e) =>
                                setCategories((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          weightPct:
                                            Number.parseFloat(e.target.value) ||
                                            0,
                                        }
                                      : c
                                  )
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-900"
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                          <button
                            type="button"
                            disabled={(cat.assessmentCount ?? 0) > 0}
                            title={
                              (cat.assessmentCount ?? 0) > 0
                                ? "Category contains assessments"
                                : "Remove category"
                            }
                            onClick={() =>
                              setCategories((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="col-span-2 flex justify-center rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <select
                            aria-label="Category type"
                            disabled={(cat.assessmentCount ?? 0) > 0}
                            value={cat.categoryType}
                            onChange={(e) =>
                              setCategories((prev) =>
                                prev.map((c, i) =>
                                  i === idx
                                    ? {
                                        ...c,
                                        categoryType: e.target
                                          .value as CategoryDraft["categoryType"],
                                        targetPointsCap:
                                          e.target.value ===
                                          "POINTS_PARTICIPATION"
                                            ? c.targetPointsCap ?? 100
                                            : null,
                                      }
                                    : c
                                )
                              )
                            }
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800"
                          >
                            <option value="ASSESSMENT">Assessment</option>
                            <option value="ATTENDANCE">Attendance</option>
                            <option value="POINTS_PARTICIPATION">
                              Points Participation
                            </option>
                          </select>

                          {cat.categoryType === "ASSESSMENT" ? (
                            <select
                              aria-label="Aggregation method"
                              value={cat.aggregationMethod}
                              onChange={(e) =>
                                setCategories((prev) =>
                                  prev.map((c, i) =>
                                    i === idx
                                      ? {
                                          ...c,
                                          aggregationMethod: e.target
                                            .value as CategoryDraft["aggregationMethod"],
                                        }
                                      : c
                                  )
                                )
                              }
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800"
                            >
                              <option value="TOTAL_POINTS">
                                Total Points Sum
                              </option>
                              <option value="EQUAL_AVERAGE">
                                Equal Weight Average
                              </option>
                            </select>
                          ) : cat.categoryType === "POINTS_PARTICIPATION" ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                placeholder="Cap"
                                aria-label="Target points cap"
                                value={cat.targetPointsCap ?? 100}
                                onChange={(e) =>
                                  setCategories((prev) =>
                                    prev.map((c, i) =>
                                      i === idx
                                        ? {
                                            ...c,
                                            targetPointsCap:
                                              Number.parseInt(
                                                e.target.value,
                                                10
                                              ) || 1,
                                          }
                                        : c
                                    )
                                  )
                                }
                                className="w-full rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-900"
                              />
                              <span className="text-[10px] text-slate-500 shrink-0">
                                pts cap
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500 self-center">
                              Auto from attendance
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p
            className={cn(
              "text-xs font-semibold",
              weightValidation.valid ? "text-emerald-700" : "text-amber-700"
            )}
          >
            {weightValidation.message}
          </p>

          {compError && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700"
            >
              {compError}
            </p>
          )}
          {compSuccess && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800"
            >
              {compSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={compSaving || isArchived || !weightValidation.valid}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{compSaving ? "Saving..." : "Save Computation Rules"}</span>
          </button>
        </form>

        {/* Grade Scale Editor */}
        <form
          onSubmit={handleSaveScale}
          className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-600" />
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Grade Equivalent Scale
                </h4>
                <p className="text-[11px] text-slate-500">
                  {requireGapFree
                    ? "Gap-free & overlap-free brackets from 0.00% to 100.00%+."
                    : "Overlap-free brackets from 0.00% to 100.00%+ (unequal gaps allowed)."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() =>
                  setScaleRules(DEFAULT_PH_GRADE_SCALE.map(createScaleRuleDraft))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset PH 1.00–5.00</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setScaleRules((prev) => [
                    ...prev,
                    createScaleRuleDraft({
                      minPct: 0,
                      maxPct: 0,
                      gradeEquivalent: "1.00",
                      label: "Bracket",
                      isPassing: true,
                    }),
                  ])
                }
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <Plus className="h-3 w-3" />
                <span>Row</span>
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={requireGapFree}
              onChange={(e) => {
                setRequireGapFree(e.target.checked);
                setScaleError(null);
                setScaleSuccess(null);
              }}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Enforce gap-free brackets</span>
          </label>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="pb-2 pr-2">Min %</th>
                  <th className="pb-2 pr-2">Max %</th>
                  <th className="pb-2 pr-2">Grade</th>
                  <th className="pb-2 pr-2">Label</th>
                  <th className="pb-2 pr-2 text-center">Pass</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scaleRules.map((rule, index) => (
                  <tr key={rule.clientKey}>
                    <td className="py-1.5 pr-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={200}
                        aria-label={`Row ${index + 1} min %`}
                        value={rule.minPctInput}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = parsePctDraft(raw);
                          setScaleRules((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    minPctInput: raw,
                                    minPct: parsed,
                                  }
                                : r
                            )
                          );
                        }}
                        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={500}
                        aria-label={`Row ${index + 1} max %`}
                        value={rule.maxPctInput}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = parsePctDraft(raw);
                          setScaleRules((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    maxPctInput: raw,
                                    maxPct: parsed,
                                  }
                                : r
                            )
                          );
                        }}
                        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        type="text"
                        aria-label={`Row ${index + 1} grade`}
                        value={rule.gradeEquivalent}
                        onChange={(e) =>
                          setScaleRules((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, gradeEquivalent: e.target.value }
                                : r
                            )
                          )
                        }
                        className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        type="text"
                        aria-label={`Row ${index + 1} label`}
                        value={rule.label}
                        onChange={(e) =>
                          setScaleRules((prev) =>
                            prev.map((r, i) =>
                              i === index ? { ...r, label: e.target.value } : r
                            )
                          )
                        }
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Row ${index + 1} passing`}
                        checked={rule.isPassing}
                        onChange={(e) =>
                          setScaleRules((prev) =>
                            prev.map((r, i) =>
                              i === index
                                ? { ...r, isPassing: e.target.checked }
                                : r
                            )
                          )
                        }
                        className="rounded border-slate-300 text-indigo-600"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        disabled={scaleRules.length <= 1}
                        onClick={() =>
                          setScaleRules((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                        className="rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scaleValidationMessage ? (
            <p className="text-xs font-semibold text-amber-700">
              {scaleValidationMessage}
            </p>
          ) : !requireGapFree && scaleGaps.length > 0 ? (
            <p className="text-xs font-semibold text-sky-700">
              Overlap-free scale with {scaleGaps.length} custom gap
              {scaleGaps.length === 1 ? "" : "s"} (e.g.{" "}
              {scaleGaps[0]!.fromPct.toFixed(2)}%–{scaleGaps[0]!.toPct.toFixed(2)}
              %). Scores inside a gap map to the lower bracket.
            </p>
          ) : (
            <p className="text-xs font-semibold text-emerald-700">
              Scale covers 0.00% to 100.00%+ with zero gaps or overlaps.
            </p>
          )}

          {scaleError && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700"
            >
              {scaleError}
            </p>
          )}
          {scaleSuccess && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800"
            >
              {scaleSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={scaleSaving || isArchived || Boolean(scaleValidationMessage)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{scaleSaving ? "Saving..." : "Save Grade Scale"}</span>
          </button>
        </form>
      </div>
    </section>
  );
}
