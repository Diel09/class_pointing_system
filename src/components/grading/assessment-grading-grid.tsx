"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Save,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
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
  submissionEnabled?: boolean;
  dueAt?: string | null;
  allowLateSubmissions?: boolean;
  requirePublicLink?: boolean;
  isGroupMode?: boolean;
  groupSetId?: string | null;
  groupSet?: {
    id: string;
    name: string;
  } | null;
}

export interface ScoreGridSubmissionDto {
  id: string;
  normalizedUrl: string;
  status: "SUBMITTED" | "LATE";
  accessStatus: "PUBLIC_VERIFIED" | "UNVERIFIED" | "PRIVATE_OR_RESTRICTED";
  studentNote: string | null;
  submittedAt: string;
  updatedAt: string;
  submittedByName?: string | null;
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
  isGroupOverride?: boolean;
  effectiveScore: number | null;
  remarks: string | null;
  submission?: ScoreGridSubmissionDto | null;
}

export interface GroupScoreGridRow {
  groupId: string;
  groupName: string;
  sortOrder: number;
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
  rawScore: number | null;
  remarks: string | null;
  updatedAt: string | null;
  submission: ScoreGridSubmissionDto | null;
  members: ScoreGridRow[];
}

interface ScoreDraft {
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
  rawScore: string;
  remarks: string;
}

interface MemberOverrideDraft extends ScoreDraft {
  isGroupOverride: boolean;
}

