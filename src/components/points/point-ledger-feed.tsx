"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Coins,
  History,
  MinusCircle,
  PlusCircle,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LedgerFilterType } from "@/lib/validations/points";

export interface LedgerEntryDto {
  id: string;
  enrollmentId: string;
  entryType:
    | "ATTENDANCE"
    | "ATTENDANCE_ADJUSTMENT"
    | "MERIT"
    | "DEMERIT"
    | "P2P_SEND"
    | "P2P_RECEIVE"
    | "REDEMPTION_ESCROW"
    | "REDEMPTION_REFUND"
    | "REDEMPTION_FINALIZE";
  availableDelta: number;
  escrowDelta: number;
  availableAfter: number;
  escrowAfter: number;
  referenceType: string;
  referenceId: string;
  note: string | null;
  createdAt: string;
  actor: {
    id: string;
    fullName: string;
    role: string;
  } | null;
  enrollment?: {
    id: string;
    student: {
      id: string;
      fullName: string;
      institutionalId: string | null;
    };
  };
}

interface LedgerResponse {
  entries: LedgerEntryDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LedgerStudentOption {
  enrollmentId: string;
  fullName: string;
  institutionalId: string | null;
}

interface PointLedgerFeedProps {
  subjectId: string;
  mode: "student" | "teacher";
  students?: LedgerStudentOption[];
}

const FILTER_OPTIONS: { value: LedgerFilterType; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "MERIT", label: "Merits" },
  { value: "DEMERIT", label: "Demerits" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "P2P", label: "Transfers" },
  { value: "REDEMPTION", label: "Redemptions" },
];

function getEntryMeta(entryType: LedgerEntryDto["entryType"]) {
  switch (entryType) {
    case "MERIT":
      return {
        label: "Merit",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        Icon: PlusCircle,
      };
    case "DEMERIT":
      return {
        label: "Demerit",
        badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
        Icon: MinusCircle,
      };
    case "ATTENDANCE":
    case "ATTENDANCE_ADJUSTMENT":
      return {
        label:
          entryType === "ATTENDANCE" ? "Attendance" : "Attendance Override",
        badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
        Icon: CalendarCheck2,
      };
    case "P2P_RECEIVE":
      return {
        label: "Received",
        badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
        Icon: ArrowDownLeft,
      };
    case "P2P_SEND":
      return {
        label: "Sent",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
        Icon: ArrowUpRight,
      };
    case "REDEMPTION_ESCROW":
      return {
        label: "Escrowed",
        badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
        Icon: Coins,
      };
    case "REDEMPTION_REFUND":
      return {
        label: "Refunded",
        badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
        Icon: Coins,
      };
    case "REDEMPTION_FINALIZE":
      return {
        label: "Redeemed",
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        Icon: Coins,
      };
    default:
      return {
        label: "Redemption",
        badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
        Icon: Coins,
      };
  }
}

export function PointLedgerFeed({
  subjectId,
  mode,
  students = [],
}: PointLedgerFeedProps) {
  const [filter, setFilter] = useState<LedgerFilterType>("ALL");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery<LedgerResponse>({
    queryKey: [
      "subject-ledger",
      subjectId,
      mode,
      filter,
      selectedEnrollmentId,
      page,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        filter,
        page: String(page),
        limit: "10",
      });
      if (mode === "teacher" && selectedEnrollmentId) {
        params.set("enrollmentId", selectedEnrollmentId);
      }
      const res = await fetch(
        `/api/subjects/${subjectId}/ledger?${params.toString()}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) {
        throw new Error("Unable to load point ledger.");
      }
      return (await res.json()) as LedgerResponse;
    },
  });

  const entries = data?.entries ?? [];
  const pagination = data?.pagination ?? {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-600" />
          <h4 className="text-sm font-bold text-slate-900">
            {mode === "teacher"
              ? "Conduct & Point Ledger Log"
              : "Point Transaction Ledger"}
          </h4>
          {isFetching && !isLoading && (
            <span className="text-[11px] text-slate-400">Refreshing...</span>
          )}
        </div>

        {mode === "teacher" && students.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="ledger-student-filter"
              className="text-xs font-medium text-slate-600"
            >
              Student:
            </label>
            <select
              id="ledger-student-filter"
              value={selectedEnrollmentId}
              onChange={(e) => {
                setSelectedEnrollmentId(e.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All Students</option>
              {students.map((s) => (
                <option key={s.enrollmentId} value={s.enrollmentId}>
                  {s.fullName}
                  {s.institutionalId ? ` (${s.institutionalId})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter Pills */}
      <div
        className="flex items-center gap-1.5 flex-wrap"
        role="group"
        aria-label="Filter ledger by entry type"
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setFilter(opt.value);
                setPage(1);
              }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors border",
                active
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          Loading ledger entries...
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
          No point transactions match the selected filter yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {entries.map((entry) => {
            const meta = getEntryMeta(entry.entryType);
            const Icon = meta.Icon;
            const deltaText =
              entry.availableDelta > 0
                ? `+${entry.availableDelta} pts`
                : `${entry.availableDelta} pts`;

            return (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        meta.badgeClass
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      <span>{meta.label}</span>
                    </span>
                    {mode === "teacher" && entry.enrollment?.student && (
                      <span className="text-xs font-bold text-slate-900">
                        {entry.enrollment.student.fullName}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      {new Date(entry.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-800 break-words">
                    {entry.note ?? meta.label}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Recorded by {entry.actor?.fullName ?? "Deleted user"}
                  </p>
                </div>

                <div className="text-right shrink-0 space-y-0.5">
                  <p
                    className={cn(
                      "text-sm font-bold",
                      entry.availableDelta > 0
                        ? "text-emerald-600"
                        : entry.availableDelta < 0
                        ? "text-rose-600"
                        : "text-slate-600"
                    )}
                  >
                    {deltaText}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500">
                    Bal: {entry.availableAfter} pts
                  </p>
                  {entry.escrowDelta !== 0 && (
                    <p className="text-[10px] font-medium text-violet-600">
                      Escrow: {entry.escrowDelta > 0 ? `+${entry.escrowDelta}` : entry.escrowDelta} pts
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.total > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
          <span>
            Showing page {pagination.page} of {pagination.totalPages} (
            {pagination.total} entries)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Prev</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
              disabled={pagination.page >= pagination.totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
