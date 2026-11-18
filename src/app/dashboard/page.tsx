"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  Calendar,
  CheckSquare,
  Coins,
  Copy,
  Plus,
  PlusCircle,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AppShell, type CurrentUserDto } from "@/components/layout/app-shell";
import {
  DeleteSubjectModal,
  type DeleteSubjectTarget,
} from "@/components/subjects/delete-subject-modal";
import {
  DuplicateSubjectModal,
  type DuplicateSubjectTarget,
} from "@/components/subjects/duplicate-subject-modal";
import { formatSubjectDateRange } from "@/lib/utils";

interface TermDto {
  id: string;
  name: string;
  isActive: boolean;
}

interface SubjectDto {
  id: string;
  code: string;
  title: string;
  section: string;
  startDate?: string | null;
  endDate?: string | null;
  inviteCode?: string;
  isArchived: boolean;
  term: TermDto;
  teacher?: { id: string; fullName: string; email: string };
  _count?: { enrollments: number };
  enrollment?: {
    id: string;
    availableBalance: number;
    escrowedBalance: number;
    manualStandingOverride: string;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [termId, setTermId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<DeleteSubjectTarget[]>(
    []
  );
  const [duplicateTarget, setDuplicateTarget] =
    useState<DuplicateSubjectTarget | null>(null);

  const { data: user, isLoading: userLoading } = useQuery<CurrentUserDto | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!res.ok) return null;
      const payload = (await res.json()) as { user: CurrentUserDto };
      return payload.user;
    },
  });

  const { data: subjectsData, isLoading: subjectsLoading } = useQuery<{
    role: string;
    subjects: SubjectDto[];
  }>({
    queryKey: ["subjects", showArchived],
    queryFn: async () => {
      const res = await fetch(`/api/subjects?archived=${showArchived}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Failed to load subjects.");
      }
      return (await res.json()) as { role: string; subjects: SubjectDto[] };
    },
    enabled: Boolean(user),
  });

  const { data: termsData } = useQuery<{ terms: TermDto[] }>({
    queryKey: ["terms"],
    queryFn: async () => {
      const res = await fetch("/api/admin/terms", { credentials: "same-origin" });
      if (!res.ok) return { terms: [] };
      return (await res.json()) as { terms: TermDto[] };
    },
    enabled: user?.role === "TEACHER",
  });

  async function handleCreateSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (startDate && endDate && endDate < startDate) {
      setFormError("End date must be on or after start date.");
      return;
    }

    setCreating(true);

    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          title,
          section,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(termId ? { termId } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Failed to create subject.");
        return;
      }

      setCode("");
      setTitle("");
      setSection("");
      setStartDate("");
      setEndDate("");
      setShowCreateForm(false);
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    } catch {
      setFormError("Network error while creating subject.");
    } finally {
      setCreating(false);
    }
  }

  const subjects = subjectsData?.subjects ?? [];
  const terms = termsData?.terms ?? [];
  const canManageSubjects =
    user?.role === "TEACHER" || user?.role === "ADMIN";
  const selectedSubjects = subjects.filter((s) => selectedIds.has(s.id));

  function toggleSubjectSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toDeleteTarget(subject: SubjectDto): DeleteSubjectTarget {
    return {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
      enrollmentCount: subject._count?.enrollments ?? 0,
    };
  }

  function toDuplicateTarget(subject: SubjectDto): DuplicateSubjectTarget {
    return {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
      termName: subject.term.name,
      startDate: subject.startDate ?? null,
      endDate: subject.endDate ?? null,
    };
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header Bar */}
        <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
              {user?.role === "TEACHER"
                ? "Teacher Workspace"
                : user?.role === "ADMIN"
                ? "Administrator Overview"
                : "Student Classes"}
            </p>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              {user ? `Welcome, ${user.fullName}` : "Loading workspace..."}
            </h2>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {user?.role === "STUDENT" && (
              <Link
                href="/join"
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                <PlusCircle className="h-4 w-4" />
                <span>Join a Class</span>
              </Link>
            )}

            {canManageSubjects && subjects.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelectedIds(new Set());
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CheckSquare className="h-4 w-4" />
                <span>{selectMode ? "Done Selecting" : "Select Sections"}</span>
              </button>
            )}

            {user?.role === "TEACHER" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowArchived((v) => !v);
                    setSelectedIds(new Set());
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Archive className="h-4 w-4" />
                  <span>{showArchived ? "Show Active" : "Show Archived"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Subject</span>
                </button>
              </>
            )}

            {user?.role === "ADMIN" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <Shield className="h-4 w-4" />
                <span>Open Admin Console</span>
              </Link>
            )}
          </div>
        </section>

        {/* Teacher Create Subject Drawer */}
        {user?.role === "TEACHER" && showCreateForm && (
          <section className="rounded-2xl bg-white border border-indigo-200 p-5 shadow-sm space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              New Subject / Class
            </h3>
            {formError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2 text-xs text-rose-700"
              >
                {formError}
              </div>
            )}
            <form
              onSubmit={handleCreateSubject}
              className="grid gap-3.5 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <label
                  htmlFor="sub-code"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Course Code
                </label>
                <input
                  id="sub-code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CS 101"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sub-section"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Section
                </label>
                <input
                  id="sub-section"
                  type="text"
                  required
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="BSCS-1A"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label
                  htmlFor="sub-title"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Subject Title
                </label>
                <input
                  id="sub-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Introduction to Computing"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sub-start-date"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Start Date (Optional)
                </label>
                <input
                  id="sub-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="sub-end-date"
                  className="block text-xs font-semibold text-slate-700"
                >
                  End Date (Optional)
                </label>
                <input
                  id="sub-end-date"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {terms.length > 0 && (
                <div className="space-y-1 sm:col-span-2">
                  <label
                    htmlFor="sub-term"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Academic Term
                  </label>
                  <select
                    id="sub-term"
                    value={termId}
                    onChange={(e) => setTermId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Use Active Term (Default)</option>
                    {terms.map((term) => (
                      <option key={term.id} value={term.id}>
                        {term.name} {term.isActive ? "(Active)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="sm:col-span-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {creating ? "Creating..." : "Create Subject"}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Subject Cards */}
        {userLoading || subjectsLoading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading subjects...
          </div>
        ) : subjects.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-3">
            <BookOpen className="h-8 w-8 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800">
                {user?.role === "TEACHER"
                  ? showArchived
                    ? "No archived subjects"
                    : "No subjects created yet"
                  : "You haven't joined any classes yet"}
              </p>
              <p className="text-xs text-slate-500">
                {user?.role === "TEACHER"
                  ? "Create a subject to generate a class invite code and QR."
                  : "Use your teacher's class invite code or QR to join."}
              </p>
            </div>
            {user?.role === "STUDENT" && (
              <Link
                href="/join"
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <PlusCircle className="h-4 w-4" />
                <span>Join a Class</span>
              </Link>
            )}
          </div>
        ) : (
          <>
            {canManageSubjects && selectMode && (
              <div className="rounded-2xl bg-indigo-50/70 border border-indigo-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-semibold text-indigo-950">
                    {selectedIds.size} of {subjects.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedIds(new Set(subjects.map((s) => s.id)))
                    }
                    className="font-semibold text-indigo-700 hover:underline"
                  >
                    Select All
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="font-semibold text-slate-600 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={selectedSubjects.length === 0}
                  onClick={() =>
                    setDeleteTargets(selectedSubjects.map(toDeleteTarget))
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selected ({selectedSubjects.length})</span>
                </button>
              </div>
            )}

            <section className="grid gap-4 sm:grid-cols-2">
              {subjects.map((subject) => {
                const dateRange = formatSubjectDateRange(
                  subject.startDate,
                  subject.endDate
                );
                const canDelete = canManageSubjects;
                const canDuplicate = user?.role === "TEACHER";
                const isSelected = selectedIds.has(subject.id);

                const cardBody = (
                  <>
                    <div className="space-y-1.5">
                      <div
                        className={`flex items-center justify-between gap-2 ${
                          canDuplicate && !selectMode
                            ? "pr-16"
                            : canDelete
                            ? "pr-9"
                            : ""
                        }`}
                      >
                        <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                          {subject.code} • {subject.section}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {subject.term.name}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">
                        {subject.title}
                      </h3>
                      {subject.teacher && (
                        <p className="text-xs text-slate-500">
                          Instructor: {subject.teacher.fullName}
                        </p>
                      )}
                      {dateRange && (
                        <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          <span>{dateRange}</span>
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      {subject.enrollment ? (
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <Coins className="h-3.5 w-3.5" />
                            <span>
                              {subject.enrollment.availableBalance} pts
                            </span>
                          </span>
                          <span className="text-slate-500">
                            {subject.enrollment.escrowedBalance} pending
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 text-slate-600">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Users className="h-3.5 w-3.5" />
                            <span>
                              {subject._count?.enrollments ?? 0} students
                            </span>
                          </span>
                          {subject.inviteCode && (
                            <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded">
                              {subject.inviteCode}
                            </span>
                          )}
                        </div>
                      )}

                      <span className="font-semibold text-indigo-600">
                        {selectMode
                          ? isSelected
                            ? "Selected"
                            : "Select"
                          : "Open →"}
                      </span>
                    </div>
                  </>
                );

                return (
                  <div
                    key={subject.id}
                    className={`relative group rounded-2xl bg-white border p-5 shadow-sm transition-all ${
                      selectMode && isSelected
                        ? "border-rose-400 ring-2 ring-rose-100"
                        : "border-slate-200 hover:border-indigo-300 hover:shadow"
                    }`}
                  >
                    {selectMode && canDelete ? (
                      <button
                        type="button"
                        onClick={() => toggleSubjectSelection(subject.id)}
                        className="flex h-full w-full flex-col justify-between gap-4 text-left"
                      >
                        {cardBody}
                      </button>
                    ) : (
                      <Link
                        href={`/subjects/${subject.id}`}
                        className="flex h-full flex-col justify-between gap-4"
                      >
                        {cardBody}
                      </Link>
                    )}

                    {canDelete &&
                      (selectMode ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSubjectSelection(subject.id)}
                          aria-label={`Select ${subject.code} ${subject.section}`}
                          className="absolute top-4 right-4 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                        />
                      ) : (
                        <div className="absolute top-4 right-4 flex items-center gap-1">
                          {canDuplicate && (
                            <button
                              type="button"
                              onClick={() =>
                                setDuplicateTarget(toDuplicateTarget(subject))
                              }
                              aria-label={`Duplicate ${subject.code} ${subject.section}`}
                              title="Duplicate section"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTargets([toDeleteTarget(subject)])
                            }
                            aria-label={`Delete ${subject.code} ${subject.section}`}
                            title="Delete section"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                  </div>
                );
              })}
            </section>
          </>
        )}

        <DuplicateSubjectModal
          subject={duplicateTarget}
          onClose={() => setDuplicateTarget(null)}
          onDuplicated={async (newSubjectId) => {
            setDuplicateTarget(null);
            await queryClient.invalidateQueries({ queryKey: ["subjects"] });
            router.push(`/subjects/${newSubjectId}`);
          }}
        />

        <DeleteSubjectModal
          subjects={deleteTargets}
          onClose={() => setDeleteTargets([])}
          onDeleted={async () => {
            for (const item of deleteTargets) {
              queryClient.removeQueries({
                queryKey: ["subject", item.id],
              });
            }
            setDeleteTargets([]);
            setSelectedIds(new Set());
            setSelectMode(false);
            await queryClient.invalidateQueries({ queryKey: ["subjects"] });
          }}
        />
      </div>
    </AppShell>
  );
}
