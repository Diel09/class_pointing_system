"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  ClipboardList,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ComputeStandingResult } from "@/lib/grading/computeStanding";
import { cn } from "@/lib/utils";
import { parseCsvScores } from "@/lib/validations/grading";

interface GradeCategoryItem {
  id: string;
  termKey: string;
  name: string;
  categoryType: "ASSESSMENT" | "ATTENDANCE" | "POINTS_PARTICIPATION";
}

interface TeacherAssessmentDto {
  id: string;
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
  scoreSummary?: {
    gradedCount: number;
    missingCount: number;
    excusedCount: number;
    pendingCount: number;
    totalStudents: number;
  };
}

interface ScoreGridRow {
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

interface ClassStandingRow {
  enrollmentId: string;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
  standing: ComputeStandingResult;
}

interface TeacherAssessmentsPanelProps {
  subjectId: string;
  isArchived: boolean;
}

export function TeacherAssessmentsPanel({
  subjectId,
  isArchived,
}: TeacherAssessmentsPanelProps) {
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [maxScore, setMaxScore] = useState(50);
  const [assessmentDate, setAssessmentDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedAssessmentId, setSelectedAssessmentId] = useState<
    string | null
  >(null);
  const [drafts, setDrafts] = useState<Record<string, ScoreDraft>>({});
  const [savingScores, setSavingScores] = useState(false);
  const [scoreMessage, setScoreMessage] = useState<string | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvSummary, setCsvSummary] = useState<string | null>(null);

  const [downloadingTarget, setDownloadingTarget] = useState<
    "class" | string | null
  >(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: compData } = useQuery<{ categories: GradeCategoryItem[] }>({
    queryKey: ["subject-computation", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/computation`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load categories.");
      return (await res.json()) as { categories: GradeCategoryItem[] };
    },
  });

  const { data: assessmentsData } = useQuery<{
    assessments: TeacherAssessmentDto[];
  }>({
    queryKey: ["subject-assessments", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/assessments`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load assessments.");
      return (await res.json()) as { assessments: TeacherAssessmentDto[] };
    },
  });

