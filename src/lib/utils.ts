import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names while resolving utility conflicts.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Extracts a YYYY-MM-DD string (UTC) suitable for HTML date inputs from an ISO timestamp.
 */
export function toDateInputValue(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Formats a subject's optional start and end dates into a concise UTC date-range label.
 */
export function formatSubjectDateRange(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined
): string | null {
  if (!startDate && !endDate) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const startLabel = startDate ? fmt.format(new Date(startDate)) : "No start";
  const endLabel = endDate ? fmt.format(new Date(endDate)) : "No end";
  return `${startLabel} – ${endLabel}`;
}
