"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  QrCode,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState, type FormEvent } from "react";
import type { SubjectDetailDto } from "@/components/subjects/subject-workspace-shell";
import {
  UnenrollStudentModal,
  type UnenrollStudentTarget,
} from "@/components/subjects/unenroll-student-modal";

export interface RosterItem {
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

interface TeacherRosterPanelProps {
  subjectId: string;
  subject: SubjectDetailDto;
}

/**
 * Dedicated teacher roster management workspace:
 * search & bulk-manage enrolled students alongside class enrollment and invite QR tools.
 */
export function TeacherRosterPanel({
  subjectId,
  subject,
}: TeacherRosterPanelProps) {
  const queryClient = useQueryClient();

  const [copied, setCopied] = useState(false);
  const [rosterInput, setRosterInput] = useState("");
  const [rosterResult, setRosterResult] = useState<ImportResult | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<
    Set<string>
  >(new Set());
  const [unenrollTargets, setUnenrollTargets] = useState<
    UnenrollStudentTarget[]
  >([]);

  const [coTeacherInput, setCoTeacherInput] = useState("");
  const [coTeacherResult, setCoTeacherResult] = useState<{
    added: { id: string; fullName: string; email: string }[];
    alreadyCoTeacher: { id: string; fullName: string; email: string }[];
    notFound: string[];
  } | null>(null);
  const [coTeacherError, setCoTeacherError] = useState<string | null>(null);
  const [addingCoTeacher, setAddingCoTeacher] = useState(false);
  const [removingCoTeacherId, setRemovingCoTeacherId] = useState<string | null>(
    null
  );

  const coTeachers = useMemo(
    () => subject.coTeachers ?? [],
    [subject.coTeachers]
  );

  const { data: rosterData, isLoading: rosterLoading } = useQuery<{
    roster: RosterItem[];
  }>({
    queryKey: ["subject-roster", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/roster`, {
        credentials: "same-origin",
      });
      if (!res.ok) return { roster: [] };
      return (await res.json()) as { roster: RosterItem[] };
    },
    enabled: Boolean(subjectId),
  });

  const inviteUrl =
    typeof window !== "undefined" && subject.inviteCode
      ? `${window.location.origin}/join?code=${subject.inviteCode}`
      : "";

  const rosterList = useMemo(
    () => rosterData?.roster ?? [],
    [rosterData?.roster]
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredRoster = useMemo(() => {
    if (!normalizedSearch) return rosterList;
    return rosterList.filter((entry) => {
      const name = entry.student.fullName.toLowerCase();
      const email = entry.student.email.toLowerCase();
      const instId = (entry.student.institutionalId ?? "").toLowerCase();
      return (
        name.includes(normalizedSearch) ||
        email.includes(normalizedSearch) ||
        instId.includes(normalizedSearch)
      );
    });
  }, [rosterList, normalizedSearch]);

  const allVisibleSelected =
    filteredRoster.length > 0 &&
    filteredRoster.every((entry) => selectedEnrollmentIds.has(entry.id));

  const selectedRows = useMemo(
    () => rosterList.filter((entry) => selectedEnrollmentIds.has(entry.id)),
    [rosterList, selectedEnrollmentIds]
  );

  async function handleCopyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  async function handleAddCoTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCoTeacherError(null);
    setCoTeacherResult(null);
    setAddingCoTeacher(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/co-teachers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: coTeacherInput }),
      });
      const data = (await res.json()) as {
        added: { id: string; fullName: string; email: string }[];
        alreadyCoTeacher: { id: string; fullName: string; email: string }[];
        notFound: string[];
        error?: string;
      };
      if (!res.ok) {
        setCoTeacherError(data.error ?? "Failed to add co-teacher.");
        return;
      }
      setCoTeacherResult(data);
      setCoTeacherInput("");
      await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    } catch {
      setCoTeacherError("Network error while adding co-teacher.");
    } finally {
      setAddingCoTeacher(false);
    }
  }

  async function handleRemoveCoTeacher(coTeacherId: string) {
    setRemovingCoTeacherId(coTeacherId);
    setCoTeacherError(null);
    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/co-teachers/${coTeacherId}`,
        {
          method: "DELETE",
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setCoTeacherError(data.error ?? "Failed to remove co-teacher.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    } finally {
      setRemovingCoTeacherId(null);
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

  function handleToggleSelectVisible(checked: boolean) {
    setSelectedEnrollmentIds((prev) => {
      const next = new Set(prev);
      for (const entry of filteredRoster) {
        if (checked) {
          next.add(entry.id);
        } else {
          next.delete(entry.id);
        }
      }
      return next;
    });
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-5 items-start">
        {/* Enrollment & Invite Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Enroll Card */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Enroll Students
              </h3>
            </div>

            <form onSubmit={handleAddRoster} className="space-y-3">
              <label
                htmlFor="roster-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Email or Institutional ID (comma or newline separated)
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
                      Already enrolled: {rosterResult.alreadyEnrolled.length}
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
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>{importing ? "Adding..." : "Add to Roster"}</span>
              </button>
            </form>
          </section>

          {/* Class Invite & QR */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
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

            {subject.inviteCode && (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
                <div className="rounded-xl bg-white p-3 border border-slate-200">
                  <QRCodeSVG
                    value={inviteUrl || `code=${subject.inviteCode}`}
                    size={168}
                  />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Invite Code
                  </p>
                  <p className="text-xl font-mono font-bold tracking-widest text-slate-900">
                    {subject.inviteCode}
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

          {/* Co-Teachers Management Card */}
          <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Co-Teachers ({coTeachers.length})
                </h3>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Co-teachers can manage assessments, grade scores, run attendance,
              award points, review redemptions, and upload learning materials.
            </p>

            <form onSubmit={handleAddCoTeacher} className="space-y-3">
              <label
                htmlFor="co-teacher-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Teacher Email or Institutional ID
              </label>
              <input
                id="co-teacher-input"
                type="text"
                value={coTeacherInput}
                onChange={(e) => setCoTeacherInput(e.target.value)}
                placeholder="teacher2@classpulse.local or T-2026-002"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:border-indigo-500 focus:outline-none"
              />
              {coTeacherError && (
                <p role="alert" className="text-xs text-rose-600">
                  {coTeacherError}
                </p>
              )}
              {coTeacherResult && (
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                  <p className="font-semibold text-emerald-700">
                    Added: {coTeacherResult.added.length}
                  </p>
                  {coTeacherResult.alreadyCoTeacher.length > 0 && (
                    <p className="text-slate-600">
                      Already assigned:{" "}
                      {coTeacherResult.alreadyCoTeacher.length}
                    </p>
                  )}
                  {coTeacherResult.notFound.length > 0 && (
                    <p className="text-amber-700">
                      Not found: {coTeacherResult.notFound.join(", ")}
                    </p>
                  )}
                </div>
              )}
              <button
                type="submit"
                disabled={addingCoTeacher || coTeacherInput.trim().length === 0}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>
                  {addingCoTeacher ? "Adding..." : "Add Co-Teacher"}
                </span>
              </button>
            </form>

            {coTeachers.length > 0 && (
              <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
                {coTeachers.map((ct) => (
                  <div
                    key={ct.id}
                    className="py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {ct.teacher.fullName}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {ct.teacher.institutionalId
                          ? `${ct.teacher.institutionalId} • `
                          : ""}
                        {ct.teacher.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={removingCoTeacherId === ct.id}
                      onClick={() => void handleRemoveCoTeacher(ct.id)}
                      aria-label={`Remove co-teacher ${ct.teacher.fullName}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 shrink-0"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      <span>
                        {removingCoTeacherId === ct.id ? "..." : "Remove"}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Main Student Roster Card */}
        <section className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Student Roster ({rosterList.length})
              </h3>
            </div>
            {normalizedSearch && (
              <span className="text-xs text-slate-500">
                Showing {filteredRoster.length} of {rosterList.length}
              </span>
            )}
          </div>

          {rosterList.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search students by name, email, or institutional ID..."
                aria-label="Search student roster"
                className="w-full rounded-xl border border-slate-300 bg-slate-50/70 pl-9 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear roster search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {rosterLoading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading student roster...
            </div>
          ) : rosterList.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center space-y-1">
              <p className="text-xs font-semibold text-slate-700">
                No students enrolled yet
              </p>
              <p className="text-xs text-slate-500">
                Share the class invite code or enroll students by email or ID on
                the left.
              </p>
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                No students match &ldquo;{searchQuery.trim()}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) =>
                      handleToggleSelectVisible(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <span>
                    {normalizedSearch
                      ? `Select Visible (${filteredRoster.length})`
                      : `Select All (${rosterList.length})`}
                  </span>
                </label>

                <button
                  type="button"
                  disabled={selectedRows.length === 0}
                  onClick={() =>
                    setUnenrollTargets(selectedRows.map(toUnenrollTarget))
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  <span>Unenroll Selected ({selectedRows.length})</span>
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {filteredRoster.map((entry) => {
                  const checked = selectedEnrollmentIds.has(entry.id);
                  return (
                    <div
                      key={entry.id}
                      className="py-3 flex items-center justify-between gap-3"
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
                            setUnenrollTargets([toUnenrollTarget(entry)])
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
            </div>
          )}
        </section>
      </div>

      <UnenrollStudentModal
        subjectId={subjectId}
        subjectLabel={`${subject.code} • ${subject.section} — ${subject.title}`}
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
  );
}
