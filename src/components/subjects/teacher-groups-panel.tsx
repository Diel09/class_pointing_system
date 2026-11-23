"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  FolderKanban,
  Pencil,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";

export interface GroupSetMemberItem {
  enrollmentId: string;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
}

export interface StudentGroupItem {
  id: string;
  name: string;
  sortOrder: number;
  members: GroupSetMemberItem[];
}

export interface GroupSetItem {
  id: string;
  subjectId: string;
  name: string;
  groups: StudentGroupItem[];
  unassignedStudents: GroupSetMemberItem[];
  assessmentsUsing: {
    id: string;
    title: string;
    hasRecordedWork: boolean;
  }[];
  hasRecordedWork: boolean;
}

interface TeacherGroupsPanelProps {
  subjectId: string;
  isArchived: boolean;
}

/**
 * Primary-teacher workspace for organizing reusable Group Sets (e.g. Lab Groups,
 * Project Teams), auto-splitting the roster, and moving students between groups.
 */
export function TeacherGroupsPanel({
  subjectId,
  isArchived,
}: TeacherGroupsPanelProps) {
  const queryClient = useQueryClient();

  const [selectedGroupSetId, setSelectedGroupSetId] = useState<string>("");
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [autoGenerateOnCreate, setAutoGenerateOnCreate] = useState(true);
  const [createGenMode, setCreateGenMode] = useState<"count" | "size">("count");
  const [createGenValue, setCreateGenValue] = useState(4);
  const [createShuffle, setCreateShuffle] = useState(true);
  const [creatingSet, setCreatingSet] = useState(false);

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editSetName, setEditSetName] = useState("");
  const [savingSetName, setSavingSetName] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");

  const [showAutoAssign, setShowAutoAssign] = useState(false);
  const [assignScope, setAssignScope] = useState<"unassigned" | "all">(
    "unassigned"
  );
  const [assignMode, setAssignMode] = useState<"existing" | "count" | "size">(
    "existing"
  );
  const [assignValue, setAssignValue] = useState(4);
  const [assignShuffle, setAssignShuffle] = useState(true);
  const [autoAssigning, setAutoAssigning] = useState(false);

  const [unassignedQuery, setUnassignedQuery] = useState("");
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    groupSets: GroupSetItem[];
    totalEnrolled: number;
  }>({
    queryKey: ["subject-group-sets", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/group-sets`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Unable to load group sets.");
      }
      return (await res.json()) as {
        groupSets: GroupSetItem[];
        totalEnrolled: number;
      };
    },
    enabled: Boolean(subjectId),
  });

  const groupSets = useMemo(() => data?.groupSets ?? [], [data?.groupSets]);

  useEffect(() => {
    if (groupSets.length === 0) {
      setSelectedGroupSetId("");
      return;
    }
    if (!groupSets.some((gs) => gs.id === selectedGroupSetId)) {
      setSelectedGroupSetId(groupSets[0]!.id);
    }
  }, [groupSets, selectedGroupSetId]);

  const activeSet = useMemo(
    () => groupSets.find((gs) => gs.id === selectedGroupSetId) ?? null,
    [groupSets, selectedGroupSetId]
  );

  const filteredUnassigned = useMemo(() => {
    if (!activeSet) return [];
    const q = unassignedQuery.trim().toLowerCase();
    if (!q) return activeSet.unassignedStudents;
    return activeSet.unassignedStudents.filter(
      (s) =>
        s.student.fullName.toLowerCase().includes(q) ||
        s.student.email.toLowerCase().includes(q) ||
        (s.student.institutionalId?.toLowerCase().includes(q) ?? false)
    );
  }, [activeSet, unassignedQuery]);

  async function refreshGroupData() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["subject-group-sets", subjectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["subject-assessments", subjectId],
      }),
    ]);
  }

  async function handleCreateGroupSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setCreatingSet(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/group-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSetName.trim(),
          autoGenerate: autoGenerateOnCreate
            ? {
                mode: createGenMode,
                value: Number(createGenValue) || 2,
                shuffle: createShuffle,
              }
            : null,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        groupSet?: GroupSetItem;
      };
      if (!res.ok || !payload.groupSet) {
        setErrorMessage(payload.error ?? "Unable to create group set.");
        return;
      }
      setNewSetName("");
      setShowCreateSet(false);
      setSelectedGroupSetId(payload.groupSet.id);
      setStatusMessage(`Created group set "${payload.groupSet.name}".`);
      await refreshGroupData();
    } catch {
      setErrorMessage("Network error while creating group set.");
    } finally {
      setCreatingSet(false);
    }
  }

  async function handleRenameGroupSet(groupSetId: string) {
    setErrorMessage(null);
    setStatusMessage(null);
    setSavingSetName(true);
    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/group-sets/${groupSetId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editSetName.trim() }),
        }
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "Unable to rename group set.");
        return;
      }
      setEditingSetId(null);
      setStatusMessage("Group set renamed.");
      await refreshGroupData();
    } catch {
      setErrorMessage("Network error while renaming group set.");
    } finally {
      setSavingSetName(false);
    }
  }

  async function handleDeleteGroupSet(groupSet: GroupSetItem) {
    if (groupSet.assessmentsUsing.length > 0) {
      setErrorMessage(
        `Cannot delete "${groupSet.name}" while it is assigned to ${groupSet.assessmentsUsing.length} assessment(s).`
      );
      return;
    }
    setErrorMessage(null);
    setStatusMessage(null);
    const res = await fetch(
      `/api/subjects/${subjectId}/group-sets/${groupSet.id}`,
      { method: "DELETE" }
    );
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setErrorMessage(payload.error ?? "Unable to delete group set.");
      return;
    }
    setStatusMessage(`Deleted group set "${groupSet.name}".`);
    await refreshGroupData();
  }

  async function handleAddGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSet || !newGroupName.trim()) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setCreatingGroup(true);
    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/group-sets/${activeSet.id}/groups`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newGroupName.trim() }),
        }
      );
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "Unable to create group.");
        return;
      }
      setNewGroupName("");
      await refreshGroupData();
    } catch {
      setErrorMessage("Network error while creating group.");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleRenameGroup(groupId: string) {
    if (!activeSet || !editGroupName.trim()) return;
    setErrorMessage(null);
    const res = await fetch(
      `/api/subjects/${subjectId}/group-sets/${activeSet.id}/groups`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          groupId,
          name: editGroupName.trim(),
        }),
      }
    );
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      setErrorMessage(payload.error ?? "Unable to rename group.");
      return;
    }
    setEditingGroupId(null);
    await refreshGroupData();
  }

  async function handleDeleteGroup(groupId: string) {
    if (!activeSet) return;
    setErrorMessage(null);
    const res = await fetch(
      `/api/subjects/${subjectId}/group-sets/${activeSet.id}/groups?groupId=${encodeURIComponent(
        groupId
      )}`,
      { method: "DELETE" }
    );
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setErrorMessage(payload.error ?? "Unable to delete group.");
      return;
    }
    await refreshGroupData();
  }

  async function handleMoveMember(
    enrollmentId: string,
    targetGroupId: string | null
  ) {
    if (!activeSet) return;
    setErrorMessage(null);
    setBusyMemberId(enrollmentId);
    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/group-sets/${activeSet.id}/groups`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move_member",
            enrollmentId,
            targetGroupId,
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "Unable to move student.");
        return;
      }
      await refreshGroupData();
    } catch {
      setErrorMessage("Network error while updating group membership.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleAutoAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSet) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setAutoAssigning(true);
    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/group-sets/${activeSet.id}/auto-assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: assignScope,
            mode: assignMode,
            ...(assignMode !== "existing"
              ? { value: Number(assignValue) || 2 }
              : {}),
            shuffle: assignShuffle,
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setErrorMessage(payload.error ?? "Unable to auto-assign students.");
        return;
      }
      setShowAutoAssign(false);
      setStatusMessage("Students assigned to groups.");
      await refreshGroupData();
    } catch {
      setErrorMessage("Network error while auto-assigning students.");
    } finally {
      setAutoAssigning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Group Sets Header & Selector */}
      <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2">
            <FolderKanban className="h-4 w-4 text-indigo-600 mt-0.5 sm:mt-0 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Student Group Sets ({groupSets.length})
              </h3>
              <p className="text-xs text-slate-500">
                Organize your class into reusable group sets (e.g. Lab Groups or Project Teams), then assign a group set to any assessment.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isArchived}
            onClick={() => setShowCreateSet((prev) => !prev)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showCreateSet ? "Close" : "New Group Set"}</span>
          </button>
        </div>

        {showCreateSet && (
          <form
            onSubmit={handleCreateGroupSet}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3"
          >
            <div className="space-y-1">
              <label
                htmlFor="new-group-set-name"
                className="block text-xs font-semibold text-slate-700"
              >
                Group Set Name
              </label>
              <input
                id="new-group-set-name"
                type="text"
                required
                minLength={2}
                maxLength={60}
                placeholder="e.g. Lab Groups, Midterm Project Teams"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateOnCreate}
                  onChange={(e) => setAutoGenerateOnCreate(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                />
                <span>
                  Auto-create groups and assign enrolled students (
                  {data?.totalEnrolled ?? 0})
                </span>
              </label>

              {autoGenerateOnCreate && (
                <div className="grid gap-2.5 sm:grid-cols-3 pt-1">
                  <select
                    aria-label="Group generation mode"
                    value={createGenMode}
                    onChange={(e) =>
                      setCreateGenMode(e.target.value as "count" | "size")
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="count">Split into N groups</option>
                    <option value="size">Target N students per group</option>
                  </select>

                  <input
                    type="number"
                    min={1}
                    max={200}
                    required
                    aria-label="Group count or size"
                    value={createGenValue}
                    onChange={(e) =>
                      setCreateGenValue(
                        Math.max(1, Number.parseInt(e.target.value, 10) || 1)
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />

                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createShuffle}
                      onChange={(e) => setCreateShuffle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                    />
                    <span>Shuffle randomly</span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creatingSet || newSetName.trim().length < 2}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{creatingSet ? "Creating..." : "Create Group Set"}</span>
              </button>
            </div>
          </form>
        )}

        {errorMessage && (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
          >
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800"
          >
            {statusMessage}
          </p>
        )}

        {isLoading ? (
          <p className="text-xs text-slate-500">Loading group sets...</p>
        ) : groupSets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-2">
            <Users className="h-6 w-6 text-slate-400 mx-auto" />
            <p className="text-xs font-semibold text-slate-700">
              No group sets yet
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Create your first group set (for example &ldquo;Lab Groups&rdquo;)
              to enable group submissions and group grading on assessments.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {groupSets.map((gs) => {
              const active = gs.id === activeSet?.id;
              return (
                <button
                  key={gs.id}
                  type="button"
                  onClick={() => setSelectedGroupSetId(gs.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  )}
                >
                  <span>{gs.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-slate-200 text-slate-700"
                    )}
                  >
                    {gs.groups.length} groups
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {activeSet && (
        <section className="space-y-4">
          {activeSet.hasRecordedWork && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">
                  This group set is already used by graded or submitted assessments:
                </p>
                <p className="text-amber-800">
                  {activeSet.assessmentsUsing
                    .filter((a) => a.hasRecordedWork)
                    .map((a) => a.title)
                    .join(", ")}
                  . Existing student scores remain intact if you move students;
                  future submissions and group grading will reflect the updated
                  groups.
                </p>
              </div>
            </div>
          )}

          {/* Active Group Set Action Bar */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {editingSetId === activeSet.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      aria-label="Edit group set name"
                      value={editSetName}
                      onChange={(e) => setEditSetName(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold"
                    />
                    <button
                      type="button"
                      disabled={savingSetName || editSetName.trim().length < 2}
                      onClick={() => void handleRenameGroupSet(activeSet.id)}
                      className="rounded-lg bg-indigo-600 p-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
                      aria-label="Save group set name"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSetId(null)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                      aria-label="Cancel renaming group set"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h4 className="text-base font-bold text-slate-900">
                      {activeSet.name}
                    </h4>
                    <button
                      type="button"
                      disabled={isArchived}
                      onClick={() => {
                        setEditingSetId(activeSet.id);
                        setEditSetName(activeSet.name);
                      }}
                      aria-label={`Rename ${activeSet.name}`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={
                        isArchived || activeSet.assessmentsUsing.length > 0
                      }
                      title={
                        activeSet.assessmentsUsing.length > 0
                          ? "In use by assessments"
                          : "Delete group set"
                      }
                      onClick={() => void handleDeleteGroupSet(activeSet)}
                      aria-label={`Delete ${activeSet.name}`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form onSubmit={handleAddGroup} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="New group name..."
                    aria-label="New group name"
                    disabled={isArchived}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="w-40 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={
                      isArchived || creatingGroup || !newGroupName.trim()
                    }
                    className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Group</span>
                  </button>
                </form>

                <button
                  type="button"
                  disabled={isArchived}
                  onClick={() => setShowAutoAssign((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  <span>Auto-Assign</span>
                </button>
              </div>
            </div>

            {showAutoAssign && (
              <form
                onSubmit={handleAutoAssign}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-2.5 sm:grid-cols-4 items-end"
              >
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Students
                  </label>
                  <select
                    value={assignScope}
                    onChange={(e) =>
                      setAssignScope(e.target.value as "unassigned" | "all")
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="unassigned">
                      Unassigned only ({activeSet.unassignedStudents.length})
                    </option>
                    <option value="all">
                      Re-assign all enrolled ({data?.totalEnrolled ?? 0})
                    </option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Distribution
                  </label>
                  <select
                    value={assignMode}
                    onChange={(e) =>
                      setAssignMode(
                        e.target.value as "existing" | "count" | "size"
                      )
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="existing">
                      Into existing groups ({activeSet.groups.length})
                    </option>
                    <option value="count">Split into N groups</option>
                    <option value="size">Target N students per group</option>
                  </select>
                </div>

                {assignMode !== "existing" ? (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-600">
                      {assignMode === "count" ? "Group count" : "Students / group"}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={assignValue}
                      onChange={(e) =>
                        setAssignValue(
                          Math.max(1, Number.parseInt(e.target.value, 10) || 1)
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-xs text-slate-700 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assignShuffle}
                      onChange={(e) => setAssignShuffle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                    />
                    <span>Shuffle order</span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={autoAssigning}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  <span>{autoAssigning ? "Assigning..." : "Run Auto-Assign"}</span>
                </button>
              </form>
            )}
          </div>

          {/* Unassigned + Groups Grid */}
          <div className="grid gap-6 lg:grid-cols-3 items-start">
            {/* Unassigned Students Pool */}
            <div className="lg:col-span-1 rounded-2xl bg-white border border-slate-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Unassigned Students ({activeSet.unassignedStudents.length})
                </h5>
              </div>

              {activeSet.unassignedStudents.length > 0 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={unassignedQuery}
                    onChange={(e) => setUnassignedQuery(e.target.value)}
                    placeholder="Filter unassigned..."
                    className="w-full rounded-xl border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
                  />
                </div>
              )}

              {activeSet.unassignedStudents.length === 0 ? (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  All enrolled students are assigned to a group in this set.
                </p>
              ) : filteredUnassigned.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No unassigned students match &ldquo;{unassignedQuery}&rdquo;.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                  {filteredUnassigned.map((item) => (
                    <div
                      key={item.enrollmentId}
                      className="py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {item.student.fullName}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.student.institutionalId ?? item.student.email}
                        </p>
                      </div>
                      <select
                        aria-label={`Assign ${item.student.fullName} to group`}
                        disabled={
                          isArchived ||
                          busyMemberId === item.enrollmentId ||
                          activeSet.groups.length === 0
                        }
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            void handleMoveMember(
                              item.enrollmentId,
                              e.target.value
                            );
                          }
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 disabled:opacity-50"
                      >
                        <option value="">Assign...</option>
                        {activeSet.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Groups Cards */}
            <div className="lg:col-span-2">
              {activeSet.groups.length === 0 ? (
                <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
                  No groups in &ldquo;{activeSet.name}&rdquo; yet. Add a group above or click Auto-Assign.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {activeSet.groups.map((group) => (
                    <div
                      key={group.id}
                      className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        {editingGroupId === group.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <input
                              type="text"
                              value={editGroupName}
                              onChange={(e) => setEditGroupName(e.target.value)}
                              className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold"
                            />
                            <button
                              type="button"
                              onClick={() => void handleRenameGroup(group.id)}
                              className="rounded-lg bg-indigo-600 p-1 text-white"
                              aria-label="Save group name"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGroupId(null)}
                              className="rounded-lg border border-slate-200 p-1 text-slate-600"
                              aria-label="Cancel group rename"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 min-w-0">
                              <h6 className="text-sm font-bold text-slate-900 truncate">
                                {group.name}
                              </h6>
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 shrink-0">
                                {group.members.length}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={isArchived}
                                onClick={() => {
                                  setEditingGroupId(group.id);
                                  setEditGroupName(group.name);
                                }}
                                aria-label={`Rename ${group.name}`}
                                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={isArchived}
                                onClick={() => void handleDeleteGroup(group.id)}
                                aria-label={`Delete ${group.name}`}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {group.members.length === 0 ? (
                        <p className="text-[11px] text-slate-400 py-2">
                          No members assigned yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {group.members.map((m) => (
                            <div
                              key={m.enrollmentId}
                              className="py-2 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">
                                  {m.student.fullName}
                                </p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  {m.student.institutionalId ?? m.student.email}
                                </p>
                              </div>
                              <select
                                aria-label={`Move ${m.student.fullName}`}
                                disabled={
                                  isArchived || busyMemberId === m.enrollmentId
                                }
                                value={group.id}
                                onChange={(e) => {
                                  const nextVal = e.target.value;
                                  void handleMoveMember(
                                    m.enrollmentId,
                                    nextVal === "__UNASSIGN__" ? null : nextVal
                                  );
                                }}
                                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                              >
                                {activeSet.groups.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.name}
                                  </option>
                                ))}
                                <option value="__UNASSIGN__">Unassign</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
