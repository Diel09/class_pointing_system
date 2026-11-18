"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";

export interface DeleteSubjectTarget {
  id: string;
  code: string;
  title: string;
  section: string;
  enrollmentCount: number;
}

interface DeleteSubjectModalProps {
  subjects: DeleteSubjectTarget[];
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}

/**
 * Confirmation modal for permanently deleting one or more selected sections,
 * unenrolling all students, and clearing accumulated points, ledgers, notifications,
 * attendance, and grades.
 */
export function DeleteSubjectModal({
  subjects,
  onClose,
  onDeleted,
}: DeleteSubjectModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (subjects.length === 0) {
    return null;
  }

  const isSingle = subjects.length === 1;
  const single = subjects[0]!;
  const totalEnrollments = subjects.reduce(
    (sum, item) => sum + item.enrollmentCount,
    0
  );

  async function handleConfirmDelete() {
    if (subjects.length === 0) return;
    setError(null);
    setDeleting(true);
    try {
      const res = isSingle
        ? await fetch(`/api/subjects/${single.id}`, { method: "DELETE" })
        : await fetch("/api/subjects/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subjectIds: subjects.map((s) => s.id) }),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to delete section(s).");
        return;
      }
      await onDeleted();
    } catch {
      setError("Network error while deleting section(s).");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-subject-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3
              id="delete-subject-title"
              className="text-base font-bold text-slate-900"
            >
              {isSingle
                ? "Delete Section Permanently?"
                : `Delete ${subjects.length} Selected Sections?`}
            </h3>
            {isSingle ? (
              <p className="text-xs font-semibold text-slate-700">
                {single.code} • {single.section} — {single.title}
              </p>
            ) : (
              <div className="max-h-28 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 space-y-0.5">
                {subjects.map((item) => (
                  <p key={item.id} className="truncate">
                    <span className="font-semibold">
                      {item.code} • {item.section}
                    </span>{" "}
                    — {item.title} ({item.enrollmentCount})
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 space-y-1.5">
          <p className="font-semibold">This action cannot be undone:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <strong>{totalEnrollments}</strong> student{" "}
              {totalEnrollments === 1 ? "enrollment" : "enrollments"} will be
              unenrolled from {isSingle ? "this section" : "these sections"}.
            </li>
            <li>
              All accumulated student points, point ledgers, redemptions, linked
              notifications, attendance records, assessments, and grades will be
              permanently deleted (student login accounts remain intact).
            </li>
          </ul>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              setError(null);
              onClose();
            }}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleConfirmDelete}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>
              {deleting
                ? "Deleting..."
                : isSingle
                ? "Delete Section"
                : `Delete ${subjects.length} Sections`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
