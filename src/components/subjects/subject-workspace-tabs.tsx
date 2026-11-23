"use client";

import {
  CalendarCheck2,
  Coins,
  FolderOpen,
  GraduationCap,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type SubjectTabKey =
  | "grades"
  | "materials"
  | "attendance"
  | "points"
  | "roster";

export interface SubjectTabItem {
  key: SubjectTabKey;
  label: string;
  mobileLabel: string;
  icon: LucideIcon;
}

export const STUDENT_SUBJECT_TABS: readonly SubjectTabItem[] = [
  {
    key: "grades",
    label: "Assessments & Standing",
    mobileLabel: "Grades",
    icon: GraduationCap,
  },
  {
    key: "materials",
    label: "Learning Materials",
    mobileLabel: "Materials",
    icon: FolderOpen,
  },
  {
    key: "points",
    label: "Points & Rewards",
    mobileLabel: "Points",
    icon: Coins,
  },
  {
    key: "attendance",
    label: "Attendance",
    mobileLabel: "Attendance",
    icon: CalendarCheck2,
  },
];

export const CO_TEACHER_SUBJECT_TABS: readonly SubjectTabItem[] = [
  {
    key: "grades",
    label: "Standing & Gradebook",
    mobileLabel: "Gradebook",
    icon: GraduationCap,
  },
  {
    key: "materials",
    label: "Learning Materials",
    mobileLabel: "Materials",
    icon: FolderOpen,
  },
  {
    key: "attendance",
    label: "Attendance",
    mobileLabel: "Attendance",
    icon: CalendarCheck2,
  },
  {
    key: "points",
    label: "Points & Economy",
    mobileLabel: "Points",
    icon: Coins,
  },
];

export const TEACHER_SUBJECT_TABS: readonly SubjectTabItem[] = [
  ...CO_TEACHER_SUBJECT_TABS,
  {
    key: "roster",
    label: "Student Roster",
    mobileLabel: "Roster",
    icon: Users,
  },
];

export const ALL_SUBJECT_TAB_KEYS: readonly SubjectTabKey[] = [
  "grades",
  "materials",
  "attendance",
  "points",
  "roster",
];

/**
 * Resolves a raw tab query value to a valid tab key within the allowed list.
 */
export function resolveSubjectTab(
  rawTab: string | null | undefined,
  allowedKeys: readonly SubjectTabKey[]
): SubjectTabKey {
  if (rawTab && (allowedKeys as readonly string[]).includes(rawTab)) {
    return rawTab as SubjectTabKey;
  }
  return allowedKeys[0] ?? "grades";
}

/**
 * Returns the canonical Next.js route path for a subject workspace section.
 */
export function getSubjectTabHref(
  subjectId: string,
  tab: SubjectTabKey
): string {
  switch (tab) {
    case "materials":
      return `/subjects/${subjectId}/materials`;
    case "attendance":
      return `/subjects/${subjectId}/attendance`;
    case "points":
      return `/subjects/${subjectId}/points`;
    case "roster":
      return `/subjects/${subjectId}/roster`;
    case "grades":
    default:
      return `/subjects/${subjectId}`;
  }
}

interface SubjectWorkspaceTabsProps {
  subjectId: string;
  ariaLabel: string;
  tabs: readonly SubjectTabItem[];
  activeTab: SubjectTabKey;
}

/**
 * Responsive link-based workspace tab switcher: grid with concise labels & icons on mobile/tablet,
 * single-row pill bar with full labels on desktop.
 */
export function SubjectWorkspaceTabs({
  subjectId,
  ariaLabel,
  tabs,
  activeTab,
}: SubjectWorkspaceTabsProps) {
  const isThreeTabLayout = tabs.length === 3;
  const isFiveTabLayout = tabs.length >= 5;

  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "grid gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm lg:flex lg:items-center",
        isThreeTabLayout
          ? "grid-cols-3"
          : isFiveTabLayout
          ? "grid-cols-2 sm:grid-cols-5"
          : "grid-cols-2 sm:grid-cols-4"
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        const href = getSubjectTabHref(subjectId, tab.key);

        return (
          <Link
            key={tab.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            className={cn(
              "flex items-center justify-center rounded-xl font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:flex-1 lg:flex-row lg:gap-1.5 lg:px-3.5 lg:py-2 lg:text-xs",
              isThreeTabLayout
                ? "min-h-[48px] flex-col gap-1 px-2 py-2 text-[11px] sm:min-h-[40px] sm:flex-row sm:gap-1.5 sm:text-xs"
                : "min-h-[44px] flex-row gap-1.5 px-2.5 py-2 text-xs sm:min-h-[40px]",
              isActive
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="lg:hidden" aria-hidden="true">
              {tab.mobileLabel}
            </span>
            <span className="hidden lg:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
