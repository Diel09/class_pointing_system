"use client";

import { cn } from "@/lib/utils";

type BadgeStatus =
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "EXCUSED"
  | "OPEN"
  | "CLOSED"
  | "PENDING";

const BADGE_STYLES: Record<BadgeStatus, string> = {
  PRESENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  LATE: "bg-amber-50 text-amber-800 border-amber-200",
  ABSENT: "bg-rose-50 text-rose-700 border-rose-200",
  EXCUSED: "bg-sky-50 text-sky-700 border-sky-200",
  OPEN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-slate-100 text-slate-600 border-slate-200",
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
};

interface AttendanceStatusBadgeProps {
  status: BadgeStatus;
  className?: string;
}

export function AttendanceStatusBadge({
  status,
  className,
}: AttendanceStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        BADGE_STYLES[status],
        className
      )}
    >
      {status}
    </span>
  );
}
