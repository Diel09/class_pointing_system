"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  Pencil,
  QrCode,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { StudentAttendancePanel } from "@/components/attendance/student-attendance-panel";
import { TeacherAttendancePanel } from "@/components/attendance/teacher-attendance-panel";
import { StudentAssessmentsPanel } from "@/components/grading/student-assessments-panel";
import { StudentStandingPanel } from "@/components/grading/student-standing-panel";
import { TeacherAssessmentsPanel } from "@/components/grading/teacher-assessments-panel";
import { TeacherComputationPanel } from "@/components/grading/teacher-computation-panel";
import { AppShell, type CurrentUserDto } from "@/components/layout/app-shell";
import { StudentRedemptionsPanel } from "@/components/points/student-redemptions-panel";
import { StudentWalletPanel } from "@/components/points/student-wallet-panel";
import { TeacherEconomyPanel } from "@/components/points/teacher-economy-panel";
import { TeacherMeritsPanel } from "@/components/points/teacher-merits-panel";
import {
  DeleteSubjectModal,
  type DeleteSubjectTarget,
} from "@/components/subjects/delete-subject-modal";
import { DuplicateSubjectModal } from "@/components/subjects/duplicate-subject-modal";
import { EditSubjectModal } from "@/components/subjects/edit-subject-modal";
import {
  UnenrollStudentModal,
  type UnenrollStudentTarget,
} from "@/components/subjects/unenroll-student-modal";
import {
  ALL_SUBJECT_TAB_KEYS,
  resolveSubjectTab,
  STUDENT_SUBJECT_TABS,
  SubjectWorkspaceTabs,
  TEACHER_SUBJECT_TABS,
  type SubjectTabKey,
} from "@/components/subjects/subject-workspace-tabs";
import { formatSubjectDateRange } from "@/lib/utils";

interface SubjectDetailResponse {
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
    startDate: string | null;
    endDate: string | null;
    isArchived: boolean;
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
    term: { id: string; name: string; isActive: boolean };
  };
  enrollment: {
    id: string;
    availableBalance: number;
    escrowedBalance: number;
    manualStandingOverride: string;
    enrolledAt: string;
  } | null;
}

interface RosterItem {
  id: string;
  availableBalance: number;
  escrowedBalance: number;
  enrolledAt: string;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
    status: string;
  };
}

interface ImportResult {
  added: { id: string; fullName: string; email: string }[];
  alreadyEnrolled: { id: string; fullName: string; email: string }[];
  notFound: string[];
}

const STUDENT_TAB_KEYS = STUDENT_SUBJECT_TABS.map((tab) => tab.key);
const TEACHER_TAB_KEYS = TEACHER_SUBJECT_TABS.map((tab) => tab.key);

