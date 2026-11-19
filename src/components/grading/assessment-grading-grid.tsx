"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Edit3,
  FileSpreadsheet,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { round2 } from "@/lib/grading/computeStanding";
import { parseCsvScores } from "@/lib/validations/grading";

export interface AssessmentScoreDetailDto {
  id: string;
  subjectId: string;
  categoryId: string;
  category: {
    id: string;
    name: string;
    termKey: string;
  };
  title: string;
  description: string | null;
  maxScore: number;
  assessmentDate: string | null;
}

export interface ScoreGridRow {
  enrollmentId: string;
  manualStandingOverride: "NONE" | "INC" | "DRP";
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
  rawScore: number | null;
  bonusPoints: number;
  allowExtraCredit: boolean;
  effectiveScore: number | null;
  remarks: string | null;
}

interface ScoreDraft {
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
  rawScore: string;
  remarks: string;
}

interface AssessmentGradingGridProps {
  subjectId: string;
  assessmentId: string;
  isArchived: boolean;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}

/**
 * Teacher-only student score grading grid for a single assessment.
 * Supports individual score entry, status updates, CSV import, bulk pending actions,
 * and live preview of approved Score Boost bonus points.
 */
export function AssessmentGradingGrid({
  subjectId,
  assessmentId,
  isArchived,
  onUnsavedChangesChange,
}: AssessmentGradingGridProps) {
  const queryClient = useQueryClient();

  const [studentQuery, setStudentQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [savingScores, setSavingScores] = useState(false);
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvSummary, setCsvSummary] = useState<string | null>(null);

  const {
    data: scoresData,
    isLoading: loadingGrid,
    error: gridError,
  } = useQuery<{
    assessment: AssessmentScoreDetailDto;
    rows: ScoreGridRow[];
  }>({
    queryKey: ["assessment-scores", assessmentId],
    queryFn: async () => {
      const res = await fetch(`/api/assessments/${assessmentId}/scores`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Unable to load score grid.");
      }
      return (await res.json()) as {
        assessment: AssessmentScoreDetailDto;
        rows: ScoreGridRow[];
      };
    },
    enabled: Boolean(assessmentId),
  });

  const subjectMismatch =
    Boolean(scoresData?.assessment.subjectId) &&
    scoresData?.assessment.subjectId !== subjectId;

  const filteredScoreRows = useMemo(() => {
    const rows = scoresData?.rows ?? [];
    const q = studentQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.student.fullName.toLowerCase().includes(q) ||
        r.student.email.toLowerCase().includes(q) ||
        (r.student.institutionalId?.toLowerCase().includes(q) ?? false)
    );
  }, [scoresData?.rows, studentQuery]);

  const hasUnsavedChanges = useMemo(() => {
    if (!scoresData?.rows || subjectMismatch) return false;
    return scoresData.rows.some((row) => {
      const draft = drafts[row.enrollmentId];
      if (!draft) return false;
      const serverRaw = row.rawScore !== null ? String(row.rawScore) : "";
      const serverRemarks = row.remarks ?? "";
      return (
        draft.status !== row.status ||
        draft.rawScore !== serverRaw ||
        draft.remarks !== serverRemarks
      );
    });
  }, [scoresData?.rows, drafts, subjectMismatch]);

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    setStudentQuery("");
    setShowCsvImport(false);
    setCsvText("");
    setCsvSummary(null);
    setScoreMessage(null);
    setScoreError(null);
  }, [assessmentId]);

  useEffect(() => {
    if (!scoresData?.rows) return;
    const next: Record<string, ScoreDraft> = {};
    for (const row of scoresData.rows) {
      next[row.enrollmentId] = {
        status: row.status,
        rawScore: row.rawScore !== null ? String(row.rawScore) : "",
        remarks: row.remarks ?? "",
      };
    }
    setDrafts(next);
  }, [scoresData]);

  function handleBulkPending(targetStatus: "MISSING" | "FULL") {
    if (!scoresData) return;
    const targetMax = String(scoresData.assessment.maxScore);
    const visibleIds = new Set(filteredScoreRows.map((r) => r.enrollmentId));
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of scoresData.rows) {
        if (!visibleIds.has(row.enrollmentId)) continue;
        const current = next[row.enrollmentId] ?? {
          status: row.status,
          rawScore: row.rawScore !== null ? String(row.rawScore) : "",
          remarks: row.remarks ?? "",
        };
        if (current.status !== "PENDING") continue;
        next[row.enrollmentId] =
          targetStatus === "MISSING"
            ? { ...current, status: "MISSING", rawScore: "" }
            : { ...current, status: "GRADED", rawScore: targetMax };
      }
      return next;
    });
  }

  async function handleSaveScores() {
    if (!assessmentId || !scoresData || subjectMismatch) return;
    setScoreError(null);
    setScoreMessage(null);

    for (const row of scoresData.rows) {
      const draft = drafts[row.enrollmentId] ?? {
        status: row.status,
        rawScore: row.rawScore !== null ? String(row.rawScore) : "",
        remarks: row.remarks ?? "",
      };
      if (draft.status === "GRADED") {
        const parsedRaw = Number.parseFloat(draft.rawScore);
        if (!Number.isFinite(parsedRaw)) {
          setScoreError(
            `Enter a numeric score for ${row.student.fullName} or change status from Graded.`
          );
          return;
        }
        if (parsedRaw < 0 || parsedRaw > scoresData.assessment.maxScore) {
          setScoreError(
            `Score for ${row.student.fullName} must be between 0 and ${scoresData.assessment.maxScore}.`
          );
          return;
        }
      }
    }

    setSavingScores(true);

    try {
      const payloadScores = scoresData.rows.map((row) => {
        const draft = drafts[row.enrollmentId] ?? {
          status: row.status,
          rawScore: row.rawScore !== null ? String(row.rawScore) : "",
          remarks: row.remarks ?? "",
        };
        const parsedRaw =
          draft.status === "GRADED"
            ? Number.parseFloat(draft.rawScore)
            : null;
        return {
          enrollmentId: row.enrollmentId,
          status: draft.status,
          rawScore:
            draft.status === "GRADED" && Number.isFinite(parsedRaw)
              ? parsedRaw
              : null,
          remarks: draft.remarks.trim() || null,
        };
      });

      const res = await fetch(`/api/assessments/${assessmentId}/scores`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: payloadScores }),
      });
      const data = (await res.json()) as {
        error?: string;
        updatedCount?: number;
      };
      if (!res.ok) {
        setScoreError(data.error ?? "Failed to save scores.");
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["assessment-scores", assessmentId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
      ]);
      setScoreMessage(`Saved ${data.updatedCount ?? 0} student score(s).`);
    } catch {
      setScoreError("Network error while saving scores.");
    } finally {
      setSavingScores(false);
    }
  }

  function handleApplyCsv() {
    if (!scoresData) return;
    const { rows, errors } = parseCsvScores(csvText);
    const byIdentifier = new Map<string, string>();
    for (const r of scoresData.rows) {
      byIdentifier.set(r.student.email.toLowerCase(), r.enrollmentId);
      if (r.student.institutionalId) {
        byIdentifier.set(
          r.student.institutionalId.toUpperCase(),
          r.enrollmentId
        );
      }
    }

    let matched = 0;
    const unmatched: string[] = [];
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const enrollId =
          byIdentifier.get(row.identifier.toLowerCase()) ??
          byIdentifier.get(row.identifier.toUpperCase());
        if (!enrollId) {
          unmatched.push(row.identifier);
          continue;
        }
        matched += 1;
        next[enrollId] = {
          status: row.status,
          rawScore: row.rawScore !== null ? String(row.rawScore) : "",
          remarks: row.remarks ?? prev[enrollId]?.remarks ?? "",
        };
      }
      return next;
    });

    const parts = [
      `Applied ${matched} row(s) to grid (click Save Scores to commit).`,
    ];
    if (unmatched.length > 0) parts.push(`Unmatched: ${unmatched.join(", ")}`);
    if (errors.length > 0) parts.push(`Parse errors: ${errors.join("; ")}`);
    setCsvSummary(parts.join(" "));
  }

  if (loadingGrid) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
        Loading class score grid...
      </div>
    );
  }

  if (gridError || subjectMismatch || !scoresData) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
        {subjectMismatch
          ? "This assessment does not belong to the requested subject."
          : gridError instanceof Error
          ? gridError.message
          : "Assessment not found."}
      </div>
    );
  }

  const { assessment, rows } = scoresData;
  const gradedCount = rows.filter((r) => r.status === "GRADED").length;
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;
  const missingCount = rows.filter((r) => r.status === "MISSING").length;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Edit3 className="h-4 w-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">
              Class Score Grid: {assessment.title} (/{assessment.maxScore})
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
              {assessment.category.name}
              {assessment.category.termKey !== "DEFAULT"
                ? ` (${assessment.category.termKey})`
                : ""}
            </span>
            {assessment.assessmentDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span>{assessment.assessmentDate.slice(0, 10)}</span>
              </span>
            )}
            <span>
              • {gradedCount} graded • {pendingCount} pending • {missingCount}{" "}
              missing
            </span>
          </div>
          {assessment.description && (
            <p className="text-xs text-slate-600">{assessment.description}</p>
          )}
          <p className="text-[11px] text-slate-500">
            Teacher-only score entry. Boost points from approved redemptions
            appear automatically.
          </p>
        </div>

        <button
          type="button"
          disabled={isArchived}
          onClick={() => setShowCsvImport((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>{showCsvImport ? "Hide CSV" : "Import CSV"}</span>
        </button>
      </div>

      {isArchived && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800">
          This subject is archived. Scores are read-only.
        </div>
      )}

      {showCsvImport && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
          <label
            htmlFor="csv-score-import"
            className="block text-xs font-semibold text-slate-700"
          >
            Paste CSV (`email_or_id, score_or_status[, remarks]`)
          </label>
          <textarea
            id="csv-score-import"
            rows={4}
            placeholder={
              "student1@classpulse.local, 45, Good work\n2026-0002, MISSING, Absent"
            }
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
          />
          {csvSummary && (
            <p className="text-[11px] text-indigo-800">{csvSummary}</p>
          )}
          <button
            type="button"
            onClick={handleApplyCsv}
            disabled={!csvText.trim() || isArchived}
            className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Populate Grid from CSV
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          No students enrolled in this subject yet.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Filter students by name or ID..."
                aria-label="Filter students in score grid"
                className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                disabled={isArchived || savingScores}
                onClick={() => handleBulkPending("FULL")}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Set Pending Full Score
              </button>
              <button
                type="button"
                disabled={isArchived || savingScores}
                onClick={() => handleBulkPending("MISSING")}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                Mark Pending Missing (0)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Raw Score</th>
                  <th className="pb-2 pr-3">Boost</th>
                  <th className="pb-2 pr-3">Effective</th>
                  <th className="pb-2">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredScoreRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-4 text-center text-xs text-slate-500"
                    >
                      No enrolled students match &ldquo;{studentQuery}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  filteredScoreRows.map((row) => {
                    const draft = drafts[row.enrollmentId] ?? {
                      status: row.status,
                      rawScore:
                        row.rawScore !== null ? String(row.rawScore) : "",
                      remarks: row.remarks ?? "",
                    };
                    const maxScoreVal = assessment.maxScore;
                    const parsedDraftRaw = Number.parseFloat(draft.rawScore);
                    let effectivePreview = "—";
                    let isCappedPreview = false;

                    if (draft.status === "MISSING") {
                      effectivePreview = `0 / ${maxScoreVal}`;
                    } else if (
                      draft.status === "GRADED" &&
                      Number.isFinite(parsedDraftRaw)
                    ) {
                      const combined = parsedDraftRaw + row.bonusPoints;
                      const effectiveVal = row.allowExtraCredit
                        ? round2(combined)
                        : round2(Math.min(maxScoreVal, combined));
                      isCappedPreview =
                        !row.allowExtraCredit && combined > maxScoreVal;
                      effectivePreview = `${effectiveVal} / ${maxScoreVal}`;
                    }

                    return (
                      <tr key={row.enrollmentId}>
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-slate-900">
                            {row.student.fullName}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {row.student.institutionalId ?? row.student.email}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <select
                            aria-label={`Status for ${row.student.fullName}`}
                            disabled={isArchived}
                            value={draft.status}
                            onChange={(e) => {
                              const nextStatus = e.target
                                .value as ScoreDraft["status"];
                              setDrafts((prev) => ({
                                ...prev,
                                [row.enrollmentId]: {
                                  ...draft,
                                  status: nextStatus,
                                  rawScore:
                                    nextStatus === "GRADED"
                                      ? draft.rawScore || "0"
                                      : "",
                                },
                              }));
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:bg-slate-100"
                          >
                            <option value="PENDING">Pending</option>
                            <option value="GRADED">Graded</option>
                            <option value="MISSING">Missing (0)</option>
                            <option value="EXCUSED">Excused</option>
                          </select>
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            step="0.25"
                            min={0}
                            max={maxScoreVal}
                            placeholder="0"
                            disabled={
                              isArchived ||
                              draft.status === "MISSING" ||
                              draft.status === "EXCUSED"
                            }
                            aria-label={`Score for ${row.student.fullName}`}
                            value={draft.rawScore}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [row.enrollmentId]: {
                                  ...draft,
                                  status:
                                    draft.status === "PENDING" &&
                                    nextVal.trim() !== ""
                                      ? "GRADED"
                                      : draft.status,
                                  rawScore: nextVal,
                                },
                              }));
                            }}
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          {row.bonusPoints > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              <Sparkles className="h-3 w-3" />+
                              {row.bonusPoints}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                          <span>{effectivePreview}</span>
                          {isCappedPreview && (
                            <span className="ml-1 text-[10px] font-sans text-amber-700">
                              (cap)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <input
                            type="text"
                            maxLength={280}
                            disabled={isArchived}
                            placeholder="Optional note..."
                            aria-label={`Remarks for ${row.student.fullName}`}
                            value={draft.remarks}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.enrollmentId]: {
                                  ...draft,
                                  remarks: e.target.value,
                                },
                              }))
                            }
                            className="w-full min-w-[140px] rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {scoreError && (
            <p
              role="alert"
              className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700"
            >
              {scoreError}
            </p>
          )}
          {scoreMessage && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800"
            >
              {scoreMessage}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            {hasUnsavedChanges && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                Unsaved changes
              </span>
            )}
            <button
              type="button"
              disabled={savingScores || isArchived}
              onClick={() => void handleSaveScores()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{savingScores ? "Saving..." : "Save Scores"}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
