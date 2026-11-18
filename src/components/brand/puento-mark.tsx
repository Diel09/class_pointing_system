import { cn } from "@/lib/utils";

interface PuentoMarkProps {
  className?: string;
}

/**
 * Geometric open-bowl "P" monogram with a centered gold point dot on an indigo backdrop.
 */
export function PuentoMark({ className }: PuentoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0", className)}
    >
      <defs>
        <linearGradient id="puento-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#puento-bg)" />
      {/* Vertical stem */}
      <path
        d="M20 15V49"
        stroke="#ffffff"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      {/* Open-bowl upper loop */}
      <path
        d="M20 16H33C40.732 16 46 20.9 46 27.5C46 34.1 40.732 39 33 39H28.5"
        stroke="#ffffff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Centered gold point dot */}
      <circle cx="32.5" cy="27.5" r="4.75" fill="#fbbf24" />
    </svg>
  );
}
