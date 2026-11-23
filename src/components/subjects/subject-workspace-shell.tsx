"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Calendar,
  Copy,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { StudentStandingPanel } from "@/components/grading/student-standing-panel";
import { AppShell, type CurrentUserDto } from "@/components/layout/app-shell";
import {
  DeleteSubjectModal,
  type DeleteSubjectTarget,
} from "@/components/subjects/delete-subject-modal";
import { DuplicateSubjectModal } from "@/components/subjects/duplicate-subject-modal";
import { EditSubjectModal } from "@/components/subjects/edit-subject-modal";
import {
  CO_TEACHER_SUBJECT_TABS,
  getStudentSubjectTabs,
  SubjectWorkspaceTabs,
  TEACHER_SUBJECT_TABS,
  type SubjectTabKey,
} from "@/components/subjects/subject-workspace-tabs";
import { formatSubjectDateRange } from "@/lib/utils";

export interface SubjectCoTeacherDto {
  id: string;
  teacherId: string;
  addedAt: string;
  teacher: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
}

export interface SubjectDetailDto {
  id: string;
  code: string;
  title: string;
  section: string;
  startDate: string | null;
  endDate: string | null;
  isArchived: boolean;
  pointsEnabled: boolean;
  allowNegativeBalance: boolean;
  allowP2pTransfers: boolean;
  p2pMaxPerTransfer: number | null;
  p2pMaxPerDay: number | null;
  p2pMaxPerTerm: number | null;
  allowOpenRedemptions: boolean;
  standingVisible: boolean;
  inviteCode?: string;
  enrollmentCount: number;
  teacher: { id: string; fullName: string; email: string };
  coTeachers?: SubjectCoTeacherDto[];
  term: { id: string; name: string; isActive: boolean };
}

export interface SubjectEnrollmentDto {
  id: string;
  availableBalance: number;
  escrowedBalance: number;
  manualStandingOverride: string;
  enrolledAt: string;
}

export interface SubjectDetailResponse {
  subject: SubjectDetailDto;
  enrollment: SubjectEnrollmentDto | null;
}

export interface SubjectWorkspaceContext {
  subjectId: string;
  user: CurrentUserDto | null;
  subject: SubjectDetailDto;
  enrollment: SubjectEnrollmentDto | null;
  isTeacherOwner: boolean;
  isCoTeacher: boolean;
  isInstructor: boolean;
}

interface SubjectWorkspaceShellProps {
  subjectId: string;
  activeTab: SubjectTabKey;
  children: (ctx: SubjectWorkspaceContext) => ReactNode;
}

/**
 * Shared shell for subject workspace routes (/subjects/[id], /attendance, /points, /roster).
 * Renders subject header, role-aware actions/modals, student standing summary, and link tabs.
 */