  const { data: scoresData, isLoading: loadingGrid } = useQuery<{
    assessment: TeacherAssessmentDto;
    rows: ScoreGridRow[];
  }>({
    queryKey: ["assessment-scores", selectedAssessmentId],
    queryFn: async () => {
      const res = await fetch(`/api/assessments/${selectedAssessmentId}/scores`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load score grid.");
      return (await res.json()) as {
        assessment: TeacherAssessmentDto;
        rows: ScoreGridRow[];
      };
    },
    enabled: Boolean(selectedAssessmentId),
  });

  const { data: classStandingsData } = useQuery<{
    standings: ClassStandingRow[];
  }>({
    queryKey: ["subject-standing", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/standing`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Unable to load class standings.");
      return (await res.json()) as { standings: ClassStandingRow[] };
    },
  });

  const assessmentCategories = useMemo(
    () =>
      (compData?.categories ?? []).filter(
        (c) => c.categoryType === "ASSESSMENT"
      ),
    [compData?.categories]
  );

  const assessments = useMemo(
    () => assessmentsData?.assessments ?? [],
    [assessmentsData?.assessments]
  );
  const classStandings = classStandingsData?.standings ?? [];

  useEffect(() => {
    if (!categoryId && assessmentCategories.length > 0) {
      setCategoryId(assessmentCategories[0]!.id);
    }
  }, [assessmentCategories, categoryId]);

  useEffect(() => {
    if (!selectedAssessmentId && assessments.length > 0) {
      setSelectedAssessmentId(assessments[0]!.id);
    }
  }, [assessments, selectedAssessmentId]);

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
    setScoreMessage(null);
    setScoreError(null);
  }, [scoresData]);

  async function handleCreateAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          title: title.trim(),
          maxScore: Number(maxScore),
          description: description.trim() || null,
          assessmentDate: assessmentDate
            ? new Date(`${assessmentDate}T00:00:00.000Z`).toISOString()
            : null,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assessment?: TeacherAssessmentDto;
      };
      if (!res.ok || !data.assessment) {
        setCreateError(data.error ?? "Unable to create assessment.");
        return;
      }
      setTitle("");
      setDescription("");
      setAssessmentDate("");
      setShowCreateForm(false);
      setSelectedAssessmentId(data.assessment.id);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
      ]);
    } catch {
      setCreateError("Network error while creating assessment.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteAssessment(assessmentId: string) {
    const res = await fetch(`/api/assessments/${assessmentId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (selectedAssessmentId === assessmentId) {
        setSelectedAssessmentId(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
      ]);
    }
  }

  async function handleSaveScores() {
    if (!selectedAssessmentId || !scoresData) return;
    setSavingScores(true);
    setScoreError(null);
    setScoreMessage(null);

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

      const res = await fetch(
        `/api/assessments/${selectedAssessmentId}/scores`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores: payloadScores }),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        updatedCount?: number;
      };
      if (!res.ok) {
        setScoreError(data.error ?? "Failed to save scores.");
        return;
      }

      setScoreMessage(`Saved ${data.updatedCount ?? 0} student score(s).`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["assessment-scores", selectedAssessmentId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
      ]);
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

    const parts = [`Applied ${matched} row(s) to grid (click Save Scores to commit).`];
    if (unmatched.length > 0) parts.push(`Unmatched: ${unmatched.join(", ")}`);
    if (errors.length > 0) parts.push(`Parse errors: ${errors.join("; ")}`);
    setCsvSummary(parts.join(" "));
  }

  async function handleOverrideChange(
    enrollmentId: string,
    manualStandingOverride: "NONE" | "INC" | "DRP"
  ) {
    const res = await fetch(
      `/api/subjects/${subjectId}/roster/${enrollmentId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualStandingOverride }),
      }
    );
    if (res.ok) {
      await queryClient.invalidateQueries({
        queryKey: ["subject-standing", subjectId],
      });
    }
  }

  async function handleDownloadGradeSheet(enrollmentId?: string) {
    const targetKey = enrollmentId ?? "class";
    setDownloadingTarget(targetKey);
    setDownloadError(null);

    try {
      const url = enrollmentId
        ? `/api/subjects/${subjectId}/grade-sheet?enrollmentId=${encodeURIComponent(
            enrollmentId
          )}`
        : `/api/subjects/${subjectId}/grade-sheet`;

      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        let errorMessage = "Unable to download grade sheet.";
        try {
          const payload = (await res.json()) as { error?: string };
          if (payload.error) errorMessage = payload.error;
        } catch {
          // Ignore non-JSON error body
        }
        setDownloadError(errorMessage);
        return;
      }

      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/i.exec(disposition);
      const filename =
        filenameMatch?.[1] ??
        (enrollmentId ? "student-grade-sheet.csv" : "class-grade-sheet.csv");

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setDownloadError("Network error while downloading grade sheet.");
    } finally {
      setDownloadingTarget(null);
    }
  }

  return (
    <section className="space-y-6">
      {/* Assessments List + Score Grid */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: Assessments List & Creation */}
        <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Assessments ({assessments.length})
              </h3>
            </div>
            <button
              type="button"
              disabled={isArchived || assessmentCategories.length === 0}
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{showCreateForm ? "Close" : "New Assessment"}</span>
            </button>
          </div>

          {assessmentCategories.length === 0 && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              Save at least one Assessment-type category in Computation Setup
              before creating assessments.
            </p>
          )}

          {showCreateForm && (
            <form
              onSubmit={handleCreateAssessment}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3"
            >
              <div className="space-y-1">
                <label
                  htmlFor="assessment-title"
                  className="block text-xs font-medium text-slate-700"
                >
                  Title
                </label>
                <input
                  id="assessment-title"
                  type="text"
                  required
                  placeholder="e.g. Quiz 1: Loops"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor="assessment-category"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Category
                  </label>
                  <select
                    id="assessment-category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    {assessmentCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.termKey !== "DEFAULT" ? ` (${c.termKey})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="assessment-max-score"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Max Score
                  </label>
                  <input
                    id="assessment-max-score"
                    type="number"
                    step="0.5"
                    min="0.5"
                    required
                    value={maxScore}
                    onChange={(e) =>
                      setMaxScore(Number.parseFloat(e.target.value) || 1)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="assessment-date"
                  className="block text-xs font-medium text-slate-700"
                >
                  Date (optional)
                </label>
                <input
                  id="assessment-date"
                  type="date"
                  value={assessmentDate}
                  onChange={(e) => setAssessmentDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="assessment-description"
                  className="block text-xs font-medium text-slate-700"
                >
                  Topics / Notes (optional)
                </label>
                <input
                  id="assessment-description"
                  type="text"
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                />
              </div>

              {createError && (
                <p className="text-xs text-rose-700">{createError}</p>
              )}

              <button
                type="submit"
                disabled={creating || !categoryId}
                className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Assessment"}
              </button>
            </form>
          )}

          {assessments.length === 0 ? (
            <p className="text-xs text-slate-500">
              No assessments yet. Click &ldquo;New Assessment&rdquo; to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {assessments.map((a) => {
                const selected = selectedAssessmentId === a.id;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-xl border p-3 flex items-start justify-between gap-2 transition-colors",
                      selected
                        ? "border-indigo-600 bg-indigo-50/50"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedAssessmentId(a.id)}
                      className="text-left flex-1 min-w-0 space-y-0.5"
                    >
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {a.title}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {a.category.name} • Max {a.maxScore}
                      </p>
                      {a.scoreSummary && (
                        <p className="text-[10px] text-slate-500">
                          {a.scoreSummary.gradedCount} graded •{" "}
                          {a.scoreSummary.pendingCount} pending •{" "}
                          {a.scoreSummary.missingCount} missing
                        </p>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isArchived}
                      onClick={() => void handleDeleteAssessment(a.id)}
                      aria-label={`Delete ${a.title}`}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Class Score Grid */}
        <div className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {scoresData?.assessment
                    ? `Class Score Grid: ${scoresData.assessment.title} (/${scoresData.assessment.maxScore})`
                    : "Class Score Grid"}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Teacher-only score entry. Boost points from approved
                  redemptions appear automatically.
                </p>
              </div>
            </div>

            {scoresData && (
              <button
                type="button"
                onClick={() => setShowCsvImport((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>{showCsvImport ? "Hide CSV" : "Import CSV"}</span>
              </button>
            )}
          </div>

          {showCsvImport && scoresData && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
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
                disabled={!csvText.trim()}
                className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Populate Grid from CSV
              </button>
            </div>
          )}

          {!selectedAssessmentId ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              Select or create an assessment on the left to enter student scores.
            </div>
          ) : loadingGrid ? (
            <p className="text-xs text-slate-500">Loading class roster...</p>
          ) : !scoresData || scoresData.rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              No students enrolled in this subject yet.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="pb-2 pr-2">Student</th>
                      <th className="pb-2 pr-2">Status</th>
                      <th className="pb-2 pr-2">Raw Score</th>
                      <th className="pb-2 pr-2">Boost</th>
                      <th className="pb-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scoresData.rows.map((row) => {
                      const draft = drafts[row.enrollmentId] ?? {
                        status: row.status,
                        rawScore:
                          row.rawScore !== null ? String(row.rawScore) : "",
                        remarks: row.remarks ?? "",
                      };
                      return (
                        <tr key={row.enrollmentId}>
                          <td className="py-2 pr-2">
                            <p className="font-semibold text-slate-900">
                              {row.student.fullName}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {row.student.institutionalId ?? row.student.email}
                            </p>
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              aria-label={`Status for ${row.student.fullName}`}
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
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                            >
                              <option value="PENDING">Pending</option>
                              <option value="GRADED">Graded</option>
                              <option value="MISSING">Missing (0)</option>
                              <option value="EXCUSED">Excused</option>
                            </select>
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              step="0.25"
                              min={0}
                              max={scoresData.assessment.maxScore}
                              disabled={draft.status !== "GRADED"}
                              aria-label={`Score for ${row.student.fullName}`}
                              value={draft.rawScore}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [row.enrollmentId]: {
                                    ...draft,
                                    rawScore: e.target.value,
                                  },
                                }))
                              }
                              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            {row.bonusPoints > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                <Sparkles className="h-3 w-3" />+
                                {row.bonusPoints}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2">
                            <input
                              type="text"
                              maxLength={280}
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
                              className="w-full min-w-[120px] rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            />
                          </td>
                        </tr>
                      );
                    })}
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

              <div className="flex justify-end">
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
      </div>

      {/* Teacher Class Standing Summary Table */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Class Standing Summary ({classStandings.length})
              </h3>
              <p className="text-xs text-slate-500">
                Live calculated standings, manual INC/DRP overrides, and downloadable CSV grade sheets.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={classStandings.length === 0 || downloadingTarget !== null}
            onClick={() => void handleDownloadGradeSheet()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {downloadingTarget === "class"
                ? "Downloading..."
                : "Download Class Grade Sheet (CSV)"}
            </span>
          </button>
        </div>

        {downloadError && (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700"
          >
            {downloadError}
          </p>
        )}

        {classStandings.length === 0 ? (
          <p className="text-xs text-slate-500">No enrolled students yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Running %</th>
                  <th className="pb-2 pr-3">Standing</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Manual Override</th>
                  <th className="pb-2 text-right">Grade Sheet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classStandings.map((row) => (
                  <tr key={row.enrollmentId}>
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold text-slate-900">
                        {row.student.fullName}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {row.student.institutionalId ?? row.student.email}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-slate-800">
                      {row.standing.overallPct !== null
                        ? `${row.standing.overallPct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3 font-bold text-slate-900">
                      {row.standing.effectiveGradeEquivalent ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          row.standing.isOverridden
                            ? "bg-amber-50 text-amber-800"
                            : !row.standing.hasGradedItems
                            ? "bg-slate-100 text-slate-600"
                            : row.standing.isPassing
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        )}
                      >
                        {row.standing.effectiveStatusLabel}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <select
                        aria-label={`Standing override for ${row.student.fullName}`}
                        disabled={isArchived}
                        value={row.standing.manualStandingOverride}
                        onChange={(e) =>
                          void handleOverrideChange(
                            row.enrollmentId,
                            e.target.value as "NONE" | "INC" | "DRP"
                          )
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="NONE">None (Computed)</option>
                        <option value="INC">INC (Incomplete)</option>
                        <option value="DRP">DRP (Dropped)</option>
                      </select>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        aria-label={`Download grade sheet for ${row.student.fullName}`}
                        disabled={downloadingTarget !== null}
                        onClick={() =>
                          void handleDownloadGradeSheet(row.enrollmentId)
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" />
                        <span>
                          {downloadingTarget === row.enrollmentId
                            ? "Downloading..."
                            : "Download"}
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
