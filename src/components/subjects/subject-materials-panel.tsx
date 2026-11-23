"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Presentation,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { GoogleDriveResourceType } from "@/lib/submissions/google-drive-link";

export interface SubjectMaterialDto {
  id: string;
  subjectId: string;
  title: string;
  topic: string | null;
  description: string | null;
  driveUrl: string;
  normalizedUrl: string;
  driveResourceId: string | null;
  resourceType: GoogleDriveResourceType;
  accessStatus: "PUBLIC_VERIFIED" | "UNVERIFIED" | "PRIVATE_OR_RESTRICTED";
  accessCheckedAt: string | null;
  requirePublicLink: boolean;
  uploadedByTeacher: {
    id: string;
    fullName: string;
    email: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface SubjectMaterialsPanelProps {
  subjectId: string;
  isInstructor: boolean;
  isArchived: boolean;
}

function getResourceTypeMeta(resourceType: GoogleDriveResourceType) {
  switch (resourceType) {
    case "FOLDER":
      return {
        label: "Drive Folder",
        Icon: Folder,
        className: "bg-indigo-50 text-indigo-700 border-indigo-200",
      };
    case "DOCUMENT":
      return {
        label: "Google Doc",
        Icon: FileText,
        className: "bg-sky-50 text-sky-700 border-sky-200",
      };
    case "SPREADSHEET":
      return {
        label: "Google Sheet",
        Icon: FileSpreadsheet,
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "PRESENTATION":
      return {
        label: "Google Slides",
        Icon: Presentation,
        className: "bg-amber-50 text-amber-800 border-amber-200",
      };
    case "FORM":
      return {
        label: "Google Form",
        Icon: FileText,
        className: "bg-purple-50 text-purple-700 border-purple-200",
      };
    case "FILE":
    default:
      return {
        label: "Drive File",
        Icon: FileText,
        className: "bg-slate-100 text-slate-700 border-slate-200",
      };
  }
}

export function SubjectMaterialsPanel({
  subjectId,
  isInstructor,
  isArchived,
}: SubjectMaterialsPanelProps) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [requirePublicLink, setRequirePublicLink] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDriveUrl, setEditDriveUrl] = useState("");
  const [editRequirePublicLink, setEditRequirePublicLink] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<string>("ALL");

  const { data, isLoading, error } = useQuery<{
    materials: SubjectMaterialDto[];
  }>({
    queryKey: ["subject-materials", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/materials`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Unable to load learning materials.");
      }
      return (await res.json()) as { materials: SubjectMaterialDto[] };
    },
    enabled: Boolean(subjectId),
  });

  const materials = useMemo(() => data?.materials ?? [], [data?.materials]);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    for (const item of materials) {
      if (item.topic?.trim()) {
        set.add(item.topic.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return materials.filter((item) => {
      if (
        selectedTopic !== "ALL" &&
        (item.topic?.trim() ?? "") !== selectedTopic
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.topic?.toLowerCase().includes(q) ?? false) ||
        (item.description?.toLowerCase().includes(q) ?? false) ||
        (item.uploadedByTeacher?.fullName.toLowerCase().includes(q) ?? false)
      );
    });
  }, [materials, searchQuery, selectedTopic]);

  async function handleCreateMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setCreateError(
        "Internet connection required to verify and post a Google Drive link."
      );
      return;
    }

    setCreating(true);
    setCreateError(null);
    setFeedbackMessage(null);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          topic: topic.trim() || null,
          description: description.trim() || null,
          driveUrl: driveUrl.trim(),
          requirePublicLink,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        material?: SubjectMaterialDto;
        accessWarning?: string | null;
      };
      if (!res.ok || !payload.material) {
        setCreateError(payload.error ?? "Failed to post learning material.");
        return;
      }

      setTitle("");
      setTopic("");
      setDescription("");
      setDriveUrl("");
      setRequirePublicLink(true);
      setShowCreateForm(false);
      setFeedbackMessage(
        payload.accessWarning
          ? `Posted "${payload.material.title}". Note: ${payload.accessWarning}`
          : `Posted "${payload.material.title}" to class materials.`
      );
      await queryClient.invalidateQueries({
        queryKey: ["subject-materials", subjectId],
      });
    } catch {
      setCreateError("Network error while posting learning material.");
    } finally {
      setCreating(false);
    }
  }

  function startEditMaterial(item: SubjectMaterialDto) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditTopic(item.topic ?? "");
    setEditDescription(item.description ?? "");
    setEditDriveUrl(item.driveUrl);
    setEditRequirePublicLink(item.requirePublicLink);
    setEditError(null);
    setFeedbackMessage(null);
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    if (!navigator.onLine) {
      setEditError(
        "Internet connection required to update a Google Drive material link."
      );
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    setFeedbackMessage(null);

    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/materials/${editingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle.trim(),
            topic: editTopic.trim() || null,
            description: editDescription.trim() || null,
            driveUrl: editDriveUrl.trim(),
            requirePublicLink: editRequirePublicLink,
          }),
        }
      );
      const payload = (await res.json()) as {
        error?: string;
        material?: SubjectMaterialDto;
        accessWarning?: string | null;
      };
      if (!res.ok || !payload.material) {
        setEditError(payload.error ?? "Unable to update learning material.");
        return;
      }

      setEditingId(null);
      setFeedbackMessage(
        payload.accessWarning
          ? `Updated "${payload.material.title}". Note: ${payload.accessWarning}`
          : `Updated "${payload.material.title}".`
      );
      await queryClient.invalidateQueries({
        queryKey: ["subject-materials", subjectId],
      });
    } catch {
      setEditError("Network error while updating learning material.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteMaterial(item: SubjectMaterialDto) {
    setDeletingId(item.id);
    setFeedbackMessage(null);

    try {
      const res = await fetch(
        `/api/subjects/${subjectId}/materials/${item.id}`,
        {
          method: "DELETE",
        }
      );
      if (res.ok) {
        if (editingId === item.id) {
          setEditingId(null);
        }
        setFeedbackMessage(`Removed "${item.title}" from class materials.`);
        await queryClient.invalidateQueries({
          queryKey: ["subject-materials", subjectId],
        });
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2">
          <FolderOpen className="h-4 w-4 text-indigo-600 mt-0.5 sm:mt-0 shrink-0" />
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Learning Materials ({materials.length})
            </h3>
            <p className="text-xs text-slate-500">
              {isInstructor
                ? "Share Google Drive files, folders, slides, and docs with your students."
                : "Access Google Drive lecture slides, handouts, and folders shared by your instructors."}
            </p>
          </div>
        </div>

        {isInstructor && (
          <button
            type="button"
            disabled={isArchived}
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showCreateForm ? "Close" : "Add Material"}</span>
          </button>
        )}
      </div>

      {!isOnline && (showCreateForm || Boolean(editingId)) && (
        <OfflineBanner message="Internet connection required to verify and post Google Drive links." />
      )}

      {feedbackMessage && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
        >
          {feedbackMessage}
        </p>
      )}

      {isInstructor && showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateMaterial(e)}
          className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="material-title"
                className="block text-xs font-semibold text-slate-700"
              >
                Material Title
              </label>
              <input
                id="material-title"
                type="text"
                required
                maxLength={160}
                placeholder="e.g. Week 1 Lecture Slides & Syllabus"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="material-topic"
                className="block text-xs font-semibold text-slate-700"
              >
                Topic / Module (optional)
              </label>
              <input
                id="material-topic"
                type="text"
                maxLength={80}
                placeholder="e.g. Week 1, Midterm Review, Lab Handouts"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="material-drive-url"
              className="block text-xs font-semibold text-slate-700"
            >
              Google Drive Link
            </label>
            <input
              id="material-drive-url"
              type="url"
              required
              placeholder="https://drive.google.com/drive/folders/... or https://drive.google.com/file/d/.../view"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="material-description"
              className="block text-xs font-semibold text-slate-700"
            >
              Description / Notes (optional)
            </label>
            <textarea
              id="material-description"
              rows={2}
              maxLength={1000}
              placeholder="Instructions or summary of what's inside this link..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              id="material-require-public"
              type="checkbox"
              checked={requirePublicLink}
              onChange={(e) => setRequirePublicLink(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
            />
            <span>
              Require public (&ldquo;Anyone with the link&rdquo;) access check
              <span className="block text-[11px] text-slate-500">
                Uncheck if this link is restricted to your school&apos;s Google
                Workspace domain.
              </span>
            </span>
          </label>

          {createError && (
            <p role="alert" className="text-xs font-medium text-rose-700">
              {createError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>{creating ? "Posting..." : "Post Material"}</span>
            </button>
          </div>
        </form>
      )}

      {materials.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search materials by title, topic, or description..."
              aria-label="Search learning materials"
              className="w-full rounded-xl border border-slate-300 bg-slate-50/70 pl-9 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear material search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {availableTopics.length > 0 && (
            <select
              aria-label="Filter materials by topic"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="ALL">All Topics ({materials.length})</option>
              {availableTopics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          Loading learning materials...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
          {error instanceof Error
            ? error.message
            : "Failed to load learning materials."}
        </div>
      ) : materials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center space-y-1.5">
          <FolderOpen className="h-7 w-7 text-slate-400 mx-auto" />
          <p className="text-xs font-semibold text-slate-700">
            No learning materials posted yet
          </p>
          <p className="text-xs text-slate-500">
            {isInstructor
              ? 'Click "Add Material" above to share a Google Drive file, folder, or document link with your class.'
              : "Your instructors haven't uploaded any Google Drive material links for this subject yet."}
          </p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center space-y-2">
          <p className="text-xs font-semibold text-slate-700">
            No materials match your current filter
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedTopic("ALL");
            }}
            className="text-xs font-semibold text-indigo-600 hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {filteredMaterials.map((item) => {
            const typeMeta = getResourceTypeMeta(item.resourceType);
            const ResourceIcon = typeMeta.Icon;
            const isEditing = editingId === item.id;

            return (
              <div key={item.id} className="p-4 space-y-3">
                {isEditing && isInstructor ? (
                  <form
                    onSubmit={(e) => void handleSaveEdit(e)}
                    className="space-y-3 rounded-xl border border-indigo-200 bg-slate-50 p-3.5"
                  >
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-material-title-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Material Title
                        </label>
                        <input
                          id={`edit-material-title-${item.id}`}
                          type="text"
                          required
                          maxLength={160}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor={`edit-material-topic-${item.id}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Topic / Module (optional)
                        </label>
                        <input
                          id={`edit-material-topic-${item.id}`}
                          type="text"
                          maxLength={80}
                          value={editTopic}
                          onChange={(e) => setEditTopic(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`edit-material-url-${item.id}`}
                        className="block text-[11px] font-semibold text-slate-700"
                      >
                        Google Drive Link
                      </label>
                      <input
                        id={`edit-material-url-${item.id}`}
                        type="url"
                        required
                        value={editDriveUrl}
                        onChange={(e) => setEditDriveUrl(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`edit-material-desc-${item.id}`}
                        className="block text-[11px] font-semibold text-slate-700"
                      >
                        Description / Notes (optional)
                      </label>
                      <textarea
                        id={`edit-material-desc-${item.id}`}
                        rows={2}
                        maxLength={1000}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editRequirePublicLink}
                        onChange={(e) =>
                          setEditRequirePublicLink(e.target.checked)
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      <span>
                        Require public (&ldquo;Anyone with the link&rdquo;)
                        access check
                      </span>
                    </label>

                    {editError && (
                      <p role="alert" className="text-xs text-rose-700">
                        {editError}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {savingEdit ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">
                          {item.title}
                        </span>
                        {item.topic && (
                          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                            {item.topic}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${typeMeta.className}`}
                        >
                          <ResourceIcon className="h-3 w-3" />
                          <span>{typeMeta.label}</span>
                        </span>
                        {item.accessStatus === "PUBLIC_VERIFIED" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Public Link</span>
                          </span>
                        )}
                        {item.accessStatus === "PRIVATE_OR_RESTRICTED" && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Workspace / Restricted Link
                          </span>
                        )}
                      </div>

                      {item.description && (
                        <p className="text-xs text-slate-600 whitespace-pre-line">
                          {item.description}
                        </p>
                      )}

                      <p className="text-[11px] text-slate-500">
                        Posted{" "}
                        {new Date(item.createdAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        {item.uploadedByTeacher
                          ? ` by ${item.uploadedByTeacher.fullName}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
                      <a
                        href={item.normalizedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                      >
                        <span>Open in Google Drive</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {isInstructor && !isArchived && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditMaterial(item)}
                            aria-label={`Edit ${item.title}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === item.id}
                            onClick={() => void handleDeleteMaterial(item)}
                            aria-label={`Delete ${item.title}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>
                              {deletingId === item.id ? "..." : "Delete"}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
