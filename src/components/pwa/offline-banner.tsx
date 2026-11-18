"use client";

import { WifiOff } from "lucide-react";

interface OfflineBannerProps {
  message: string;
}

/**
 * Consistent offline warning banner for network-only classroom and economy actions.
 */
export function OfflineBanner({ message }: OfflineBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl bg-amber-50 border border-amber-300 p-3.5 text-xs text-amber-900 flex items-start gap-2.5"
    >
      <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-bold">You are offline</p>
        <p>{message}</p>
      </div>
    </div>
  );
}