function SubjectDetailContent() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = params.id;
  const queryClient = useQueryClient();

  const [copied, setCopied] = useState(false);
  const [rosterInput, setRosterInput] = useState("");
  const [rosterResult, setRosterResult] = useState<ImportResult | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSubjectTarget | null>(
    null
  );
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<
    Set<string>
  >(new Set());
  const [unenrollTargets, setUnenrollTargets] = useState<
    UnenrollStudentTarget[]
  >([]);
  const tabQueryValue = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<SubjectTabKey>(() =>
    resolveSubjectTab(tabQueryValue, ALL_SUBJECT_TAB_KEYS)
  );

  useEffect(() => {
    setActiveTab(resolveSubjectTab(tabQueryValue, ALL_SUBJECT_TAB_KEYS));
  }, [tabQueryValue]);

  function handleTabChange(nextTab: SubjectTabKey) {
    setActiveTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextTab === "grades") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }

  const studentActiveTab = resolveSubjectTab(activeTab, STUDENT_TAB_KEYS);
  const teacherActiveTab = resolveSubjectTab(activeTab, TEACHER_TAB_KEYS);

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
  const canDeleteSection = isTeacherOwner || user?.role === "ADMIN";
  const subjectDateRange = formatSubjectDateRange(
    subjectData?.subject.startDate,
    subjectData?.subject.endDate
  );

  const { data: rosterData } = useQuery<{ roster: RosterItem[] }>({
    queryKey: ["subject-roster", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/roster`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { roster: [] };
      return (await res.json()) as { roster: RosterItem[] };
    },
    enabled: Boolean(isTeacherOwner),
  });

  const inviteUrl =
    typeof window !== "undefined" && subjectData?.subject.inviteCode
      ? `${window.location.origin}/join?code=${subjectData.subject.inviteCode}`
      : "";

  async function handleCopyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

  async function handleRegenerateInvite() {
    await fetch(`/api/subjects/${subjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerateInviteCode: true }),
    });
    await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
    await queryClient.invalidateQueries({ queryKey: ["subjects"] });
  }

  async function handleAddRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRosterError(null);
    setRosterResult(null);
    setImporting(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: rosterInput }),
      });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) {
        setRosterError(data.error ?? "Failed to enroll students.");
        return;
      }
      setRosterResult(data);
      setRosterInput("");
      await queryClient.invalidateQueries({
        queryKey: ["subject-roster", subjectId],
      });
      await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
    } catch {
      setRosterError("Network error while adding students.");
    } finally {
      setImporting(false);
    }
  }

  function toUnenrollTarget(entry: RosterItem): UnenrollStudentTarget {
    return {
      id: entry.id,
      fullName: entry.student.fullName,
      email: entry.student.email,
      institutionalId: entry.student.institutionalId,
      availableBalance: entry.availableBalance,
      escrowedBalance: entry.escrowedBalance,
    };
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
                </div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {subjectData.subject.title}
                </h2>
                <p className="text-xs text-slate-500">
                  Instructor: {subjectData.subject.teacher.fullName} •{" "}
                  {subjectData.subject.enrollmentCount} enrolled students
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

            {/* Student Isolated Workspace */}
            {subjectData.enrollment && (
              <>
                <StudentStandingPanel subjectId={subjectId} />

                <SubjectWorkspaceTabs
                  ariaLabel="Student subject sections"
                  tabs={STUDENT_SUBJECT_TABS}
                  activeTab={studentActiveTab}
                  onTabChange={handleTabChange}
                />

                {studentActiveTab === "grades" && (
                  <StudentAssessmentsPanel
                    subjectId={subjectId}
                    isArchived={subjectData.subject.isArchived}
                  />
                )}

                {studentActiveTab === "points" && (
                  <div className="space-y-6">
                    <StudentWalletPanel
                      subjectId={subjectId}
                      subjectCode={subjectData.subject.code}
                      initialAvailableBalance={
                        subjectData.enrollment.availableBalance
                      }
                      initialEscrowedBalance={
                        subjectData.enrollment.escrowedBalance
                      }
                      manualStandingOverride={
                        subjectData.enrollment.manualStandingOverride
                      }
                      allowNegativeBalance={
                        subjectData.subject.allowNegativeBalance
                      }
                      allowP2pTransfers={subjectData.subject.allowP2pTransfers}
                      isArchived={subjectData.subject.isArchived}
                      p2pMaxPerTransfer={subjectData.subject.p2pMaxPerTransfer}
                      p2pMaxPerDay={subjectData.subject.p2pMaxPerDay}
                      p2pMaxPerTerm={subjectData.subject.p2pMaxPerTerm}
                    />

                    <StudentRedemptionsPanel
                      subjectId={subjectId}
                      isArchived={subjectData.subject.isArchived}
                      availableBalance={subjectData.enrollment.availableBalance}
                      allowOpenRedemptions={
                        subjectData.subject.allowOpenRedemptions
                      }
                    />
                  </div>
                )}

                {studentActiveTab === "attendance" && (
                  <StudentAttendancePanel subjectId={subjectId} />
                )}
              </>
            )}

            {/* Teacher Workspace */}
            {isTeacherOwner && (
              <>
                <SubjectWorkspaceTabs
                  ariaLabel="Teacher subject sections"
                  tabs={TEACHER_SUBJECT_TABS}
                  activeTab={teacherActiveTab}
                  onTabChange={handleTabChange}
                />

                {teacherActiveTab === "grades" && (
                  <TeacherAssessmentsPanel
                    subjectId={subjectId}
                    isArchived={subjectData.subject.isArchived}
                  />
                )}

                {teacherActiveTab === "attendance" && (
                  <TeacherAttendancePanel
                    subjectId={subjectId}
                    isArchived={subjectData.subject.isArchived}
                  />
                )}

                {teacherActiveTab === "points" && (
                  <div className="space-y-6">
                    <TeacherMeritsPanel
                      subjectId={subjectId}
                      isArchived={subjectData.subject.isArchived}
                      allowNegativeBalance={
                        subjectData.subject.allowNegativeBalance
                      }
                      roster={rosterData?.roster ?? []}
                    />

                    <TeacherEconomyPanel
                      subjectId={subjectId}
                      isArchived={subjectData.subject.isArchived}
                      allowP2pTransfers={subjectData.subject.allowP2pTransfers}
                      p2pMaxPerTransfer={subjectData.subject.p2pMaxPerTransfer}
                      p2pMaxPerDay={subjectData.subject.p2pMaxPerDay}
                      p2pMaxPerTerm={subjectData.subject.p2pMaxPerTerm}
                      allowOpenRedemptions={
                        subjectData.subject.allowOpenRedemptions
                      }
                    />
                  </div>
                )}

                {teacherActiveTab === "roster" && (
                  <div className="space-y-6">
                    <TeacherComputationPanel
                      subjectId={subjectId}
                      isArchived={subjectData.subject.isArchived}
                      standingVisible={subjectData.subject.standingVisible}
                    />

                    <div className="grid gap-6 lg:grid-cols-5">
                {/* Class Invite & QR */}
                <section className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <QrCode className="h-4 w-4 text-indigo-600" />
                      <h3 className="text-sm font-bold text-slate-900">
                        Class Invite Code &amp; QR
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleRegenerateInvite}
                      title="Regenerate invite code"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Reset</span>
                    </button>
                  </div>

                  {subjectData.subject.inviteCode && (
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
                      <div className="rounded-xl bg-white p-3 border border-slate-200">
                        <QRCodeSVG
                          value={
                            inviteUrl ||
                            `code=${subjectData.subject.inviteCode}`
                          }
                          size={168}
                        />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                          Invite Code
                        </p>
                        <p className="text-xl font-mono font-bold tracking-widest text-slate-900">
                          {subjectData.subject.inviteCode}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyInvite}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Invite Link Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Join Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </section>

                {/* Roster Panel */}
                <section className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Student Roster ({rosterData?.roster.length ?? 0})
                    </h3>
                  </div>

                  <form onSubmit={handleAddRoster} className="space-y-2.5">
                    <label
                      htmlFor="roster-input"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Enroll Students (Email or Institutional ID, comma or newline
                      separated)
                    </label>
                    <textarea
                      id="roster-input"
                      rows={3}
                      value={rosterInput}
                      onChange={(e) => setRosterInput(e.target.value)}
                      placeholder={"student6@classpulse.local\n2026-0007, 2026-0008"}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    />
                    {rosterError && (
                      <p className="text-xs text-rose-600">{rosterError}</p>
                    )}
                    {rosterResult && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                        <p className="font-semibold text-emerald-700">
                          Added: {rosterResult.added.length}
                        </p>
                        {rosterResult.alreadyEnrolled.length > 0 && (
                          <p className="text-slate-600">
                            Already enrolled:{" "}
                            {rosterResult.alreadyEnrolled.length}
                          </p>
                        )}
                        {rosterResult.notFound.length > 0 && (
                          <p className="text-amber-700">
                            Not found: {rosterResult.notFound.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={importing || rosterInput.trim().length === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>{importing ? "Adding..." : "Add to Roster"}</span>
                    </button>
                  </form>

                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    {!rosterData || rosterData.roster.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No students enrolled yet. Share your invite code or add
                        students above.
                      </p>
                    ) : (
                      <>
                        {(() => {
                          const rosterList = rosterData.roster;
                          const allSelected =
                            rosterList.length > 0 &&
                            rosterList.every((entry) =>
                              selectedEnrollmentIds.has(entry.id)
                            );
                          const selectedRows = rosterList.filter((entry) =>
                            selectedEnrollmentIds.has(entry.id)
                          );

                          return (
                            <>
                              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedEnrollmentIds(
                                          new Set(rosterList.map((r) => r.id))
                                        );
                                      } else {
                                        setSelectedEnrollmentIds(new Set());
                                      }
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                                  />
                                  <span>
                                    Select All ({rosterList.length})
                                  </span>
                                </label>

                                <button
                                  type="button"
                                  disabled={selectedRows.length === 0}
                                  onClick={() =>
                                    setUnenrollTargets(
                                      selectedRows.map(toUnenrollTarget)
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  <UserMinus className="h-3.5 w-3.5" />
                                  <span>
                                    Unenroll Selected ({selectedRows.length})
                                  </span>
                                </button>
                              </div>

                              <div className="divide-y divide-slate-100">
                                {rosterList.map((entry) => {
                                  const checked = selectedEnrollmentIds.has(
                                    entry.id
                                  );
                                  return (
                                    <div
                                      key={entry.id}
                                      className="py-2.5 flex items-center justify-between gap-3"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          aria-label={`Select ${entry.student.fullName}`}
                                          onChange={(e) => {
                                            setSelectedEnrollmentIds((prev) => {
                                              const next = new Set(prev);
                                              if (e.target.checked) {
                                                next.add(entry.id);
                                              } else {
                                                next.delete(entry.id);
                                              }
                                              return next;
                                            });
                                          }}
                                          className="h-4 w-4 rounded border-slate-300 text-rose-600 cursor-pointer shrink-0"
                                        />
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-slate-900 truncate">
                                            {entry.student.fullName}
                                          </p>
                                          <p className="text-xs text-slate-500 truncate">
                                            {entry.student.institutionalId
                                              ? `${entry.student.institutionalId} • `
                                              : ""}
                                            {entry.student.email}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2.5 shrink-0">
                                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                                          {entry.availableBalance} pts
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setUnenrollTargets([
                                              toUnenrollTarget(entry),
                                            ])
                                          }
                                          aria-label={`Unenroll ${entry.student.fullName}`}
                                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                                        >
                                          <UserMinus className="h-3.5 w-3.5" />
                                          <span>Unenroll</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </section>
              </div>
                  </div>
                )}
              </>
            )}
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
            }}
            open={showEditModal}
            onClose={() => setShowEditModal(false)}
            onUpdated={async () => {
              await queryClient.invalidateQueries({
                queryKey: ["subject", subjectId],
              });
              await queryClient.invalidateQueries({ queryKey: ["subjects"] });
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

          <UnenrollStudentModal
            subjectId={subjectId}
            subjectLabel={`${subjectData.subject.code} • ${subjectData.subject.section} — ${subjectData.subject.title}`}
            students={unenrollTargets}
            onClose={() => setUnenrollTargets([])}
            onUnenrolled={async () => {
              setUnenrollTargets([]);
              setSelectedEnrollmentIds(new Set());
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["subject-roster", subjectId],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["subject", subjectId],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["subject-standing", subjectId],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["subject-assessments", subjectId],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["subject-ledger", subjectId],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["subject-redemptions-teacher", subjectId],
                }),
                queryClient.invalidateQueries({ queryKey: ["subjects"] }),
              ]);
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

export default function SubjectDetailPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading subject workspace...
          </div>
        </AppShell>
      }
    >
      <SubjectDetailContent />
    </Suspense>
  );
}
