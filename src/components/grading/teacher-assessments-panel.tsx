"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Award,
  Check,
  ClipboardList,
  Download,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { type ComputeStandingResult } from "@/lib/grading/computeStanding";
import { DEFAULT_SINGLE_TERM_CATEGORIES } from "@/lib/grading/default-scale";
import { cn } from "@/lib/utils";

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
  submissionEnabled?: boolean;
  dueAt?: string | null;
  allowLateSubmissions?: boolean;
  requirePublicLink?: boolean;
  isGroupMode?: boolean;
  groupSetId?: string | null;
  groupSet?: {
    id: string;
    name: string;
    groupCount?: number;
  } | null;
  hasRecordedWork?: boolean;
  scoreSummary?: {
    gradedCount: number;
    missingCount: number;
    excusedCount: number;
    pendingCount: number;
    totalStudents: number;
  };
  submissionSummary?: {
    totalSubmitted: number;
    lateCount: number;
    totalStudents: number;
    totalGroups?: number;
  };
}

interface GroupSetOption {
  id: string;
  name: string;
  groups: { id: string }[];
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

function toLocalDateTimeInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const [submissionEnabled, setSubmissionEnabled] = useState(false);
  const [dueAtInput, setDueAtInput] = useState("");
  const [allowLateSubmissions, setAllowLateSubmissions] = useState(true);
  const [requirePublicLink, setRequirePublicLink] = useState(true);
  const [isGroupMode, setIsGroupMode] = useState(false);
  const [groupSetId, setGroupSetId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [initializingCategories, setInitializingCategories] = useState(false);
  const [highlightedAssessmentId, setHighlightedAssessmentId] = useState<
    string | null
  >(null);

  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(
    null
  );
  const [editTitle, setEditTitle] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editMaxScore, setEditMaxScore] = useState(50);
  const [editAssessmentDate, setEditAssessmentDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSubmissionEnabled, setEditSubmissionEnabled] = useState(false);
  const [editDueAtInput, setEditDueAtInput] = useState("");
  const [editAllowLateSubmissions, setEditAllowLateSubmissions] =
    useState(true);
  const [editRequirePublicLink, setEditRequirePublicLink] = useState(true);
  const [editIsGroupMode, setEditIsGroupMode] = useState(false);
  const [editGroupSetId, setEditGroupSetId] = useState("");
  const [editHasRecordedWork, setEditHasRecordedWork] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  const { data: groupSetsData } = useQuery<{
    groupSets: GroupSetOption[];
  }>({
    queryKey: ["subject-group-sets", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/group-sets`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { groupSets: [] };
      return (await res.json()) as { groupSets: GroupSetOption[] };
    },
  });

  const groupSets = useMemo(
    () => groupSetsData?.groupSets ?? [],
    [groupSetsData?.groupSets]
  );

  useEffect(() => {
    if (!groupSetId && groupSets.length > 0) {
      setGroupSetId(groupSets[0]!.id);
    }
  }, [groupSets, groupSetId]);

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

  async function handleInitDefaultCategories() {
    setInitializingCategories(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/computation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lateAttendanceCreditPct: 50,
          termSplitConfig: null,
          categories: DEFAULT_SINGLE_TERM_CATEGORIES,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setCreateError(err.error ?? "Unable to initialize categories.");
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
      ]);
    } catch {
      setCreateError("Network error while initializing categories.");
    } finally {
      setInitializingCategories(false);
    }
  }

  function startEditAssessment(assessment: TeacherAssessmentDto) {
    setEditingAssessmentId(assessment.id);
    setEditTitle(assessment.title);
    setEditCategoryId(assessment.categoryId);
    setEditMaxScore(assessment.maxScore);
    setEditAssessmentDate(
      assessment.assessmentDate
        ? assessment.assessmentDate.slice(0, 10)
        : ""
    );
    setEditDescription(assessment.description ?? "");
    setEditSubmissionEnabled(Boolean(assessment.submissionEnabled));
    setEditDueAtInput(toLocalDateTimeInputValue(assessment.dueAt));
    setEditAllowLateSubmissions(assessment.allowLateSubmissions ?? true);
    setEditRequirePublicLink(assessment.requirePublicLink ?? true);
    setEditIsGroupMode(Boolean(assessment.isGroupMode));
    setEditGroupSetId(assessment.groupSetId ?? groupSets[0]?.id ?? "");
    setEditHasRecordedWork(Boolean(assessment.hasRecordedWork));
    setEditError(null);
  }

  async function handleSaveEditAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingAssessmentId) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/assessments/${editingAssessmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: editCategoryId,
          title: editTitle.trim(),
          maxScore: Number(editMaxScore),
          description: editDescription.trim() || null,
          assessmentDate: editAssessmentDate
            ? new Date(`${editAssessmentDate}T00:00:00.000Z`).toISOString()
            : null,
          submissionEnabled: editSubmissionEnabled,
          dueAt:
            editSubmissionEnabled && editDueAtInput
              ? new Date(editDueAtInput).toISOString()
              : null,
          allowLateSubmissions: editAllowLateSubmissions,
          requirePublicLink: editRequirePublicLink,
          ...(!editHasRecordedWork
            ? {
                isGroupMode: editIsGroupMode,
                groupSetId: editIsGroupMode ? editGroupSetId || null : null,
              }
            : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setEditError(data.error ?? "Unable to update assessment.");
        return;
      }
      const updatedId = editingAssessmentId;
      setEditingAssessmentId(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-assessments", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["assessment-scores", updatedId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-standing", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-computation", subjectId],
        }),
      ]);
    } catch {
      setEditError("Network error while updating assessment.");
    } finally {
      setSavingEdit(false);
    }
  }

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
          submissionEnabled,
          dueAt:
            submissionEnabled && dueAtInput
              ? new Date(dueAtInput).toISOString()
              : null,
          allowLateSubmissions,
          requirePublicLink,
          isGroupMode,
          groupSetId: isGroupMode ? groupSetId || null : null,
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
      setSubmissionEnabled(false);
      setDueAtInput("");
      setAllowLateSubmissions(true);
      setRequirePublicLink(true);
      setIsGroupMode(false);
      setShowCreateForm(false);
      setHighlightedAssessmentId(data.assessment.id);
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
      if (highlightedAssessmentId === assessmentId) {
        setHighlightedAssessmentId(null);
      }
      if (editingAssessmentId === assessmentId) {
        setEditingAssessmentId(null);
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
        (enrollmentId ? "student-grade-sheet.xlsx" : "class-grade-sheet.xlsx");

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
      {/* Assessments List & Creation */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2">
            <ClipboardList className="h-4 w-4 text-indigo-600 mt-0.5 sm:mt-0 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Assessments ({assessments.length})
              </h3>
              <p className="text-[11px] text-slate-500">
                Create and manage assessments, then open each assessment to grade students.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isArchived || assessmentCategories.length === 0}
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 min-h-[38px] sm:min-h-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showCreateForm ? "Close" : "New Assessment"}</span>
          </button>
        </div>

          {assessmentCategories.length === 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 space-y-2">
              <p>
                Save at least one Assessment-type category in Computation Setup
                before creating assessments.
              </p>
              <button
                type="button"
                disabled={isArchived || initializingCategories}
                onClick={() => void handleInitDefaultCategories()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                <span>
                  {initializingCategories
                    ? "Loading..."
                    : "Load Default Categories (20/20/50/10)"}
                </span>
              </button>
            </div>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                    className="w-full min-h-[38px] sm:min-h-0 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
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
                    inputMode="decimal"
                    step="0.5"
                    min="0.5"
                    required
                    value={maxScore}
                    onChange={(e) =>
                      setMaxScore(Number.parseFloat(e.target.value) || 1)
                    }
                    className="w-full min-h-[38px] sm:min-h-0 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
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

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    id="assessment-submission-enabled"
                    type="checkbox"
                    checked={submissionEnabled}
                    onChange={(e) => setSubmissionEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                  <span>Allow Google Drive link submissions</span>
                </label>

                {submissionEnabled && (
                  <div className="space-y-2.5 pl-3 sm:pl-5 pt-2 border-t border-slate-100">
                    <div className="space-y-1">
                      <label
                        htmlFor="assessment-due-at"
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Submission Deadline (optional)
                      </label>
                      <input
                        id="assessment-due-at"
                        type="datetime-local"
                        value={dueAtInput}
                        onChange={(e) => setDueAtInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        id="assessment-allow-late"
                        type="checkbox"
                        checked={allowLateSubmissions}
                        onChange={(e) =>
                          setAllowLateSubmissions(e.target.checked)
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      <span>
                        Allow late submissions after deadline (marked as Late)
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        id="assessment-require-public"
                        type="checkbox"
                        checked={requirePublicLink}
                        onChange={(e) =>
                          setRequirePublicLink(e.target.checked)
                        }
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      <span>
                        Require public (&ldquo;Anyone with the link&rdquo;)
                        check before submitting
                        <span className="block text-[10px] text-slate-500">
                          Turn off if students use school-restricted Google
                          Workspace accounts.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    id="assessment-group-mode"
                    type="checkbox"
                    checked={isGroupMode}
                    onChange={(e) => setIsGroupMode(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                  <span>Group Activity (students submit &amp; get graded by group)</span>
                </label>

                {isGroupMode && (
                  <div className="space-y-2 pl-3 sm:pl-5 pt-2 border-t border-slate-100">
                    {groupSets.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 space-y-1">
                        <p>
                          No group sets exist yet for this class. Create one first in Roster &rarr; Student Groups.
                        </p>
                        <Link
                          href={`/subjects/${subjectId}/roster?view=groups`}
                          className="inline-flex items-center font-semibold text-indigo-700 hover:underline"
                        >
                          Manage Group Sets &rarr;
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="assessment-group-set"
                            className="block text-[11px] font-medium text-slate-600"
                          >
                            Group Set
                          </label>
                          <Link
                            href={`/subjects/${subjectId}/roster?view=groups`}
                            className="text-[11px] font-semibold text-indigo-600 hover:underline"
                          >
                            Manage Groups &rarr;
                          </Link>
                        </div>
                        <select
                          id="assessment-group-set"
                          required={isGroupMode}
                          value={groupSetId}
                          onChange={(e) => setGroupSetId(e.target.value)}
                          className="w-full min-h-[38px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        >
                          {groupSets.map((gs) => (
                            <option key={gs.id} value={gs.id}>
                              {gs.name} ({gs.groups.length} groups)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {createError && (
                <p className="text-xs text-rose-700">{createError}</p>
              )}

              <button
                type="submit"
                disabled={
                  creating ||
                  !categoryId ||
                  (isGroupMode && (!groupSetId || groupSets.length === 0))
                }
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
            <div className="space-y-2.5">
              {assessments.map((a) => {
                const isHighlighted = highlightedAssessmentId === a.id;
                const isEditing = editingAssessmentId === a.id;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-xl border p-3.5 space-y-2 transition-colors",
                      isHighlighted
                        ? "border-indigo-600 bg-indigo-50/40"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={handleSaveEditAssessment}
                        className="space-y-2.5"
                      >
                        <input
                          type="text"
                          required
                          aria-label="Edit assessment title"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            aria-label="Edit assessment category"
                            value={editCategoryId}
                            onChange={(e) => setEditCategoryId(e.target.value)}
                            className="w-full min-h-[38px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            {assessmentCategories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            min="0.5"
                            required
                            aria-label="Edit assessment max score"
                            value={editMaxScore}
                            onChange={(e) =>
                              setEditMaxScore(
                                Number.parseFloat(e.target.value) || 1
                              )
                            }
                            className="w-full min-h-[38px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="date"
                            aria-label="Edit assessment date"
                            value={editAssessmentDate}
                            onChange={(e) =>
                              setEditAssessmentDate(e.target.value)
                            }
                            className="w-full min-h-[38px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          />
                          <input
                            type="text"
                            maxLength={1000}
                            placeholder="Notes (optional)"
                            aria-label="Edit assessment notes"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full min-h-[38px] sm:min-h-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                          />
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              aria-label="Edit allow Google Drive submissions"
                              checked={editSubmissionEnabled}
                              onChange={(e) =>
                                setEditSubmissionEnabled(e.target.checked)
                              }
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                            />
                            <span>Allow Google Drive link submissions</span>
                          </label>
                          {editSubmissionEnabled && (
                            <div className="space-y-1.5 pl-3 sm:pl-5">
                              <input
                                type="datetime-local"
                                aria-label="Edit submission deadline"
                                value={editDueAtInput}
                                onChange={(e) =>
                                  setEditDueAtInput(e.target.value)
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                              />
                              <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  aria-label="Edit allow late submissions"
                                  checked={editAllowLateSubmissions}
                                  onChange={(e) =>
                                    setEditAllowLateSubmissions(
                                      e.target.checked
                                    )
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                                />
                                <span>Allow late submissions</span>
                              </label>
                              <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  aria-label="Edit require public Drive link"
                                  checked={editRequirePublicLink}
                                  onChange={(e) =>
                                    setEditRequirePublicLink(e.target.checked)
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                                />
                                <span>
                                  Require public (&ldquo;Anyone with the
                                  link&rdquo;) check
                                </span>
                              </label>
                            </div>
                          )}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              aria-label="Edit group activity mode"
                              disabled={editHasRecordedWork}
                              checked={editIsGroupMode}
                              onChange={(e) =>
                                setEditIsGroupMode(e.target.checked)
                              }
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 disabled:opacity-50"
                            />
                            <span>Group Activity (submit &amp; grade by group)</span>
                          </label>
                          {editHasRecordedWork && (
                            <p className="text-[10px] text-amber-700 pl-5">
                              Group mode cannot be changed once submissions or scores exist.
                            </p>
                          )}
                          {editIsGroupMode && (
                            <div className="pl-3 sm:pl-5">
                              <select
                                aria-label="Edit group set"
                                disabled={editHasRecordedWork}
                                value={editGroupSetId}
                                onChange={(e) =>
                                  setEditGroupSetId(e.target.value)
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-60"
                              >
                                {groupSets.map((gs) => (
                                  <option key={gs.id} value={gs.id}>
                                    {gs.name} ({gs.groups.length} groups)
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        {editError && (
                          <p className="text-[11px] text-rose-700">
                            {editError}
                          </p>
                        )}
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingAssessmentId(null)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            <X className="h-3 w-3" />
                            <span>Cancel</span>
                          </button>
                          <button
                            type="submit"
                            disabled={savingEdit}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" />
                            <span>{savingEdit ? "Saving..." : "Save"}</span>
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-slate-900 line-clamp-2 sm:truncate">
                              {a.title}
                            </p>
                            {a.isGroupMode && (
                              <span className="rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                Group Mode
                                {a.groupSet?.name ? ` • ${a.groupSet.name}` : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            {a.category.name}
                            {a.category.termKey !== "DEFAULT"
                              ? ` (${a.category.termKey})`
                              : ""}{" "}
                            • Max {a.maxScore}
                            {a.assessmentDate
                              ? ` • ${a.assessmentDate.slice(0, 10)}`
                              : ""}
                          </p>
                          {a.description && (
                            <p className="text-[11px] text-slate-500 line-clamp-2 sm:truncate">
                              {a.description}
                            </p>
                          )}
                          {a.scoreSummary && (
                            <p className="text-[11px] text-slate-500">
                              {a.scoreSummary.gradedCount} graded •{" "}
                              {a.scoreSummary.pendingCount} pending •{" "}
                              {a.scoreSummary.missingCount} missing
                              {a.submissionEnabled && a.submissionSummary
                                ? a.isGroupMode
                                  ? ` • ${a.submissionSummary.totalSubmitted}/${
                                      a.submissionSummary.totalGroups ??
                                      a.groupSet?.groupCount ??
                                      0
                                    } groups Drive links submitted${
                                      a.submissionSummary.lateCount > 0
                                        ? ` (${a.submissionSummary.lateCount} late)`
                                        : ""
                                    }`
                                  : ` • ${a.submissionSummary.totalSubmitted}/${a.submissionSummary.totalStudents} Drive links submitted${
                                      a.submissionSummary.lateCount > 0
                                        ? ` (${a.submissionSummary.lateCount} late)`
                                        : ""
                                    }`
                                : ""}
                            </p>
                          )}
                          {a.submissionEnabled && a.dueAt && (
                            <p className="text-[11px] text-indigo-700">
                              Drive due: {new Date(a.dueAt).toLocaleString()}
                              {!a.allowLateSubmissions ? " (hard close)" : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 sm:border-0 sm:pt-0 sm:gap-1.5 sm:shrink-0">
                          <Link
                            href={`/subjects/${subjectId}/assessments/${a.id}`}
                            aria-label={`Grade ${a.isGroupMode ? "groups" : "students"} for ${a.title}`}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                          >
                            <span>
                              {a.isGroupMode ? "Grade Groups" : "Grade Students"}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            disabled={isArchived}
                            onClick={() => startEditAssessment(a)}
                            aria-label={`Edit ${a.title}`}
                            className="inline-flex items-center justify-center min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 rounded-xl sm:rounded-lg border border-slate-200 sm:border-0 p-1.5 text-slate-500 sm:text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isArchived}
                            onClick={() => void handleDeleteAssessment(a.id)}
                            aria-label={`Delete ${a.title}`}
                            className="inline-flex items-center justify-center min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 rounded-xl sm:rounded-lg border border-rose-200/70 sm:border-0 p-1.5 text-rose-500 sm:text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Teacher Class Standing Summary Table */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2">
            <Award className="h-4 w-4 text-indigo-600 mt-0.5 sm:mt-0 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Class Standing Summary ({classStandings.length})
              </h3>
              <p className="text-xs text-slate-500">
                Live calculated standings, manual INC/DRP overrides, and downloadable Excel (.xlsx) grade sheets.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={classStandings.length === 0 || downloadingTarget !== null}
            onClick={() => void handleDownloadGradeSheet()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {downloadingTarget === "class"
                ? "Downloading..."
                : "Download Class Grade Sheet (.xlsx)"}
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
          <div className="md:overflow-x-auto">
            <table className="block w-full text-left text-xs md:table">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="pb-2 pr-3">Student</th>
                  <th className="pb-2 pr-3">Running %</th>
                  <th className="pb-2 pr-3">Standing</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Manual Override</th>
                  <th className="pb-2 text-right">Grade Sheet</th>
                </tr>
              </thead>
              <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100">
                {classStandings.map((row) => (
                  <tr
                    key={row.enrollmentId}
                    className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
                  >
                    <td className="col-span-2 border-b border-slate-100 pb-2 md:table-cell md:border-0 md:py-2.5 md:pr-3">
                      <p className="text-sm font-bold text-slate-900 md:text-xs md:font-semibold">
                        {row.student.fullName}
                      </p>
                      <p className="text-[11px] text-slate-500 md:text-[10px]">
                        {row.student.institutionalId ?? row.student.email}
                      </p>
                    </td>
                    <td className="col-span-1 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 font-mono font-semibold text-slate-800 md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-2.5 md:pr-3">
                      <span
                        aria-hidden="true"
                        className="mb-0.5 block font-sans text-[10px] font-semibold uppercase tracking-wider text-slate-400 md:hidden"
                      >
                        Running %
                      </span>
                      <span>
                        {row.standing.overallPct !== null
                          ? `${row.standing.overallPct.toFixed(2)}%`
                          : "—"}
                      </span>
                    </td>
                    <td className="col-span-1 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 font-bold text-slate-900 md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-2.5 md:pr-3">
                      <span
                        aria-hidden="true"
                        className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 md:hidden"
                      >
                        Standing
                      </span>
                      <span>{row.standing.effectiveGradeEquivalent ?? "—"}</span>
                    </td>
                    <td className="col-span-2 flex items-center justify-between md:table-cell md:py-2.5 md:pr-3">
                      <span
                        aria-hidden="true"
                        className="text-[11px] font-medium text-slate-500 md:hidden"
                      >
                        Status
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
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
                    <td className="col-span-2 md:table-cell md:py-2.5 md:pr-3">
                      <span
                        aria-hidden="true"
                        className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                      >
                        Manual Override
                      </span>
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
                        className="w-full md:w-auto min-h-[38px] md:min-h-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs"
                      >
                        <option value="NONE">None (Computed)</option>
                        <option value="INC">INC (Incomplete)</option>
                        <option value="DRP">DRP (Dropped)</option>
                      </select>
                    </td>
                    <td className="col-span-2 pt-1 md:table-cell md:pt-0 md:py-2.5 md:text-right">
                      <button
                        type="button"
                        aria-label={`Download grade sheet for ${row.student.fullName}`}
                        disabled={downloadingTarget !== null}
                        onClick={() =>
                          void handleDownloadGradeSheet(row.enrollmentId)
                        }
                        className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] md:min-h-0 rounded-xl md:rounded-lg border border-slate-200 bg-slate-50 md:bg-white px-3 md:px-2.5 py-1.5 md:py-1 text-xs md:text-[11px] font-semibold text-slate-700 hover:bg-slate-100 md:hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5 md:h-3 md:w-3" />
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
