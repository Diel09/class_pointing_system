"use client";

import { Calendar, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toDateInputValue } from "@/lib/utils";

export interface EditableSubjectTarget {
  id: string;
  code: string;
  title: string;
  section: string;
  startDate: string | null;
  endDate: string | null;
}

interface EditSubjectModalProps {
  subject: EditableSubjectTarget;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
}

/**
 * Modal allowing the owning teacher to edit section details and schedule dates.
 */
export function EditSubjectModal({
  subject,
  open,
  onClose,
  onUpdated,
}: EditSubjectModalProps) {
  const [code, setCode] = useState(subject.code);
  const [section, setSection] = useState(subject.section);
  const [title, setTitle] = useState(subject.title);
  const [startDate, setStartDate] = useState(toDateInputValue(subject.startDate));
  const [endDate, setEndDate] = useState(toDateInputValue(subject.endDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode(subject.code);
      setSection(subject.section);
      setTitle(subject.title);
      setStartDate(toDateInputValue(subject.startDate));
      setEndDate(toDateInputValue(subject.endDate));
      setError(null);
    }
  }, [open, subject]);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (startDate && endDate && endDate < startDate) {
      setError("End date must be on or after start date.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          section,
          title,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to update section.");
        return;
      }
      await onUpdated();
      onClose();
    } catch {
      setError("Network error while updating section.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-subject-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" />
            <h3
              id="edit-subject-title"
              className="text-base font-bold text-slate-900"
            >
              Edit Section &amp; Schedule
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="edit-sub-code"
              className="block text-xs font-semibold text-slate-700"
            >
              Course Code
            </label>
            <input
              id="edit-sub-code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="edit-sub-section"
              className="block text-xs font-semibold text-slate-700"
            >
              Section
            </label>
            <input
              id="edit-sub-section"
              type="text"
              required
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label
              htmlFor="edit-sub-title"
              className="block text-xs font-semibold text-slate-700"
            >
              Subject Title
            </label>
            <input
              id="edit-sub-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="edit-sub-start"
              className="block text-xs font-semibold text-slate-700"
            >
              Start Date
            </label>
            <input
              id="edit-sub-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="edit-sub-end"
              className="block text-xs font-semibold text-slate-700"
            >
              End Date
            </label>
            <input
              id="edit-sub-end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
