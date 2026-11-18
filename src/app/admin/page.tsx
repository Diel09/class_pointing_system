"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Key,
  Search,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  DeleteStudentModal,
  type DeleteStudentTarget,
} from "@/components/admin/delete-student-modal";
import { AppShell } from "@/components/layout/app-shell";
import {
  DeleteSubjectModal,
  type DeleteSubjectTarget,
} from "@/components/subjects/delete-subject-modal";
import { cn, formatSubjectDateRange } from "@/lib/utils";

interface AdminSubjectRow {
  id: string;
  code: string;
  title: string;
  section: string;
  startDate?: string | null;
  endDate?: string | null;
  isArchived: boolean;
  teacher: { id: string; fullName: string; email: string };
  term: { id: string; name: string; isActive: boolean };
  _count: { enrollments: number };
}

interface TeacherRow {
  id: string;
  email: string;
  institutionalId: string | null;
  fullName: string;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
  _count: { taughtSubjects: number };
}

interface StudentRow {
  id: string;
  email: string;
  institutionalId: string | null;
  fullName: string;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
  createdAt: string;
  _count: { enrollments: number };
}

interface InviteRow {
  id: string;
  label: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface TermRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  _count: { subjects: number };
}

interface AuditLogRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeState: unknown;
  afterState: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  } | null;
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
  } | null;
}

interface AuditLogsResponse {
  logs: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  actions: string[];
  summary: {
    totalUsers: number;
    pendingTeachers: number;
    activeSubjects: number;
    totalEnrollments: number;
  };
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<
    "teachers" | "students" | "subjects" | "invites" | "terms" | "audit"
  >("teachers");

