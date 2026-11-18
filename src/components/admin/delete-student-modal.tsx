"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";

export interface DeleteStudentTarget {
  id: string;
  fullName: string;
  email: string;
  institutionalId: string | null;
  enrollmentCount: number;
}

interface DeleteStudentModalProps {
  students: DeleteStudentTarget[];
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}

/**
 * Confirmation modal for permanently deleting one or more student accounts,
 * removing their class enrollments, points, attendance, scores, and notifications.
 */
export function DeleteStudentModal({
  students,
  onClose,
  onDeleted,
}: DeleteStudentModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (students.length === 0) {
    return null;
  }

  const isSingle = students.length === 1;
  const single = students[0]!;
  const totalEnrollments = students.reduce(
    (sum, item) => sum + item.enrollmentCount,
    0
  );

  async function handleConfirmDelete() {
    if (students.length === 0) return;
    setError(null);
    setDeleting(true);
    try {
      const res = isSingle
        ? await fetch(`/api/admin/students/${single.id}`, {
            method: "DELETE",
          })
        : await fetch("/api/admin/students/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentIds: students.map((s) => s.id) }),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to delete student account(s).");
        return;
      }
      await onDeleted();
    } catch {
      setError("Network error while deleting student account(s).");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-student-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3
              id="delete-student-title"
              className="text-base font-bold text-slate-900"
            >
              {isSingle
                ? "Delete Student Account Permanently?"
                : `Delete ${students.length} Selected Students?`}
            </h3>
            {isSingle ? (
              <p className="text-xs font-semibold text-slate-700">
                {single.fullName}
                {single.institutionalId ? ` (${single.institutionalId})` : ""} —{" "}
                {single.email}
              </p>
            ) : (
              <div className="max-h-28 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 space-y-0.5">
                {students.map((item) => (
                  <p key={item.id} className="truncate">
                    <span className="font-semibold">{item.fullName}</span>{" "}
                    {item.institutionalId ? `(${item.institutionalId}) ` : ""}—{" "}
                    {item.email} ({item.enrollmentCount})
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
              <strong>{students.length}</strong> student login{" "}
              {students.length === 1 ? "account" : "accounts"} and{" "}
              <strong>{totalEnrollments}</strong> class{" "}
              {totalEnrollments === 1 ? "enrollment" : "enrollments"} will be
              permanently deleted.
            </li>
            <li>
              All of their point balances, personal point ledgers, attendance
              records, redemptions, assessment scores, and notifications will be
              removed (peer P2P transfer history on other students&apos; ledgers
              is preserved).
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
                ? "Delete Student"
                : `Delete ${students.length} Students`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
