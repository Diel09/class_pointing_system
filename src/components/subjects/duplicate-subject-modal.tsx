"use client";

import { Calendar, Copy, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { formatSubjectDateRange } from "@/lib/utils";
import { isSameSectionName } from "@/lib/validations/subject";

export interface DuplicateSubjectTarget {
  id: string;
  code: string;
  title: string;
  section: string;
  termName?: string;
  startDate?: string | null;
  endDate?: string | null;
}

interface DuplicateSubjectModalProps {
  subject: DuplicateSubjectTarget | null;
  onClose: () => void;
  onDuplicated: (newSubjectId: string) => void | Promise<void>;
}

/**
 * Modal allowing the owning teacher to duplicate a subject along with all of its
 * configuration modifications while changing only the assigned section.
 */
export function DuplicateSubjectModal({
  subject,
  onClose,
  onDuplicated,
}: DuplicateSubjectModalProps) {
  const [section, setSection] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subject) {
      setSection("");
      setError(null);
    }
  }, [subject]);

  if (!subject) {
    return null;
  }

  const trimmedSection = section.trim();
  const isDuplicateSection =
    trimmedSection.length > 0 && isSameSectionName(trimmedSection, subject.section);
  const dateRange = formatSubjectDateRange(subject.startDate, subject.endDate);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject) return;
    setError(null);

    if (!trimmedSection) {
      setError("New section name is required.");
      return;
    }

    if (isSameSectionName(trimmedSection, subject.section)) {
      setError("New section must be different from the original section.");
      return;
    }

    setDuplicating(true);
    try {
      const res = await fetch(`/api/subjects/${subject.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: trimmedSection }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        subject?: { id: string };
      };
      if (!res.ok || !data.subject?.id) {
        setError(data.error ?? "Failed to duplicate section.");
        return;
      }
      await onDuplicated(data.subject.id);
    } catch {
      setError("Network error while duplicating section.");
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-subject-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-indigo-600" />
            <h3
              id="duplicate-subject-title"
              className="text-base font-bold text-slate-900"
            >
              Duplicate Section
            </h3>
          </div>
          <button
            type="button"
            disabled={duplicating}
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
              {subject.code} • {subject.section}
            </span>
            {subject.termName && (
              <span className="text-[11px] text-slate-500">
                {subject.termName}
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-slate-900">{subject.title}</p>
          {dateRange && (
            <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Calendar className="h-3 w-3 text-slate-400" />
              <span>Schedule: {dateRange}</span>
            </p>
          )}
        </div>

        <div className="rounded-xl bg-indigo-50/70 border border-indigo-200 p-3 text-xs text-indigo-950 space-y-1">
          <p className="font-semibold">What will be copied:</p>
          <p className="text-indigo-900/90">
            Course details, schedule dates, grading computation &amp; categories,
            grade scale rules, merit/demerit presets, reward items, and economy
            guardrails.
          </p>
          <p className="text-[11px] text-indigo-800/80 pt-0.5">
            Starts fresh with a new invite code and zero enrollments,
            assessments, attendance, or point records.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="dup-sub-section"
              className="block text-xs font-semibold text-slate-700"
            >
              New Section
            </label>
            <input
              id="dup-sub-section"
              type="text"
              required
              autoFocus
              maxLength={40}
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder={`Enter a section other than ${subject.section}`}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {isDuplicateSection && (
              <p className="text-[11px] text-rose-600">
                New section must differ from &ldquo;{subject.section}&rdquo;.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={duplicating}
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                duplicating || trimmedSection.length === 0 || isDuplicateSection
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{duplicating ? "Duplicating..." : "Duplicate Section"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
