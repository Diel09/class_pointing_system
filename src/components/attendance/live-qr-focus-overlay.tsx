"use client";

import {
  Lock,
  Maximize,
  Minimize,
  Minimize2,
  RefreshCw,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef } from "react";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { AttendanceStatusBadge } from "./status-badge";

interface LiveQrFocusOverlayProps {
  open: boolean;
  onClose: () => void;
  subject: {
    code: string;
    title: string;
    section: string;
  };
  sessionStatus: "OPEN" | "CLOSED";
  qr: {
    payload: string;
    rotationSeconds: number;
  } | null;
  countdownSec: number;
  checkedInCount: number;
  totalStudents: number;
  presentCount: number;
  lateCount: number;
  presentPoints: number;
  latePoints: number;
  pointsEnabled?: boolean;
  isOnline: boolean;
  isBrowserFullscreen: boolean;
  canToggleBrowserFullscreen: boolean;
  onToggleBrowserFullscreen: () => void;
}

/**
 * Full-viewport distraction-free QR code overlay for classroom projection and attendance check-in.
 */
export function LiveQrFocusOverlay({
  open,
  onClose,
  subject,
  sessionStatus,
  qr,
  countdownSec,
  checkedInCount,
  totalStudents,
  presentCount,
  lateCount,
  presentPoints,
  latePoints,
  pointsEnabled = true,
  isOnline,
  isBrowserFullscreen,
  canToggleBrowserFullscreen,
  onToggleBrowserFullscreen,
}: LiveQrFocusOverlayProps) {
  const exitButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    exitButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const progressPct =
    qr && qr.rotationSeconds > 0
      ? Math.max(0, Math.min(100, (countdownSec / qr.rotationSeconds) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full Screen Attendance QR Code"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950 text-white p-4 sm:p-6 md:p-8 overflow-y-auto"
    >
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <AttendanceStatusBadge status={sessionStatus} />
            <span className="rounded-lg bg-indigo-500/20 border border-indigo-400/30 px-2.5 py-0.5 text-xs font-semibold text-indigo-200">
              {subject.code} • {subject.section}
            </span>
          </div>
          <h2 className="text-sm sm:text-base font-bold text-white truncate">
            {subject.title} — Attendance QR
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-700/80 px-3 py-2 text-xs font-semibold text-slate-100"
          >
            <Users className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>
              Checked in: {checkedInCount} / {totalStudents}
            </span>
            <span className="hidden sm:inline text-slate-400 font-medium">
              ({presentCount} present • {lateCount} late)
            </span>
          </div>

          {canToggleBrowserFullscreen && sessionStatus === "OPEN" && (
            <button
              type="button"
              onClick={onToggleBrowserFullscreen}
              aria-label={
                isBrowserFullscreen
                  ? "Exit browser fullscreen"
                  : "Enter browser fullscreen"
              }
              title={
                isBrowserFullscreen
                  ? "Exit browser fullscreen"
                  : "Enter browser fullscreen"
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
            >
              {isBrowserFullscreen ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">
                {isBrowserFullscreen ? "Windowed" : "Browser Fullscreen"}
              </span>
            </button>
          )}

          <button
            ref={exitButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Exit Full Screen"
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span>Exit Full Screen</span>
          </button>
        </div>
      </header>

      {/* Center Stage */}
      <main className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6 gap-5">
        {!isOnline && (
          <div className="w-full max-w-lg text-slate-900">
            <OfflineBanner message="Internet connection required to rotate live attendance QR codes." />
          </div>
        )}

        {sessionStatus === "OPEN" && qr ? (
          <>
            <div className="rounded-3xl bg-white p-4 sm:p-6 md:p-8 shadow-2xl ring-1 ring-white/20">
              <div className="w-[min(74vw,52vh,460px)] aspect-square">
                <QRCodeSVG
                  value={qr.payload}
                  size={480}
                  level="M"
                  marginSize={1}
                  className="w-full h-full"
                  role="img"
                  aria-label="Full Screen Live Attendance QR Code"
                />
              </div>
            </div>

            <div className="w-full max-w-sm space-y-2.5 text-center">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-indigo-200">
                <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
                <span>
                  Rotates in {countdownSec}s{" "}
                  <span className="text-slate-400 font-normal">
                    (every {qr.rotationSeconds}s)
                  </span>
                </span>
              </div>

              <div
                aria-hidden="true"
                className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-indigo-400 transition-all duration-500 ease-linear"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <p className="text-xs sm:text-sm font-medium text-slate-200 pt-1">
                Students scan from{" "}
                <span className="font-semibold text-white">
                  Puento → Scan Attendance QR
                </span>
              </p>
              {pointsEnabled && (
                <p className="text-xs text-slate-400">
                  Present: +{presentPoints} pts • Late: +{latePoints} pts
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center space-y-4">
            <Lock className="h-10 w-10 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Session Closed</h3>
              <p className="text-xs text-slate-400">
                QR check-ins are closed. Exit full screen to review or override
                the attendance roster.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>Exit Full Screen</span>
            </button>
          </div>
        )}
      </main>

      {/* Subtle Footer Hint */}
      <footer className="hidden sm:flex items-center justify-center text-[11px] text-slate-500">
        <span>Press Esc to exit full screen • Individual student names are hidden</span>
      </footer>
    </div>
  );
}