  // Student management & bulk delete state
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set()
  );
  const [deleteStudentTargets, setDeleteStudentTargets] = useState<
    DeleteStudentTarget[]
  >([]);

  // Subject oversight & bulk delete state
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(
    new Set()
  );
  const [deleteTargets, setDeleteTargets] = useState<DeleteSubjectTarget[]>(
    []
  );

  // Audit log filter & pagination state
  const [auditSearch, setAuditSearch] = useState("");
  const [appliedAuditSearch, setAppliedAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);

  // Invite creation state
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteMaxUses, setInviteMaxUses] = useState("1");
  const [inviteExpiresDays, setInviteExpiresDays] = useState("30");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Term creation state
  const [termName, setTermName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const [termActive, setTermActive] = useState(true);
  const [termError, setTermError] = useState<string | null>(null);

  const { data: teachersData } = useQuery<{ teachers: TeacherRow[] }>({
    queryKey: ["admin", "teachers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/teachers");
      if (!res.ok) throw new Error("Failed to fetch teachers");
      return (await res.json()) as { teachers: TeacherRow[] };
    },
  });

  const { data: studentsData, isLoading: loadingStudents } = useQuery<{
    students: StudentRow[];
  }>({
    queryKey: ["admin", "students"],
    queryFn: async () => {
      const res = await fetch("/api/admin/students");
      if (!res.ok) throw new Error("Failed to fetch students");
      return (await res.json()) as { students: StudentRow[] };
    },
  });

  const { data: invitesData } = useQuery<{ invites: InviteRow[] }>({
    queryKey: ["admin", "invites"],
    queryFn: async () => {
      const res = await fetch("/api/admin/invites");
      if (!res.ok) throw new Error("Failed to fetch invites");
      return (await res.json()) as { invites: InviteRow[] };
    },
  });

  const { data: termsData } = useQuery<{ terms: TermRow[] }>({
    queryKey: ["admin", "terms"],
    queryFn: async () => {
      const res = await fetch("/api/admin/terms");
      if (!res.ok) throw new Error("Failed to fetch terms");
      return (await res.json()) as { terms: TermRow[] };
    },
  });

  const { data: subjectsData, isLoading: loadingSubjects } = useQuery<{
    subjects: AdminSubjectRow[];
  }>({
    queryKey: ["admin", "subjects"],
    queryFn: async () => {
      const res = await fetch("/api/subjects");
      if (!res.ok) throw new Error("Failed to fetch subjects");
      return (await res.json()) as { subjects: AdminSubjectRow[] };
    },
  });

  const { data: auditData, isLoading: loadingAudit } =
    useQuery<AuditLogsResponse>({
      queryKey: [
        "admin",
        "audit-logs",
        appliedAuditSearch,
        auditActionFilter,
        auditPage,
      ],
      queryFn: async () => {
        const params = new URLSearchParams({
          page: String(auditPage),
          limit: "20",
        });
        if (appliedAuditSearch.trim()) {
          params.set("q", appliedAuditSearch.trim());
        }
        if (auditActionFilter) {
          params.set("action", auditActionFilter);
        }
        const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch audit logs");
        return (await res.json()) as AuditLogsResponse;
      },
    });

  async function updateTeacherStatus(
    id: string,
    status: "ACTIVE" | "SUSPENDED"
  ) {
    await fetch(`/api/admin/teachers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGeneratedCode(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: inviteLabel.trim() || null,
        maxUses: Number(inviteMaxUses) || 1,
        expiresInDays: inviteExpiresDays ? Number(inviteExpiresDays) : null,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { rawCode: string };
      setGeneratedCode(data.rawCode);
      setInviteLabel("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "invites"] });
    }
  }

  async function handleCreateTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTermError(null);
    const res = await fetch("/api/admin/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: termName,
        startDate: termStart,
        endDate: termEnd,
        isActive: termActive,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setTermError(data.error ?? "Failed to create term.");
      return;
    }
    setTermName("");
    setTermStart("");
    setTermEnd("");
    await queryClient.invalidateQueries({ queryKey: ["admin", "terms"] });
  }

  async function handleActivateTerm(id: string) {
    await fetch(`/api/admin/terms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "terms"] });
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Admin Oversight Console
              </h2>
              <p className="text-xs text-slate-500">
                Approve teachers, generate teacher invite codes, and manage terms.
              </p>
            </div>
          </div>

          <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1 flex-wrap">
            {[
              { id: "teachers" as const, label: "Teachers", icon: UserCheck },
              { id: "students" as const, label: "Students", icon: Users },
              { id: "subjects" as const, label: "Sections", icon: BookOpen },
              { id: "invites" as const, label: "Invites", icon: Key },
              { id: "terms" as const, label: "Terms", icon: Calendar },
              { id: "audit" as const, label: "Audit Logs", icon: FileText },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    tab === item.id
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {auditData?.summary && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Total Users
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {auditData.summary.totalUsers}
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Pending Teachers
              </p>
              <p className="text-2xl font-bold text-amber-700 mt-1">
                {auditData.summary.pendingTeachers}
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Active Subjects
              </p>
              <p className="text-2xl font-bold text-indigo-700 mt-1">
                {auditData.summary.activeSubjects}
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Enrollments
              </p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">
                {auditData.summary.totalEnrollments}
              </p>
            </div>
          </section>
        )}

        {tab === "teachers" && (
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Teacher Accounts
            </h3>
            <div className="divide-y divide-slate-100">
              {(teachersData?.teachers ?? []).map((teacher) => (
                <div
                  key={teacher.id}
                  className="py-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {teacher.fullName}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          teacher.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : teacher.status === "PENDING"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                        )}
                      >
                        {teacher.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {teacher.email}
                      {teacher.institutionalId
                        ? ` • ${teacher.institutionalId}`
                        : ""}{" "}
                      • {teacher._count.taughtSubjects} subjects
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {teacher.status !== "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => updateTeacherStatus(teacher.id, "ACTIVE")}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Approve
                      </button>
                    )}
                    {teacher.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() =>
                          updateTeacherStatus(teacher.id, "SUSPENDED")
                        }
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "students" && (() => {
          const allStudents = studentsData?.students ?? [];
          const needle = studentSearch.trim().toLowerCase();
          const filteredStudents = needle
            ? allStudents.filter(
                (s) =>
                  s.fullName.toLowerCase().includes(needle) ||
                  s.email.toLowerCase().includes(needle) ||
                  (s.institutionalId ?? "").toLowerCase().includes(needle)
              )
            : allStudents;
          const allFilteredSelected =
            filteredStudents.length > 0 &&
            filteredStudents.every((s) => selectedStudentIds.has(s.id));
          const selectedRows = allStudents.filter((s) =>
            selectedStudentIds.has(s.id)
          );

          function toStudentTarget(row: StudentRow): DeleteStudentTarget {
            return {
              id: row.id,
              fullName: row.fullName,
              email: row.email,
              institutionalId: row.institutionalId,
              enrollmentCount: row._count.enrollments,
            };
          }

          return (
            <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Student Accounts ({allStudents.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select one or more student accounts to permanently delete
                    them along with their class enrollments, points, and records.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={selectedRows.length === 0}
                  onClick={() =>
                    setDeleteStudentTargets(selectedRows.map(toStudentTarget))
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selected ({selectedRows.length})</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Filter by name, email, or student ID..."
                    className="w-full rounded-xl border border-slate-300 pl-8 pr-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStudentIds(
                          new Set([
                            ...selectedStudentIds,
                            ...filteredStudents.map((s) => s.id),
                          ])
                        );
                      } else {
                        const filteredSet = new Set(
                          filteredStudents.map((s) => s.id)
                        );
                        setSelectedStudentIds(
                          new Set(
                            Array.from(selectedStudentIds).filter(
                              (id) => !filteredSet.has(id)
                            )
                          )
                        );
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <span>
                    Select All{" "}
                    {needle
                      ? `Matching (${filteredStudents.length})`
                      : `(${filteredStudents.length})`}
                  </span>
                </label>
              </div>

              {loadingStudents ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Loading students...
                </p>
              ) : filteredStudents.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No students match your filter.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredStudents.map((student) => {
                    const checked = selectedStudentIds.has(student.id);
                    return (
                      <div
                        key={student.id}
                        className="py-3 flex items-center justify-between gap-3 flex-wrap"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Select ${student.fullName}`}
                            onChange={(e) => {
                              setSelectedStudentIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(student.id);
                                } else {
                                  next.delete(student.id);
                                }
                                return next;
                              });
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {student.fullName}
                              </p>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                  student.status === "ACTIVE"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : student.status === "PENDING"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700"
                                )}
                              >
                                {student.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {student.email}
                              {student.institutionalId
                                ? ` • ${student.institutionalId}`
                                : ""}{" "}
                              • {student._count.enrollments}{" "}
                              {student._count.enrollments === 1
                                ? "enrollment"
                                : "enrollments"}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setDeleteStudentTargets([toStudentTarget(student)])
                          }
                          aria-label={`Delete ${student.fullName}`}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 shrink-0"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()}

        {tab === "subjects" && (() => {
          const allSubjects = subjectsData?.subjects ?? [];
          const needle = subjectSearch.trim().toLowerCase();
          const filteredSubjects = needle
            ? allSubjects.filter(
                (s) =>
                  s.code.toLowerCase().includes(needle) ||
                  s.title.toLowerCase().includes(needle) ||
                  s.section.toLowerCase().includes(needle) ||
                  s.teacher.fullName.toLowerCase().includes(needle) ||
                  s.teacher.email.toLowerCase().includes(needle)
              )
            : allSubjects;
          const allFilteredSelected =
            filteredSubjects.length > 0 &&
            filteredSubjects.every((s) => selectedSubjectIds.has(s.id));
          const selectedRows = allSubjects.filter((s) =>
            selectedSubjectIds.has(s.id)
          );

          function toTarget(row: AdminSubjectRow): DeleteSubjectTarget {
            return {
              id: row.id,
              code: row.code,
              title: row.title,
              section: row.section,
              enrollmentCount: row._count.enrollments,
            };
          }

          return (
            <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    All Sections &amp; Subjects ({allSubjects.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Select one or more sections to permanently delete them,
                    unenroll students, and clear accumulated points and linked
                    notifications.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={selectedRows.length === 0}
                  onClick={() => setDeleteTargets(selectedRows.map(toTarget))}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selected ({selectedRows.length})</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={subjectSearch}
                    onChange={(e) => setSubjectSearch(e.target.value)}
                    placeholder="Filter by code, section, title, or instructor..."
                    className="w-full rounded-xl border border-slate-300 pl-8 pr-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSubjectIds(
                          new Set([
                            ...selectedSubjectIds,
                            ...filteredSubjects.map((s) => s.id),
                          ])
                        );
                      } else {
                        const filteredSet = new Set(
                          filteredSubjects.map((s) => s.id)
                        );
                        setSelectedSubjectIds(
                          new Set(
                            Array.from(selectedSubjectIds).filter(
                              (id) => !filteredSet.has(id)
                            )
                          )
                        );
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <span>
                    Select All{" "}
                    {needle
                      ? `Matching (${filteredSubjects.length})`
                      : `(${filteredSubjects.length})`}
                  </span>
                </label>
              </div>

              {loadingSubjects ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Loading sections...
                </p>
              ) : filteredSubjects.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No sections match your filter.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredSubjects.map((subject) => {
                    const checked = selectedSubjectIds.has(subject.id);
                    const dateRange = formatSubjectDateRange(
                      subject.startDate,
                      subject.endDate
                    );
                    return (
                      <div
                        key={subject.id}
                        className="py-3 flex items-center justify-between gap-3 flex-wrap"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Select ${subject.code} ${subject.section}`}
                            onChange={(e) => {
                              setSelectedSubjectIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(subject.id);
                                } else {
                                  next.delete(subject.id);
                                }
                                return next;
                              });
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                {subject.code} • {subject.section}
                              </span>
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {subject.title}
                              </p>
                              {subject.isArchived && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                  Archived
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Instructor: {subject.teacher.fullName} •{" "}
                              {subject.term.name} •{" "}
                              {subject._count.enrollments} enrolled
                              {dateRange ? ` • ${dateRange}` : ""}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setDeleteTargets([toTarget(subject)])}
                          aria-label={`Delete ${subject.code} ${subject.section}`}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 shrink-0"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()}

        {tab === "invites" && (
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
            <form
              onSubmit={handleCreateInvite}
              className="grid gap-3 sm:grid-cols-4 items-end"
            >
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Label (Optional)
                </label>
                <input
                  type="text"
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                  placeholder="CCS Faculty Onboarding"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Max Uses
                </label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={inviteMaxUses}
                  onChange={(e) => setInviteMaxUses(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Expires (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={inviteExpiresDays}
                  onChange={(e) => setInviteExpiresDays(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-4">
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Generate Teacher Invite Code
                </button>
              </div>
            </form>

            {generatedCode && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-semibold text-emerald-800">
                    New Invite Code (Copy now — shown once):
                  </p>
                  <p className="text-lg font-mono font-bold text-emerald-950">
                    {generatedCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {copiedCode ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedCode ? "Copied" : "Copy Code"}</span>
                </button>
              </div>
            )}

            <div className="divide-y divide-slate-100">
              {(invitesData?.invites ?? []).map((invite) => (
                <div
                  key={invite.id}
                  className="py-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {invite.label || "Teacher Invite"}
                    </p>
                    <p className="text-slate-500">
                      Used {invite.usedCount} / {invite.maxUses}
                    </p>
                  </div>
                  <span className="text-slate-500">
                    {invite.expiresAt
                      ? `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`
                      : "No expiry"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "terms" && (
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
            {termError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2 text-xs text-rose-700">
                {termError}
              </div>
            )}
            <form
              onSubmit={handleCreateTerm}
              className="grid gap-3 sm:grid-cols-4 items-end"
            >
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Term Name
                </label>
                <input
                  type="text"
                  required
                  value={termName}
                  onChange={(e) => setTermName(e.target.value)}
                  placeholder="2nd Sem 2026-2027"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={termStart}
                  onChange={(e) => setTermStart(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  End Date
                </label>
                <input
                  type="date"
                  required
                  value={termEnd}
                  onChange={(e) => setTermEnd(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-4 flex items-center justify-between gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={termActive}
                    onChange={(e) => setTermActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Set as active term immediately</span>
                </label>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Create Academic Term
                </button>
              </div>
            </form>

            <div className="divide-y divide-slate-100">
              {(termsData?.terms ?? []).map((term) => (
                <div
                  key={term.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {term.name}
                      </p>
                      {term.isActive && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(term.startDate).toLocaleDateString()} –{" "}
                      {new Date(term.endDate).toLocaleDateString()} •{" "}
                      {term._count.subjects} subjects
                    </p>
                  </div>
                  {!term.isActive && (
                    <button
                      type="button"
                      onClick={() => handleActivateTerm(term.id)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Set Active
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "audit" && (
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  System Audit Logs
                </h3>
                <p className="text-xs text-slate-500">
                  Immutable record of attendance overrides, point adjustments,
                  redemptions, score edits, and admin actions.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {auditData?.total ?? 0} total events
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAuditPage(1);
                setAppliedAuditSearch(auditSearch);
              }}
              className="grid gap-2.5 sm:grid-cols-4"
            >
              <div className="relative sm:col-span-2">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="audit-search-input"
                  type="search"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search actor, email, action, subject, target ID..."
                  className="w-full rounded-xl border border-slate-300 pl-8 pr-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <select
                id="audit-action-filter"
                aria-label="Filter by audit action"
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditActionFilter(e.target.value);
                  setAuditPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">All Actions</option>
                {(auditData?.actions ?? []).map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Search Logs
              </button>
            </form>

            {loadingAudit ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                Loading audit logs...
              </div>
            ) : !auditData || auditData.logs.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                No audit logs match the current filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {auditData.logs.map((log) => {
                  const isExpanded = expandedAuditId === log.id;
                  return (
                    <div key={log.id} className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-mono font-semibold text-indigo-800">
                              {log.action}
                            </span>
                            <span className="text-xs font-semibold text-slate-800">
                              {log.targetType}
                            </span>
                            {log.subject && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {log.subject.code} ({log.subject.section})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600">
                            Actor:{" "}
                            <span className="font-medium text-slate-900">
                              {log.actor
                                ? `${log.actor.fullName} (${log.actor.email})`
                                : "System"}
                            </span>
                            {log.ipAddress ? ` • IP: ${log.ipAddress}` : ""}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-slate-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAuditId(isExpanded ? null : log.id)
                            }
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {isExpanded ? "Hide JSON" : "Inspect"}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="grid gap-2 sm:grid-cols-2 rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] font-mono">
                          <div>
                            <p className="font-sans font-semibold text-slate-700 mb-1">
                              Before State
                            </p>
                            <pre className="overflow-x-auto text-slate-600 whitespace-pre-wrap break-all">
                              {log.beforeState
                                ? JSON.stringify(log.beforeState, null, 2)
                                : "null"}
                            </pre>
                          </div>
                          <div>
                            <p className="font-sans font-semibold text-slate-700 mb-1">
                              After State
                            </p>
                            <pre className="overflow-x-auto text-slate-800 whitespace-pre-wrap break-all">
                              {log.afterState
                                ? JSON.stringify(log.afterState, null, 2)
                                : "null"}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {auditData && auditData.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500">
                  Page {auditData.page} of {auditData.totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={auditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    disabled={auditPage >= auditData.totalPages}
                    onClick={() =>
                      setAuditPage((p) => Math.min(auditData.totalPages, p + 1))
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <DeleteSubjectModal
        subjects={deleteTargets}
        onClose={() => setDeleteTargets([])}
        onDeleted={async () => {
          for (const item of deleteTargets) {
            queryClient.removeQueries({ queryKey: ["subject", item.id] });
          }
          setDeleteTargets([]);
          setSelectedSubjectIds(new Set());
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["admin", "subjects"] }),
            queryClient.invalidateQueries({
              queryKey: ["admin", "audit-logs"],
            }),
            queryClient.invalidateQueries({ queryKey: ["subjects"] }),
          ]);
        }}
      />

      <DeleteStudentModal
        students={deleteStudentTargets}
        onClose={() => setDeleteStudentTargets([])}
        onDeleted={async () => {
          setDeleteStudentTargets([]);
          setSelectedStudentIds(new Set());
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["admin", "students"] }),
            queryClient.invalidateQueries({ queryKey: ["admin", "subjects"] }),
            queryClient.invalidateQueries({
              queryKey: ["admin", "audit-logs"],
            }),
          ]);
        }}
      />
    </AppShell>
  );
}
