"use client";

import { AlertTriangle, UserMinus } from "lucide-react";
import { useState } from "react";

export interface UnenrollStudentTarget {
  id: string;
  fullName: string;
  email: string;
  institutionalId: string | null;
  availableBalance: number;
  escrowedBalance: number;
}

interface UnenrollStudentModalProps {
  subjectId: string;
  subjectLabel: string;
  students: UnenrollStudentTarget[];
  onClose: () => void;
  onUnenrolled: () => void | Promise<void>;
}

/**
 * Confirmation modal for unenrolling one or more students from a specific class/subject,
 * clearing their subject-scoped points, attendance, scores, redemptions, and notifications.
 */
export function UnenrollStudentModal({
  subjectId,
  subjectLabel,
  students,
  onClose,
  onUnenrolled,
}: UnenrollStudentModalProps) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (students.length === 0) {
    return null;
  }

  const isSingle = students.length === 1;
  const single = students[0]!;
  const totalPoints = students.reduce(
    (sum, item) => sum + item.availableBalance + item.escrowedBalance,
    0
  );

  async function handleConfirmUnenroll() {
    if (students.length === 0) return;
    setError(null);
    setRemoving(true);
    try {
      const res = isSingle
        ? await fetch(`/api/subjects/${subjectId}/roster/${single.id}`, {
            method: "DELETE",
          })
        : await fetch(`/api/subjects/${subjectId}/roster/bulk-unenroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enrollmentIds: students.map((s) => s.id),
            }),
          });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to unenroll student(s).");
        return;
      }
      await onUnenrolled();
    } catch {
      setError("Network error while unenrolling student(s).");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unenroll-student-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <h3
              id="unenroll-student-title"
              className="text-base font-bold text-slate-900"
            >
              {isSingle
                ? "Unenroll Student from Class?"
                : `Unenroll ${students.length} Selected Students?`}
            </h3>
            <p className="text-[11px] font-medium text-slate-500">
              {subjectLabel}
            </p>
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
                    {item.availableBalance + item.escrowedBalance} pts
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
              <strong>{students.length}</strong>{" "}
              {students.length === 1 ? "student" : "students"} will be removed
              from this class roster.
            </li>
            <li>
              <strong>{totalPoints}</strong> class points (available + escrowed),
              attendance records, assessment scores, redemptions, and class
              notifications will be permanently deleted (their login account and
              other classes remain intact).
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
            disabled={removing}
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
            disabled={removing}
            onClick={handleConfirmUnenroll}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            <UserMinus className="h-3.5 w-3.5" />
            <span>
              {removing
                ? "Unenrolling..."
                : isSingle
                ? "Unenroll Student"
                : `Unenroll ${students.length} Students`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