function computeEffectivePreview(
  status: ScoreDraft["status"],
  rawScoreStr: string,
  bonusPoints: number,
  allowExtraCredit: boolean,
  maxScoreVal: number
): { label: string; isCapped: boolean } {
  if (status === "MISSING") {
    return { label: `0 / ${maxScoreVal}`, isCapped: false };
  }
  const parsedRaw = Number.parseFloat(rawScoreStr);
  if (status === "GRADED" && Number.isFinite(parsedRaw)) {
    const combined = parsedRaw + bonusPoints;
    const effectiveVal = allowExtraCredit
      ? round2(combined)
      : round2(Math.min(maxScoreVal, combined));
    return {
      label: `${effectiveVal} / ${maxScoreVal}`,
      isCapped: !allowExtraCredit && combined > maxScoreVal,
    };
  }
  return { label: "—", isCapped: false };
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
  const [groupDrafts, setGroupDrafts] = useState<Record<string, ScoreDraft>>({});
  const [memberOverrideDrafts, setMemberOverrideDrafts] = useState<
    Record<string, MemberOverrideDraft>
  >({});
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set()
  );
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
    groupRows?: GroupScoreGridRow[];
    ungroupedRows?: ScoreGridRow[];
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
        groupRows?: GroupScoreGridRow[];
        ungroupedRows?: ScoreGridRow[];
      };
    },
    enabled: Boolean(assessmentId),
  });

  const subjectMismatch =
    Boolean(scoresData?.assessment.subjectId) &&
    scoresData?.assessment.subjectId !== subjectId;

  const isGroupMode = Boolean(scoresData?.assessment.isGroupMode);

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

  const filteredGroupRows = useMemo(() => {
    const groups = scoresData?.groupRows ?? [];
    const q = studentQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.groupName.toLowerCase().includes(q) ||
        g.members.some(
          (m) =>
            m.student.fullName.toLowerCase().includes(q) ||
            m.student.email.toLowerCase().includes(q) ||
            (m.student.institutionalId?.toLowerCase().includes(q) ?? false)
        )
    );
  }, [scoresData?.groupRows, studentQuery]);

  const filteredUngroupedRows = useMemo(() => {
    const ungrouped = scoresData?.ungroupedRows ?? [];
    const q = studentQuery.trim().toLowerCase();
    if (!q) return ungrouped;
    return ungrouped.filter(
      (r) =>
        r.student.fullName.toLowerCase().includes(q) ||
        r.student.email.toLowerCase().includes(q) ||
        (r.student.institutionalId?.toLowerCase().includes(q) ?? false)
    );
  }, [scoresData?.ungroupedRows, studentQuery]);

  const hasUnsavedChanges = useMemo(() => {
    if (!scoresData || subjectMismatch) return false;
    if (isGroupMode) {
      const groupDirty = (scoresData.groupRows ?? []).some((g) => {
        const draft = groupDrafts[g.groupId];
        if (!draft) return false;
        const serverRaw = g.rawScore !== null ? String(g.rawScore) : "";
        const serverRemarks = g.remarks ?? "";
        return (
          draft.status !== g.status ||
          draft.rawScore !== serverRaw ||
          draft.remarks !== serverRemarks
        );
      });
      if (groupDirty) return true;

      const allMembers = [
        ...(scoresData.groupRows ?? []).flatMap((g) => g.members),
        ...(scoresData.ungroupedRows ?? []),
      ];
      return allMembers.some((m) => {
        const draft = memberOverrideDrafts[m.enrollmentId];
        if (!draft) return false;
        const serverOverride = Boolean(m.isGroupOverride);
        if (draft.isGroupOverride !== serverOverride) return true;
        if (!draft.isGroupOverride && m.status === draft.status) {
          // If still following group, check only ungrouped students
        }
        const serverRaw = m.rawScore !== null ? String(m.rawScore) : "";
        const serverRemarks = m.remarks ?? "";
        const isUngrouped = (scoresData.ungroupedRows ?? []).some(
          (u) => u.enrollmentId === m.enrollmentId
        );
        if (!draft.isGroupOverride && !isUngrouped) return false;
        return (
          draft.status !== m.status ||
          draft.rawScore !== serverRaw ||
          draft.remarks !== serverRemarks
        );
      });
    }

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
  }, [
    scoresData,
    drafts,
    groupDrafts,
    memberOverrideDrafts,
    isGroupMode,
    subjectMismatch,
  ]);

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
    setExpandedGroupIds(new Set());
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

    if (scoresData.assessment.isGroupMode) {
      const nextGroups: Record<string, ScoreDraft> = {};
      const nextOverrides: Record<string, MemberOverrideDraft> = {};
      for (const g of scoresData.groupRows ?? []) {
        nextGroups[g.groupId] = {
          status: g.status,
          rawScore: g.rawScore !== null ? String(g.rawScore) : "",
          remarks: g.remarks ?? "",
        };
        for (const m of g.members) {
          nextOverrides[m.enrollmentId] = {
            isGroupOverride: Boolean(m.isGroupOverride),
            status: m.status,
            rawScore: m.rawScore !== null ? String(m.rawScore) : "",
            remarks: m.remarks ?? "",
          };
        }
      }
      for (const u of scoresData.ungroupedRows ?? []) {
        nextOverrides[u.enrollmentId] = {
          isGroupOverride: true,
          status: u.status,
          rawScore: u.rawScore !== null ? String(u.rawScore) : "",
          remarks: u.remarks ?? "",
        };
      }
      setGroupDrafts(nextGroups);
      setMemberOverrideDrafts(nextOverrides);
    }
  }, [scoresData]);

  function toggleGroupExpanded(groupId: string) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function handleBulkPending(targetStatus: "MISSING" | "FULL") {
    if (!scoresData) return;
    const targetMax = String(scoresData.assessment.maxScore);
    if (isGroupMode) {
      const visibleGroupIds = new Set(filteredGroupRows.map((g) => g.groupId));
      setGroupDrafts((prev) => {
        const next = { ...prev };
        for (const g of scoresData.groupRows ?? []) {
          if (!visibleGroupIds.has(g.groupId)) continue;
          const current = next[g.groupId] ?? {
            status: g.status,
            rawScore: g.rawScore !== null ? String(g.rawScore) : "",
            remarks: g.remarks ?? "",
          };
          if (current.status !== "PENDING") continue;
          next[g.groupId] =
            targetStatus === "MISSING"
              ? { ...current, status: "MISSING", rawScore: "" }
              : { ...current, status: "GRADED", rawScore: targetMax };
        }
        return next;
      });
      return;
    }

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

    if (isGroupMode) {
      const groupRows = scoresData.groupRows ?? [];
      const ungroupedRows = scoresData.ungroupedRows ?? [];

      for (const g of groupRows) {
        const draft = groupDrafts[g.groupId] ?? {
          status: g.status,
          rawScore: g.rawScore !== null ? String(g.rawScore) : "",
          remarks: g.remarks ?? "",
        };
        if (draft.status === "GRADED") {
          const parsedRaw = Number.parseFloat(draft.rawScore);
          if (!Number.isFinite(parsedRaw)) {
            setScoreError(
              `Enter a numeric score for ${g.groupName} or change status from Graded.`
            );
            return;
          }
          if (parsedRaw < 0 || parsedRaw > scoresData.assessment.maxScore) {
            setScoreError(
              `Score for ${g.groupName} must be between 0 and ${scoresData.assessment.maxScore}.`
            );
            return;
          }
        }
      }

      const memberCandidates = [
        ...groupRows.flatMap((g) => g.members),
        ...ungroupedRows,
      ];
      for (const m of memberCandidates) {
        const draft = memberOverrideDrafts[m.enrollmentId];
        if (!draft || !draft.isGroupOverride) continue;
        if (draft.status === "GRADED") {
          const parsedRaw = Number.parseFloat(draft.rawScore);
          if (!Number.isFinite(parsedRaw)) {
            setScoreError(
              `Enter a numeric score for ${m.student.fullName} or change status from Graded.`
            );
            return;
          }
          if (parsedRaw < 0 || parsedRaw > scoresData.assessment.maxScore) {
            setScoreError(
              `Score for ${m.student.fullName} must be between 0 and ${scoresData.assessment.maxScore}.`
            );
            return;
          }
        }
      }

      setSavingScores(true);
      try {
        const payloadGroupScores = groupRows.map((g) => {
          const draft = groupDrafts[g.groupId] ?? {
            status: g.status,
            rawScore: g.rawScore !== null ? String(g.rawScore) : "",
            remarks: g.remarks ?? "",
          };
          const parsedRaw =
            draft.status === "GRADED"
              ? Number.parseFloat(draft.rawScore)
              : null;
          return {
            groupId: g.groupId,
            status: draft.status,
            rawScore:
              draft.status === "GRADED" && Number.isFinite(parsedRaw)
                ? parsedRaw
                : null,
            remarks: draft.remarks.trim() || null,
          };
        });

        const payloadMemberScores = memberCandidates
          .map((m) => {
            const isUngrouped = ungroupedRows.some(
              (u) => u.enrollmentId === m.enrollmentId
            );
            const draft = memberOverrideDrafts[m.enrollmentId];
            if (!draft) return null;
            if (!draft.isGroupOverride && !isUngrouped) return null;
            const parsedRaw =
              draft.status === "GRADED"
                ? Number.parseFloat(draft.rawScore)
                : null;
            return {
              enrollmentId: m.enrollmentId,
              isGroupOverride: !isUngrouped && draft.isGroupOverride,
              status: draft.status,
              rawScore:
                draft.status === "GRADED" && Number.isFinite(parsedRaw)
                  ? parsedRaw
                  : null,
              remarks: draft.remarks.trim() || null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const res = await fetch(`/api/assessments/${assessmentId}/scores`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupScores: payloadGroupScores,
            memberScores: payloadMemberScores,
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          updatedGroupsCount?: number;
          updatedCount?: number;
        };
        if (!res.ok) {
          setScoreError(data.error ?? "Failed to save group scores.");
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
        setScoreMessage(
          `Saved ${data.updatedGroupsCount ?? payloadGroupScores.length} group(s) (${data.updatedCount ?? 0} student score(s) synced).`
        );
      } catch {
        setScoreError("Network error while saving group scores.");
      } finally {
        setSavingScores(false);
      }
      return;
    }

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

    if (isGroupMode) {
      const groupByName = new Map<string, string>();
      for (const g of scoresData.groupRows ?? []) {
        groupByName.set(g.groupName.toLowerCase(), g.groupId);
      }
      const studentByIdentifier = new Map<string, string>();
      for (const r of scoresData.rows) {
        studentByIdentifier.set(r.student.email.toLowerCase(), r.enrollmentId);
        if (r.student.institutionalId) {
          studentByIdentifier.set(
            r.student.institutionalId.toUpperCase(),
            r.enrollmentId
          );
        }
      }

      let matched = 0;
      const unmatched: string[] = [];
      const nextGroups = { ...groupDrafts };
      const nextOverrides = { ...memberOverrideDrafts };

      for (const row of rows) {
        const gId = groupByName.get(row.identifier.toLowerCase());
        if (gId) {
          matched += 1;
          nextGroups[gId] = {
            status: row.status,
            rawScore: row.rawScore !== null ? String(row.rawScore) : "",
            remarks: row.remarks ?? nextGroups[gId]?.remarks ?? "",
          };
          continue;
        }
        const enrollId =
          studentByIdentifier.get(row.identifier.toLowerCase()) ??
          studentByIdentifier.get(row.identifier.toUpperCase());
        if (enrollId) {
          matched += 1;
          nextOverrides[enrollId] = {
            isGroupOverride: true,
            status: row.status,
            rawScore: row.rawScore !== null ? String(row.rawScore) : "",
            remarks: row.remarks ?? nextOverrides[enrollId]?.remarks ?? "",
          };
          continue;
        }
        unmatched.push(row.identifier);
      }

      setGroupDrafts(nextGroups);
      setMemberOverrideDrafts(nextOverrides);
      const parts = [
        `Applied ${matched} row(s) to grid (click Save Scores to commit).`,
      ];
      if (unmatched.length > 0) parts.push(`Unmatched: ${unmatched.join(", ")}`);
      if (errors.length > 0) parts.push(`Parse errors: ${errors.join("; ")}`);
      setCsvSummary(parts.join(" "));
      return;
    }

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

  const { assessment, rows, groupRows = [] } = scoresData;
  const gradedCount = isGroupMode
    ? groupRows.filter((g) => (groupDrafts[g.groupId]?.status ?? g.status) === "GRADED").length
    : rows.filter((r) => r.status === "GRADED").length;
  const pendingCount = isGroupMode
    ? groupRows.filter((g) => (groupDrafts[g.groupId]?.status ?? g.status) === "PENDING").length
    : rows.filter((r) => r.status === "PENDING").length;
  const missingCount = isGroupMode
    ? groupRows.filter((g) => (groupDrafts[g.groupId]?.status ?? g.status) === "MISSING").length
    : rows.filter((r) => r.status === "MISSING").length;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-6 shadow-sm space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-indigo-600 shrink-0" />
            <h2 className="text-base font-bold text-slate-900 leading-snug">
              {isGroupMode ? "Group Score Grid" : "Class Score Grid"}: {assessment.title} (/{assessment.maxScore})
            </h2>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-500">
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
              {assessment.category.name}
              {assessment.category.termKey !== "DEFAULT"
                ? ` (${assessment.category.termKey})`
                : ""}
            </span>
            {isGroupMode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                <Users className="h-3 w-3" />
                <span>
                  Group Mode
                  {assessment.groupSet?.name ? ` • ${assessment.groupSet.name}` : ""}
                </span>
              </span>
            )}
            {assessment.assessmentDate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                <Calendar className="h-3 w-3 text-slate-500" />
                <span>{assessment.assessmentDate.slice(0, 10)}</span>
              </span>
            )}
            <span className="rounded-full bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
              {gradedCount} {isGroupMode ? "groups " : ""}graded
            </span>
            <span className="rounded-full bg-amber-50 border border-amber-200/70 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {pendingCount} pending
            </span>
            <span className="rounded-full bg-rose-50 border border-rose-200/70 px-2 py-0.5 text-[11px] font-medium text-rose-800">
              {missingCount} missing
            </span>
            {assessment.submissionEnabled && (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                Drive Links Enabled
                {assessment.dueAt
                  ? ` (Due ${new Date(assessment.dueAt).toLocaleString()})`
                  : ""}
              </span>
            )}
          </div>
          {assessment.description && (
            <p className="text-xs text-slate-600">{assessment.description}</p>
          )}
          <p className="text-[11px] text-slate-500">
            {isGroupMode
              ? "Grade by group below. Expand any group to customize an individual student's score while keeping Score Boosts separate."
              : "Teacher-only score entry. Boost points from approved redemptions appear automatically."}
          </p>
        </div>

        <button
          type="button"
          disabled={isArchived}
          onClick={() => setShowCsvImport((prev) => !prev)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 shrink-0"
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
            {isGroupMode
              ? "Paste CSV (`group_name_or_student_id, score_or_status[, remarks]`)"
              : "Paste CSV (`email_or_id, score_or_status[, remarks]`)"}
          </label>
          <textarea
            id="csv-score-import"
            rows={4}
            placeholder={
              isGroupMode
                ? "Group 1, 45, Great teamwork\nGroup 2, 42, Clear slides"
                : "student1@classpulse.local, 45, Good work\n2026-0002, MISSING, Absent"
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
            className="w-full sm:w-auto min-h-[38px] sm:min-h-0 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="relative w-full sm:flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder={
                  isGroupMode
                    ? "Filter groups or students..."
                    : "Filter students by name or ID..."
                }
                aria-label={
                  isGroupMode
                    ? "Filter groups or students in score grid"
                    : "Filter students in score grid"
                }
                className="w-full min-h-[38px] sm:min-h-0 rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-sm sm:text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button
                type="button"
                disabled={isArchived || savingScores}
                onClick={() => handleBulkPending("FULL")}
                className="min-h-[38px] sm:min-h-0 rounded-xl sm:rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 text-center"
              >
                Set Pending Full Score
              </button>
              <button
                type="button"
                disabled={isArchived || savingScores}
                onClick={() => handleBulkPending("MISSING")}
                className="min-h-[38px] sm:min-h-0 rounded-xl sm:rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 text-center"
              >
                Mark Pending Missing (0)
              </button>
            </div>
          </div>

          {isGroupMode ? (
            <div className="space-y-4">
              {groupRows.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-900 space-y-2">
                  <p className="font-semibold">
                    No groups have been created in &ldquo;{assessment.groupSet?.name ?? "Group Set"}&rdquo; yet.
                  </p>
                  <Link
                    href={`/subjects/${subjectId}/roster?view=groups`}
                    className="inline-flex items-center font-semibold text-indigo-700 hover:underline"
                  >
                    Manage Student Groups &rarr;
                  </Link>
                </div>
              ) : (
                <div className="md:overflow-x-auto">
                  <table className="block w-full text-left text-xs md:table">
                    <thead className="hidden md:table-header-group">
                      <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="pb-2 pr-3">Group &amp; Members</th>
                        {assessment.submissionEnabled && (
                          <th className="pb-2 pr-3">Group Drive Submission</th>
                        )}
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2 pr-3">Group Score</th>
                        <th className="pb-2">Group Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100">
                      {filteredGroupRows.length === 0 ? (
                        <tr className="block rounded-xl border border-slate-200 bg-slate-50 md:table-row md:rounded-none md:border-0 md:bg-transparent">
                          <td
                            colSpan={assessment.submissionEnabled ? 5 : 4}
                            className="block py-6 text-center text-xs text-slate-500 md:table-cell md:py-4"
                          >
                            No groups or members match &ldquo;{studentQuery}&rdquo;.
                          </td>
                        </tr>
                      ) : (
                        filteredGroupRows.map((group) => {
                          const gDraft = groupDrafts[group.groupId] ?? {
                            status: group.status,
                            rawScore:
                              group.rawScore !== null
                                ? String(group.rawScore)
                                : "",
                            remarks: group.remarks ?? "",
                          };
                          const isExpanded = expandedGroupIds.has(
                            group.groupId
                          );
                          const overrideCount = group.members.filter(
                            (m) =>
                              memberOverrideDrafts[m.enrollmentId]
                                ?.isGroupOverride
                          ).length;

                          return (
                            <Fragment key={group.groupId}>
                              <tr className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
                                <td className="col-span-2 border-b border-slate-100 pb-2 md:table-cell md:border-0 md:py-3 md:pr-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1 min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="text-sm font-bold text-slate-900 md:text-xs md:font-bold">
                                          {group.groupName}
                                        </p>
                                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                          {group.members.length} members
                                        </span>
                                        {overrideCount > 0 && (
                                          <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                            {overrideCount} custom
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-slate-500">
                                        {group.members.length > 0
                                          ? group.members
                                              .map((m) => m.student.fullName)
                                              .join(", ")
                                          : "No members assigned"}
                                      </p>
                                    </div>
                                    {group.members.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleGroupExpanded(group.groupId)
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 shrink-0"
                                      >
                                        {isExpanded ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                        <span>
                                          {isExpanded ? "Hide" : "Members"}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </td>

                                {assessment.submissionEnabled && (
                                  <td className="col-span-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-3 md:pr-3">
                                    <span
                                      aria-hidden="true"
                                      className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                                    >
                                      Group Drive Submission
                                    </span>
                                    {group.submission ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <a
                                            href={group.submission.normalizedUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 md:px-2 md:py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                          >
                                            <span>Open Drive</span>
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                          <span
                                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                              group.submission.status === "LATE"
                                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                            }`}
                                          >
                                            {group.submission.status === "LATE"
                                              ? "Late"
                                              : "On time"}
                                          </span>
                                          {group.submission.accessStatus ===
                                            "UNVERIFIED" && (
                                            <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                              Unverified
                                            </span>
                                          )}
                                          {group.submission.accessStatus ===
                                            "PRIVATE_OR_RESTRICTED" && (
                                            <span className="rounded-full bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                              School/Restricted
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-slate-500">
                                          {group.submission.submittedByName
                                            ? `By ${group.submission.submittedByName} • `
                                            : ""}
                                          {new Date(
                                            group.submission.updatedAt
                                          ).toLocaleString()}
                                        </p>
                                        {group.submission.studentNote && (
                                          <p className="text-[11px] md:text-[10px] text-slate-600 break-words md:max-w-[200px] md:truncate">
                                            Note: {group.submission.studentNote}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-[11px] text-slate-400">
                                        Not submitted
                                      </span>
                                    )}
                                  </td>
                                )}

                                <td className="col-span-1 md:table-cell md:py-3 md:pr-3">
                                  <span
                                    aria-hidden="true"
                                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                                  >
                                    Status
                                  </span>
                                  <select
                                    aria-label={`Status for ${group.groupName}`}
                                    disabled={isArchived}
                                    value={gDraft.status}
                                    onChange={(e) => {
                                      const nextStatus = e.target
                                        .value as ScoreDraft["status"];
                                      setGroupDrafts((prev) => ({
                                        ...prev,
                                        [group.groupId]: {
                                          ...gDraft,
                                          status: nextStatus,
                                          rawScore:
                                            nextStatus === "GRADED"
                                              ? gDraft.rawScore || "0"
                                              : "",
                                        },
                                      }));
                                    }}
                                    className="w-full md:w-auto min-h-[40px] md:min-h-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                                  >
                                    <option value="PENDING">Pending</option>
                                    <option value="GRADED">Graded</option>
                                    <option value="MISSING">Missing (0)</option>
                                    <option value="EXCUSED">Excused</option>
                                  </select>
                                </td>

                                <td className="col-span-1 md:table-cell md:py-3 md:pr-3">
                                  <span
                                    aria-hidden="true"
                                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                                  >
                                    Group Score (/{assessment.maxScore})
                                  </span>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.25"
                                    min={0}
                                    max={assessment.maxScore}
                                    placeholder="0"
                                    disabled={
                                      isArchived ||
                                      gDraft.status === "MISSING" ||
                                      gDraft.status === "EXCUSED"
                                    }
                                    aria-label={`Score for ${group.groupName}`}
                                    value={gDraft.rawScore}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setGroupDrafts((prev) => ({
                                        ...prev,
                                        [group.groupId]: {
                                          ...gDraft,
                                          status:
                                            gDraft.status === "PENDING" &&
                                            nextVal.trim() !== ""
                                              ? "GRADED"
                                              : gDraft.status,
                                          rawScore: nextVal,
                                        },
                                      }));
                                    }}
                                    className="w-full md:w-24 min-h-[40px] md:min-h-0 rounded-lg border border-slate-300 px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                                  />
                                </td>

                                <td className="col-span-2 md:table-cell md:py-3">
                                  <span
                                    aria-hidden="true"
                                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                                  >
                                    Group Remarks
                                  </span>
                                  <input
                                    type="text"
                                    maxLength={280}
                                    disabled={isArchived}
                                    placeholder="Group feedback..."
                                    aria-label={`Remarks for ${group.groupName}`}
                                    value={gDraft.remarks}
                                    onChange={(e) =>
                                      setGroupDrafts((prev) => ({
                                        ...prev,
                                        [group.groupId]: {
                                          ...gDraft,
                                          remarks: e.target.value,
                                        },
                                      }))
                                    }
                                    className="w-full md:min-w-[160px] min-h-[38px] md:min-h-0 rounded-lg border border-slate-300 px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                                  />
                                </td>
                              </tr>

                              {isExpanded && group.members.length > 0 && (
                                <tr className="block md:table-row bg-slate-50/80">
                                  <td
                                    colSpan={assessment.submissionEnabled ? 5 : 4}
                                    className="block md:table-cell p-3 sm:p-4 border-t border-slate-100"
                                  >
                                    <div className="space-y-2">
                                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                        {group.groupName} — Member Scores &amp; Individual Overrides
                                      </p>
                                      <div className="divide-y divide-slate-200/70 rounded-xl border border-slate-200 bg-white">
                                        {group.members.map((member) => {
                                          const mDraft =
                                            memberOverrideDrafts[
                                              member.enrollmentId
                                            ] ?? {
                                              isGroupOverride: Boolean(
                                                member.isGroupOverride
                                              ),
                                              status: member.status,
                                              rawScore:
                                                member.rawScore !== null
                                                  ? String(member.rawScore)
                                                  : "",
                                              remarks: member.remarks ?? "",
                                            };
                                          const effectiveSource =
                                            mDraft.isGroupOverride
                                              ? mDraft
                                              : gDraft;
                                          const preview = computeEffectivePreview(
                                            effectiveSource.status,
                                            effectiveSource.rawScore,
                                            member.bonusPoints,
                                            member.allowExtraCredit,
                                            assessment.maxScore
                                          );

                                          return (
                                            <div
                                              key={member.enrollmentId}
                                              className="p-2.5 sm:px-3 grid gap-2 sm:grid-cols-12 sm:items-center text-xs"
                                            >
                                              <div className="sm:col-span-3 min-w-0">
                                                <p className="font-semibold text-slate-900 truncate">
                                                  {member.student.fullName}
                                                </p>
                                                <p className="text-[10px] text-slate-500 truncate">
                                                  {member.student.institutionalId ??
                                                    member.student.email}
                                                </p>
                                              </div>

                                              <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
                                                <input
                                                  type="checkbox"
                                                  disabled={isArchived}
                                                  checked={
                                                    mDraft.isGroupOverride
                                                  }
                                                  onChange={(e) => {
                                                    const checked =
                                                      e.target.checked;
                                                    setMemberOverrideDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [member.enrollmentId]: {
                                                          isGroupOverride:
                                                            checked,
                                                          status: checked
                                                            ? gDraft.status
                                                            : mDraft.status,
                                                          rawScore: checked
                                                            ? gDraft.rawScore
                                                            : mDraft.rawScore,
                                                          remarks: checked
                                                            ? gDraft.remarks
                                                            : mDraft.remarks,
                                                        },
                                                      })
                                                    );
                                                  }}
                                                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                                                />
                                                <span>Override</span>
                                              </label>

                                              <div className="sm:col-span-2">
                                                <select
                                                  aria-label={`Override status for ${member.student.fullName}`}
                                                  disabled={
                                                    isArchived ||
                                                    !mDraft.isGroupOverride
                                                  }
                                                  value={effectiveSource.status}
                                                  onChange={(e) => {
                                                    const nextStatus = e.target
                                                      .value as ScoreDraft["status"];
                                                    setMemberOverrideDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [member.enrollmentId]: {
                                                          ...mDraft,
                                                          isGroupOverride: true,
                                                          status: nextStatus,
                                                          rawScore:
                                                            nextStatus ===
                                                            "GRADED"
                                                              ? mDraft.rawScore ||
                                                                "0"
                                                              : "",
                                                        },
                                                      })
                                                    );
                                                  }}
                                                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
                                                >
                                                  <option value="PENDING">
                                                    Pending
                                                  </option>
                                                  <option value="GRADED">
                                                    Graded
                                                  </option>
                                                  <option value="MISSING">
                                                    Missing (0)
                                                  </option>
                                                  <option value="EXCUSED">
                                                    Excused
                                                  </option>
                                                </select>
                                              </div>

                                              <div className="sm:col-span-1">
                                                <input
                                                  type="number"
                                                  inputMode="decimal"
                                                  step="0.25"
                                                  min={0}
                                                  max={assessment.maxScore}
                                                  disabled={
                                                    isArchived ||
                                                    !mDraft.isGroupOverride ||
                                                    effectiveSource.status ===
                                                      "MISSING" ||
                                                    effectiveSource.status ===
                                                      "EXCUSED"
                                                  }
                                                  aria-label={`Override score for ${member.student.fullName}`}
                                                  value={
                                                    effectiveSource.rawScore
                                                  }
                                                  onChange={(e) => {
                                                    const nextVal =
                                                      e.target.value;
                                                    setMemberOverrideDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [member.enrollmentId]: {
                                                          ...mDraft,
                                                          isGroupOverride: true,
                                                          status:
                                                            mDraft.status ===
                                                              "PENDING" &&
                                                            nextVal.trim() !==
                                                              ""
                                                              ? "GRADED"
                                                              : mDraft.status,
                                                          rawScore: nextVal,
                                                        },
                                                      })
                                                    );
                                                  }}
                                                  className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
                                                />
                                              </div>

                                              <div className="sm:col-span-2 flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-800">
                                                {member.bonusPoints > 0 && (
                                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-indigo-700">
                                                    <Sparkles className="h-2.5 w-2.5" />
                                                    +{member.bonusPoints}
                                                  </span>
                                                )}
                                                <span>{preview.label}</span>
                                                {preview.isCapped && (
                                                  <span className="font-sans text-[10px] text-amber-700">
                                                    (cap)
                                                  </span>
                                                )}
                                              </div>

                                              <div className="sm:col-span-2">
                                                <input
                                                  type="text"
                                                  maxLength={280}
                                                  disabled={
                                                    isArchived ||
                                                    !mDraft.isGroupOverride
                                                  }
                                                  placeholder="Member note..."
                                                  aria-label={`Override remarks for ${member.student.fullName}`}
                                                  value={
                                                    effectiveSource.remarks
                                                  }
                                                  onChange={(e) =>
                                                    setMemberOverrideDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [member.enrollmentId]: {
                                                          ...mDraft,
                                                          isGroupOverride: true,
                                                          remarks:
                                                            e.target.value,
                                                        },
                                                      })
                                                    )
                                                  }
                                                  className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
                                                />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {filteredUngroupedRows.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs font-bold text-amber-900">
                      Ungrouped Students ({filteredUngroupedRows.length}) — cannot submit until assigned to a group
                    </p>
                    <Link
                      href={`/subjects/${subjectId}/roster?view=groups`}
                      className="text-xs font-semibold text-indigo-700 hover:underline"
                    >
                      Assign Groups &rarr;
                    </Link>
                  </div>
                  <div className="divide-y divide-amber-200/60 rounded-xl border border-amber-200 bg-white">
                    {filteredUngroupedRows.map((u) => {
                      const uDraft = memberOverrideDrafts[u.enrollmentId] ?? {
                        isGroupOverride: true,
                        status: u.status,
                        rawScore: u.rawScore !== null ? String(u.rawScore) : "",
                        remarks: u.remarks ?? "",
                      };
                      return (
                        <div
                          key={u.enrollmentId}
                          className="p-2.5 sm:px-3 grid gap-2 sm:grid-cols-12 sm:items-center text-xs"
                        >
                          <div className="sm:col-span-4 min-w-0">
                            <p className="font-semibold text-slate-900 truncate">
                              {u.student.fullName}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {u.student.institutionalId ?? u.student.email}
                            </p>
                          </div>
                          <div className="sm:col-span-2">
                            <select
                              aria-label={`Status for ${u.student.fullName}`}
                              disabled={isArchived}
                              value={uDraft.status}
                              onChange={(e) => {
                                const nextStatus = e.target
                                  .value as ScoreDraft["status"];
                                setMemberOverrideDrafts((prev) => ({
                                  ...prev,
                                  [u.enrollmentId]: {
                                    ...uDraft,
                                    isGroupOverride: true,
                                    status: nextStatus,
                                    rawScore:
                                      nextStatus === "GRADED"
                                        ? uDraft.rawScore || "0"
                                        : "",
                                  },
                                }));
                              }}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                            >
                              <option value="PENDING">Pending</option>
                              <option value="GRADED">Graded</option>
                              <option value="MISSING">Missing (0)</option>
                              <option value="EXCUSED">Excused</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.25"
                              min={0}
                              max={assessment.maxScore}
                              disabled={
                                isArchived ||
                                uDraft.status === "MISSING" ||
                                uDraft.status === "EXCUSED"
                              }
                              aria-label={`Score for ${u.student.fullName}`}
                              value={uDraft.rawScore}
                              onChange={(e) => {
                                const nextVal = e.target.value;
                                setMemberOverrideDrafts((prev) => ({
                                  ...prev,
                                  [u.enrollmentId]: {
                                    ...uDraft,
                                    isGroupOverride: true,
                                    status:
                                      uDraft.status === "PENDING" &&
                                      nextVal.trim() !== ""
                                        ? "GRADED"
                                        : uDraft.status,
                                    rawScore: nextVal,
                                  },
                                }));
                              }}
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              maxLength={280}
                              disabled={isArchived}
                              placeholder="Optional note..."
                              aria-label={`Remarks for ${u.student.fullName}`}
                              value={uDraft.remarks}
                              onChange={(e) =>
                                setMemberOverrideDrafts((prev) => ({
                                  ...prev,
                                  [u.enrollmentId]: {
                                    ...uDraft,
                                    isGroupOverride: true,
                                    remarks: e.target.value,
                                  },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="md:overflow-x-auto">
            <table className="block w-full text-left text-xs md:table">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="pb-2 pr-3">Student</th>
                  {assessment.submissionEnabled && (
                    <th className="pb-2 pr-3">Drive Submission</th>
                  )}
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Raw Score</th>
                  <th className="pb-2 pr-3">Boost</th>
                  <th className="pb-2 pr-3">Effective</th>
                  <th className="pb-2">Remarks</th>
                </tr>
              </thead>
              <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100">
                {filteredScoreRows.length === 0 ? (
                  <tr className="block rounded-xl border border-slate-200 bg-slate-50 md:table-row md:rounded-none md:border-0 md:bg-transparent">
                    <td
                      colSpan={assessment.submissionEnabled ? 7 : 6}
                      className="block py-6 text-center text-xs text-slate-500 md:table-cell md:py-4"
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
                      <tr
                        key={row.enrollmentId}
                        className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
                      >
                        <td className="col-span-2 border-b border-slate-100 pb-2 md:table-cell md:border-0 md:py-2.5 md:pr-3">
                          <p className="text-sm font-bold text-slate-900 md:text-xs md:font-semibold">
                            {row.student.fullName}
                          </p>
                          <p className="text-[11px] text-slate-500 md:text-[10px]">
                            {row.student.institutionalId ?? row.student.email}
                          </p>
                        </td>
                        {assessment.submissionEnabled && (
                          <td className="col-span-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-2.5 md:pr-3">
                            <span
                              aria-hidden="true"
                              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                            >
                              Drive Submission
                            </span>
                            {row.submission ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <a
                                    href={row.submission.normalizedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 md:px-2 md:py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                  >
                                    <span>Open Drive</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                      row.submission.status === "LATE"
                                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    }`}
                                  >
                                    {row.submission.status === "LATE"
                                      ? "Late"
                                      : "On time"}
                                  </span>
                                  {row.submission.accessStatus ===
                                    "UNVERIFIED" && (
                                    <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                                      Unverified
                                    </span>
                                  )}
                                  {row.submission.accessStatus ===
                                    "PRIVATE_OR_RESTRICTED" && (
                                    <span className="rounded-full bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                      School/Restricted
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-500">
                                  {new Date(
                                    row.submission.updatedAt
                                  ).toLocaleString()}
                                </p>
                                {row.submission.studentNote && (
                                  <p className="text-[11px] md:text-[10px] text-slate-600 break-words md:max-w-[200px] md:truncate">
                                    Note: {row.submission.studentNote}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Not submitted
                              </span>
                            )}
                          </td>
                        )}
                        <td className="col-span-1 md:table-cell md:py-2.5 md:pr-3">
                          <span
                            aria-hidden="true"
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                          >
                            Status
                          </span>
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
                            className="w-full md:w-auto min-h-[40px] md:min-h-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                          >
                            <option value="PENDING">Pending</option>
                            <option value="GRADED">Graded</option>
                            <option value="MISSING">Missing (0)</option>
                            <option value="EXCUSED">Excused</option>
                          </select>
                        </td>
                        <td className="col-span-1 md:table-cell md:py-2.5 md:pr-3">
                          <span
                            aria-hidden="true"
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                          >
                            Raw Score (/{maxScoreVal})
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
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
                            className="w-full md:w-24 min-h-[40px] md:min-h-0 rounded-lg border border-slate-300 px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                        <td className="col-span-1 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-2.5 md:pr-3">
                          <span
                            aria-hidden="true"
                            className="text-[11px] font-medium text-slate-500 md:hidden"
                          >
                            Boost
                          </span>
                          {row.bonusPoints > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              <Sparkles className="h-3 w-3" />+
                              {row.bonusPoints}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="col-span-1 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 font-mono font-semibold text-slate-800 whitespace-nowrap md:table-cell md:rounded-none md:border-0 md:bg-transparent md:p-0 md:py-2.5 md:pr-3">
                          <span
                            aria-hidden="true"
                            className="font-sans text-[11px] font-medium text-slate-500 md:hidden"
                          >
                            Effective
                          </span>
                          <span>
                            <span>{effectivePreview}</span>
                            {isCappedPreview && (
                              <span className="ml-1 text-[10px] font-sans text-amber-700">
                                (cap)
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="col-span-2 md:table-cell md:py-2.5">
                          <span
                            aria-hidden="true"
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:hidden"
                          >
                            Remarks
                          </span>
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
                            className="w-full md:min-w-[140px] min-h-[38px] md:min-h-0 rounded-lg border border-slate-300 px-2.5 py-1.5 md:px-2 md:py-1 text-sm md:text-xs disabled:bg-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          )}

          <div className="sticky bottom-[4.5rem] z-10 rounded-xl border border-slate-200 bg-white/95 backdrop-blur p-3 shadow-md space-y-2.5 md:static md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
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

            <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
              {hasUnsavedChanges && (
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  Unsaved changes
                </span>
              )}
              <button
                type="button"
                disabled={savingScores || isArchived}
                onClick={() => void handleSaveScores()}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-0 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{savingScores ? "Saving..." : "Save Scores"}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