export function SubjectWorkspaceShell({
  subjectId,
  activeTab,
  children,
}: SubjectWorkspaceShellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSubjectTarget | null>(
    null
  );

  const { data: user } = useQuery<CurrentUserDto | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!res.ok) return null;
      const payload = (await res.json()) as { user: CurrentUserDto };
      return payload.user;
    },
  });

  const {
    data: subjectData,
    isLoading,
    error: subjectError,
  } = useQuery<SubjectDetailResponse>({
    queryKey: ["subject", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Unable to load subject.");
      }
      return (await res.json()) as SubjectDetailResponse;
    },
    enabled: Boolean(subjectId),
  });

  const isTeacherOwner =
    user?.role === "TEACHER" &&
    subjectData?.subject.teacher.id === user.id;
  const isCoTeacher =
    user?.role === "TEACHER" &&
    !isTeacherOwner &&
    Boolean(
      subjectData?.subject.coTeachers?.some(
        (ct) => ct.teacherId === user.id || ct.teacher.id === user.id
      )
    );
  const isInstructor = isTeacherOwner || isCoTeacher;
  const canDeleteSection = isTeacherOwner || user?.role === "ADMIN";
  const subjectDateRange = formatSubjectDateRange(
    subjectData?.subject.startDate,
    subjectData?.subject.endDate
  );
  const coTeacherNames =
    subjectData?.subject.coTeachers?.map((ct) => ct.teacher.fullName) ?? [];

  async function handleToggleArchive() {
    if (!subjectData) return;
    await fetch(`/api/subjects/${subjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived: !subjectData.subject.isArchived }),
    });
    await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
    await queryClient.invalidateQueries({ queryKey: ["subjects"] });
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Classes</span>
        </Link>

        {isLoading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading subject workspace...
          </div>
        ) : subjectError || !subjectData ? (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
            {subjectError instanceof Error
              ? subjectError.message
              : "Subject not found."}
          </div>
        ) : (
          <>
            {/* Subject Header */}
            <section className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {subjectData.subject.code} • {subjectData.subject.section}
                  </span>
                  <span className="text-xs text-slate-500">
                    {subjectData.subject.term.name}
                  </span>
                  {subjectData.subject.isArchived && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Archived
                    </span>
                  )}
                  {isCoTeacher && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800">
                      Co-Teacher
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {subjectData.subject.title}
                </h2>
                <p className="text-xs text-slate-500">
                  Instructor: {subjectData.subject.teacher.fullName}
                  {coTeacherNames.length > 0
                    ? ` • Co-Teacher${coTeacherNames.length > 1 ? "s" : ""}: ${coTeacherNames.join(", ")}`
                    : ""}{" "}
                  • {subjectData.subject.enrollmentCount} enrolled students
                </p>
                {subjectDateRange && (
                  <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>Schedule: {subjectDateRange}</span>
                  </p>
                )}
              </div>

              {(isTeacherOwner || canDeleteSection) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {isTeacherOwner && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit Section</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDuplicateModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Duplicate Section</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleArchive}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Archive className="h-4 w-4" />
                        <span>
                          {subjectData.subject.isArchived
                            ? "Unarchive Subject"
                            : "Archive Subject"}
                        </span>
                      </button>
                    </>
                  )}
                  {canDeleteSection && (
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          id: subjectData.subject.id,
                          code: subjectData.subject.code,
                          title: subjectData.subject.title,
                          section: subjectData.subject.section,
                          enrollmentCount: subjectData.subject.enrollmentCount,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Section</span>
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* Student Standing & Navigation */}
            {subjectData.enrollment && (
              <>
                <StudentStandingPanel subjectId={subjectId} />
                <SubjectWorkspaceTabs
                  subjectId={subjectId}
                  ariaLabel="Student subject sections"
                  tabs={getStudentSubjectTabs(
                    subjectData.subject.pointsEnabled !== false
                  )}
                  activeTab={
                    activeTab === "roster" ||
                    (activeTab === "points" &&
                      subjectData.subject.pointsEnabled === false)
                      ? "grades"
                      : activeTab
                  }
                />
              </>
            )}

            {/* Teacher & Co-Teacher Navigation */}
            {isInstructor && (
              <SubjectWorkspaceTabs
                subjectId={subjectId}
                ariaLabel="Teacher subject sections"
                tabs={
                  isTeacherOwner
                    ? TEACHER_SUBJECT_TABS
                    : CO_TEACHER_SUBJECT_TABS
                }
                activeTab={
                  !isTeacherOwner && activeTab === "roster"
                    ? "grades"
                    : activeTab
                }
              />
            )}

            {children({
              subjectId,
              user: user ?? null,
              subject: subjectData.subject,
              enrollment: subjectData.enrollment,
              isTeacherOwner,
              isCoTeacher,
              isInstructor,
            })}
          </>
        )}
      </div>

      {subjectData && isTeacherOwner && (
        <>
          <EditSubjectModal
            subject={{
              id: subjectData.subject.id,
              code: subjectData.subject.code,
              title: subjectData.subject.title,
              section: subjectData.subject.section,
              startDate: subjectData.subject.startDate,
              endDate: subjectData.subject.endDate,
              pointsEnabled: subjectData.subject.pointsEnabled !== false,
            }}
            open={showEditModal}
            onClose={() => setShowEditModal(false)}
            onUpdated={async () => {
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["subject", subjectId],
                }),
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
            }}
          />

          <DuplicateSubjectModal
            subject={
              showDuplicateModal
                ? {
                    id: subjectData.subject.id,
                    code: subjectData.subject.code,
                    title: subjectData.subject.title,
                    section: subjectData.subject.section,
                    termName: subjectData.subject.term.name,
                    startDate: subjectData.subject.startDate,
                    endDate: subjectData.subject.endDate,
                  }
                : null
            }
            onClose={() => setShowDuplicateModal(false)}
            onDuplicated={async (newSubjectId) => {
              setShowDuplicateModal(false);
              await queryClient.invalidateQueries({ queryKey: ["subjects"] });
              router.push(`/subjects/${newSubjectId}`);
            }}
          />
        </>
      )}

      <DeleteSubjectModal
        subjects={deleteTarget ? [deleteTarget] : []}
        onClose={() => setDeleteTarget(null)}
        onDeleted={async () => {
          setDeleteTarget(null);
          queryClient.removeQueries({ queryKey: ["subject", subjectId] });
          queryClient.removeQueries({
            queryKey: ["subject-roster", subjectId],
          });
          await queryClient.invalidateQueries({ queryKey: ["subjects"] });
          router.push("/dashboard");
          router.refresh();
        }}
      />
    </AppShell>
  );
}
