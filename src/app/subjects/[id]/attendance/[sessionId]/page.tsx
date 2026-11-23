"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LocateFixed,
  Lock,
  MapPin,
  Maximize2,
  QrCode,
  RefreshCw,
  Search,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LiveQrFocusOverlay } from "@/components/attendance/live-qr-focus-overlay";
import { AttendanceStatusBadge } from "@/components/attendance/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  captureCurrentPosition,
  GeoCaptureError,
} from "@/lib/attendance/client-geo";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

interface LiveSessionResponse {
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
    pointsEnabled?: boolean;
  };
  session: {
    id: string;
    status: "OPEN" | "CLOSED";
    radiusMeters: number;
    qrRotationSeconds: number;
    startedAt: string;
    presentCutoffAt: string;
    lateCutoffAt: string;
    closedAt: string | null;
    presentPoints: number;
    latePoints: number;
    teacherLat: number;
    teacherLng: number;
    teacherAccuracyM: number;
  };
  qr: {
    payload: string;
    bucket: number;
    rotationSeconds: number;
    nextRotationAt: string;
    remainingMs: number;
  } | null;
  roster: {
    enrollmentId: string;
    availableBalance: number;
    student: {
      id: string;
      fullName: string;
      email: string;
      institutionalId: string | null;
    };
    record: {
      id: string;
      status: AttendanceStatus;
      checkInMethod: "QR_SCAN" | "TEACHER_OVERRIDE" | "SYSTEM_CLOSE";
      distanceMeters: number | null;
      studentAccuracyM: number | null;
      pointsAwarded: number;
      overrideReason: string | null;
      recordedAt: string;
    } | null;
  }[];
  anomalies: {
    id: string;
    actorUserId: string | null;
    afterState: {
      attemptedStudentName?: string;
      distanceMeters?: number;
    } | null;
    createdAt: string;
  }[];
  serverTime: string;
}

export default function TeacherLiveAttendancePage() {
  const params = useParams<{ id: string; sessionId: string }>();
  const subjectId = params.id;
  const sessionId = params.sessionId;
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [countdownSec, setCountdownSec] = useState<number>(0);

  const [refreshingGps, setRefreshingGps] = useState(false);
  const [gpsFeedback, setGpsFeedback] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  const [overrideTarget, setOverrideTarget] = useState<{
    enrollmentId: string;
    studentName: string;
    currentStatus: AttendanceStatus | "PENDING";
  } | null>(null);
  const [overrideStatus, setOverrideStatus] =
    useState<AttendanceStatus>("PRESENT");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);

  const [isQrFocused, setIsQrFocused] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [canToggleBrowserFullscreen, setCanToggleBrowserFullscreen] =
    useState(false);
  const enteredBrowserFullscreenRef = useRef(false);
  const appliedFocusParamRef = useRef(false);
  const fullScreenTriggerRef = useRef<HTMLButtonElement | null>(null);

  const { data, isLoading, error } = useQuery<LiveSessionResponse>({
    queryKey: ["session-live", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/live`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Unable to load attendance session.");
      }
      return (await res.json()) as LiveSessionResponse;
    },
    refetchInterval: (query) =>
      query.state.data?.session.status === "OPEN" ? 3000 : false,
    enabled: Boolean(sessionId),
  });

  useEffect(() => {
    if (!data?.qr?.nextRotationAt || data.session.status !== "OPEN") {
      setCountdownSec(0);
      return;
    }

    const updateTimer = () => {
      const diffMs =
        new Date(data.qr!.nextRotationAt).getTime() - Date.now();
      setCountdownSec(Math.max(0, Math.ceil(diffMs / 1000)));
    };
    updateTimer();
    const timerId = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(timerId);
  }, [data?.qr, data?.session.status]);

  useEffect(() => {
    setCanToggleBrowserFullscreen(Boolean(document.fullscreenEnabled));

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsBrowserFullscreen(active);
      if (!active && enteredBrowserFullscreenRef.current) {
        enteredBrowserFullscreenRef.current = false;
        setIsQrFocused(false);
        fullScreenTriggerRef.current?.focus();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (enteredBrowserFullscreenRef.current && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (appliedFocusParamRef.current) return;
    if (data?.session.status !== "OPEN" || !data.qr) return;

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("focus") === "qr") {
      appliedFocusParamRef.current = true;
      setIsQrFocused(true);
    }
  }, [data?.session.status, data?.qr]);

  function handleEnterQrFocus() {
    setIsQrFocused(true);
    const rootEl = document.documentElement;
    if (rootEl.requestFullscreen && !document.fullscreenElement) {
      rootEl
        .requestFullscreen()
        .then(() => {
          enteredBrowserFullscreenRef.current = true;
        })
        .catch(() => {
          // Native fullscreen can be blocked or unsupported (e.g., iOS Safari); overlay remains active.
        });
    }
  }

  const handleExitQrFocus = useCallback(() => {
    enteredBrowserFullscreenRef.current = false;
    setIsQrFocused(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    window.requestAnimationFrame(() => {
      fullScreenTriggerRef.current?.focus();
    });
  }, []);

  function handleToggleBrowserFullscreen() {
    if (document.fullscreenElement) {
      enteredBrowserFullscreenRef.current = false;
      document.exitFullscreen?.().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement
        .requestFullscreen()
        .then(() => {
          enteredBrowserFullscreenRef.current = true;
        })
        .catch(() => {});
    }
  }

  async function handleRefreshAnchor() {
    setGpsError(null);
    setGpsFeedback(null);
    setRefreshingGps(true);

    try {
      const pos = await captureCurrentPosition();
      const res = await fetch(`/api/sessions/${sessionId}/location`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherLat: pos.lat,
          teacherLng: pos.lng,
          teacherAccuracyM: pos.accuracy,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setGpsError(payload.error ?? "Failed to update GPS anchor.");
        return;
      }

      setGpsFeedback(
        `GPS anchor updated (±${Math.round(pos.accuracy)}m accuracy).`
      );
      await queryClient.invalidateQueries({
        queryKey: ["session-live", sessionId],
      });
    } catch (err) {
      setGpsError(
        err instanceof GeoCaptureError
          ? err.message
          : "Unable to capture GPS position."
      );
    } finally {
      setRefreshingGps(false);
    }
  }

  async function handleCloseSession() {
    setClosing(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/close`, {
        method: "POST",
      });
      if (res.ok) {
        setConfirmClose(false);
        await queryClient.invalidateQueries({
          queryKey: ["session-live", sessionId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["subject-sessions", subjectId],
        });
      }
    } finally {
      setClosing(false);
    }
  }

  function openOverrideModal(item: LiveSessionResponse["roster"][number]) {
    const current = item.record?.status ?? "PENDING";
    setOverrideTarget({
      enrollmentId: item.enrollmentId,
      studentName: item.student.fullName,
      currentStatus: current,
    });
    setOverrideStatus(
      item.record?.status ?? "PRESENT"
    );
    setOverrideReason("");
    setOverrideError(null);
  }

  async function handleSubmitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overrideTarget) return;

    setOverrideError(null);
    setSavingOverride(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: overrideTarget.enrollmentId,
          status: overrideStatus,
          reason: overrideReason,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setOverrideError(payload.error ?? "Failed to save override.");
        return;
      }

      setOverrideTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ["session-live", sessionId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["subject-sessions", subjectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["subject-roster", subjectId],
      });
    } catch {
      setOverrideError("Network error while saving manual override.");
    } finally {
      setSavingOverride(false);
    }
  }

  const roster = data?.roster ?? [];
  const counts = {
    PRESENT: roster.filter((r) => r.record?.status === "PRESENT").length,
    LATE: roster.filter((r) => r.record?.status === "LATE").length,
    EXCUSED: roster.filter((r) => r.record?.status === "EXCUSED").length,
    ABSENT: roster.filter((r) => r.record?.status === "ABSENT").length,
    PENDING: roster.filter((r) => !r.record).length,
  };

  const filteredRoster = roster.filter((item) => {
    const effectiveStatus = item.record?.status ?? "PENDING";
    if (statusFilter !== "ALL" && effectiveStatus !== statusFilter) {
      return false;
    }
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      item.student.fullName.toLowerCase().includes(q) ||
      item.student.email.toLowerCase().includes(q) ||
      (item.student.institutionalId?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <Link
          href={`/subjects/${subjectId}/attendance`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Attendance</span>
        </Link>

        {!isOnline && (
          <OfflineBanner message="Internet connection required to rotate live attendance QR codes and record overrides." />
        )}

        {isLoading ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            Loading attendance session...
          </div>
        ) : error || !data ? (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
            {error instanceof Error
              ? error.message
              : "Attendance session not found."}
          </div>
        ) : (
          <>
            {/* Session Header */}
            <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <AttendanceStatusBadge status={data.session.status} />
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-lg">
                    {data.subject.code} • {data.subject.section}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900">
                  {data.subject.title} — Attendance Session
                </h2>
                <p className="text-xs text-slate-500">
                  Started{" "}
                  {new Date(data.session.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  • Present
                  {data.subject.pointsEnabled !== false
                    ? ` (+${data.session.presentPoints} pts)`
                    : ""}{" "}
                  until{" "}
                  {new Date(data.session.presentCutoffAt).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" }
                  )}{" "}
                  • Late
                  {data.subject.pointsEnabled !== false
                    ? ` (+${data.session.latePoints} pts)`
                    : ""}{" "}
                  until{" "}
                  {new Date(data.session.lateCutoffAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              {data.session.status === "OPEN" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleRefreshAnchor}
                    disabled={refreshingGps}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <LocateFixed className="h-3.5 w-3.5 text-indigo-600" />
                    <span>
                      {refreshingGps ? "Refreshing GPS..." : "Refresh GPS Anchor"}
                    </span>
                  </button>

                  {!confirmClose ? (
                    <button
                      type="button"
                      onClick={() => setConfirmClose(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>Close Session</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-1.5">
                      <span className="text-[11px] font-semibold text-rose-800">
                        Mark {counts.PENDING} unchecked as ABSENT?
                      </span>
                      <button
                        type="button"
                        onClick={handleCloseSession}
                        disabled={closing}
                        className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                      >
                        {closing ? "Closing..." : "Confirm Close"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClose(false)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {gpsFeedback && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{gpsFeedback}</span>
              </div>
            )}

            {gpsError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-700"
              >
                {gpsError}
              </div>
            )}

            {data.anomalies.length > 0 && (
              <section className="rounded-2xl bg-amber-50 border border-amber-300 p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Anti-Proxy Device Alerts ({data.anomalies.length})
                  </h3>
                </div>
                <ul className="space-y-1 text-xs text-amber-900">
                  {data.anomalies.map((anomaly) => (
                    <li key={anomaly.id}>
                      Blocked duplicate-device check-in attempt by{" "}
                      <span className="font-semibold">
                        {anomaly.afterState?.attemptedStudentName ?? "a student"}
                      </span>{" "}
                      at{" "}
                      {new Date(anomaly.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      .
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-6 lg:grid-cols-5">
              {/* Rotating QR Display */}
              <section className="lg:col-span-2 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Live Rotating QR
                    </h3>
                  </div>
                  {data.session.status === "OPEN" && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>{countdownSec}s</span>
                      </span>
                      {data.qr && (
                        <button
                          ref={fullScreenTriggerRef}
                          type="button"
                          onClick={handleEnterQrFocus}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Maximize2 className="h-3.5 w-3.5 text-indigo-600" />
                          <span>Full Screen QR</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {data.session.status === "OPEN" && data.qr ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-5">
                    <div className="rounded-2xl bg-white p-4 border border-slate-200 shadow-sm">
                      <QRCodeSVG
                        value={data.qr.payload}
                        size={228}
                        level="M"
                        role="img"
                        aria-label="Live Attendance QR Code"
                      />
                    </div>
                    <p className="text-xs font-medium text-slate-700 text-center">
                      Students scan from{" "}
                      <span className="font-semibold">
                        Puento → Scan Attendance QR
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500 text-center">
                      Rotates every {data.qr.rotationSeconds}s to prevent
                      screenshot sharing.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-6 text-center space-y-2">
                    <Lock className="h-7 w-7 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-800">
                      Session Closed
                    </p>
                    <p className="text-xs text-slate-500">
                      QR check-ins are closed. You can still apply manual
                      overrides on the roster.
                    </p>
                  </div>
                )}

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Geofence Anchor</span>
                  </div>
                  <p>
                    Radius: <span className="font-semibold">{data.session.radiusMeters}m</span>{" "}
                    (+ up to 25m student GPS tolerance)
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {data.session.teacherLat.toFixed(5)},{" "}
                    {data.session.teacherLng.toFixed(5)} (±
                    {Math.round(data.session.teacherAccuracyM)}m)
                  </p>
                </div>
              </section>

              {/* Live Attendance Roster & Manual Override */}
              <section className="lg:col-span-3 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">
                    Live Attendance Roster ({roster.length})
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-semibold">
                    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 border border-emerald-200">
                      Present: {counts.PRESENT}
                    </span>
                    <span className="rounded-full bg-amber-50 text-amber-800 px-2.5 py-0.5 border border-amber-200">
                      Late: {counts.LATE}
                    </span>
                    <span className="rounded-full bg-sky-50 text-sky-700 px-2.5 py-0.5 border border-sky-200">
                      Excused: {counts.EXCUSED}
                    </span>
                    <span className="rounded-full bg-slate-100 text-slate-700 px-2.5 py-0.5 border border-slate-200">
                      {data.session.status === "OPEN"
                        ? `Pending: ${counts.PENDING}`
                        : `Absent: ${counts.ABSENT}`}
                    </span>
                  </div>
                </div>

                {/* Search & Filter */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search name or ID..."
                      className="w-full rounded-xl border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <select
                    aria-label="Filter by status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PENDING">Not Checked In</option>
                    <option value="PRESENT">Present</option>
                    <option value="LATE">Late</option>
                    <option value="EXCUSED">Excused</option>
                    <option value="ABSENT">Absent</option>
                  </select>
                </div>

                {/* Override Inline Drawer */}
                {overrideTarget && (
                  <form
                    onSubmit={handleSubmitOverride}
                    className="rounded-xl bg-indigo-50 border border-indigo-200 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-indigo-950">
                        Manual Override: {overrideTarget.studentName}
                      </p>
                      <span className="text-[11px] text-indigo-700">
                        Current: {overrideTarget.currentStatus}
                      </span>
                    </div>

                    {overrideError && (
                      <p className="text-xs text-rose-700">{overrideError}</p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <label
                          htmlFor="override-status"
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          New Status
                        </label>
                        <select
                          id="override-status"
                          value={overrideStatus}
                          onChange={(e) =>
                            setOverrideStatus(e.target.value as AttendanceStatus)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="PRESENT">
                            PRESENT
                            {data.subject.pointsEnabled !== false
                              ? ` (+${data.session.presentPoints} pts)`
                              : ""}
                          </option>
                          <option value="LATE">
                            LATE
                            {data.subject.pointsEnabled !== false
                              ? ` (+${data.session.latePoints} pts)`
                              : ""}
                          </option>
                          <option value="EXCUSED">
                            EXCUSED
                            {data.subject.pointsEnabled !== false
                              ? " (0 pts)"
                              : ""}
                          </option>
                          <option value="ABSENT">
                            ABSENT
                            {data.subject.pointsEnabled !== false
                              ? " (0 pts)"
                              : ""}
                          </option>
                        </select>
                      </div>
                      <div className="sm:col-span-2 space-y-1">
                        <label
                          htmlFor="override-reason"
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          Reason (logged to audit trail)
                        </label>
                        <input
                          id="override-reason"
                          type="text"
                          required
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="e.g., Indoor GPS drift, dead phone battery, excused medical"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOverrideTarget(null)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingOverride}
                        className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {savingOverride ? "Saving..." : "Apply Override"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Roster List */}
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {filteredRoster.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 text-center">
                      No students match the current filter.
                    </p>
                  ) : (
                    filteredRoster.map((item) => {
                      const rec = item.record;
                      return (
                        <div
                          key={item.enrollmentId}
                          className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900">
                                {item.student.fullName}
                              </p>
                              <AttendanceStatusBadge
                                status={rec?.status ?? "PENDING"}
                              />
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {item.student.institutionalId
                                ? `${item.student.institutionalId} • `
                                : ""}
                              {rec
                                ? `${
                                    rec.checkInMethod === "QR_SCAN"
                                      ? "QR Scan"
                                      : rec.checkInMethod === "TEACHER_OVERRIDE"
                                      ? "Override"
                                      : "Auto-Absent"
                                  }${
                                    rec.distanceMeters != null
                                      ? ` • ${Math.round(rec.distanceMeters)}m`
                                      : ""
                                  }${
                                    data.subject.pointsEnabled !== false
                                      ? ` • +${rec.pointsAwarded} pts`
                                      : ""
                                  }`
                                : "Awaiting check-in"}
                              {data.subject.pointsEnabled !== false
                                ? ` • Wallet: ${item.availableBalance} pts`
                                : ""}
                            </p>
                            {rec?.overrideReason && (
                              <p className="text-[11px] text-indigo-700">
                                Note: {rec.overrideReason}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => openOverrideModal(item)}
                            aria-label={`Override ${item.student.fullName}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
                          >
                            <UserCog className="h-3.5 w-3.5" />
                            <span>Override</span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
            <LiveQrFocusOverlay
              open={isQrFocused}
              onClose={handleExitQrFocus}
              subject={data.subject}
              sessionStatus={data.session.status}
              qr={data.qr}
              countdownSec={countdownSec}
              checkedInCount={counts.PRESENT + counts.LATE}
              totalStudents={roster.length}
              presentCount={counts.PRESENT}
              lateCount={counts.LATE}
              presentPoints={data.session.presentPoints}
              latePoints={data.session.latePoints}
              pointsEnabled={data.subject.pointsEnabled !== false}
              isOnline={isOnline}
              isBrowserFullscreen={isBrowserFullscreen}
              canToggleBrowserFullscreen={canToggleBrowserFullscreen}
              onToggleBrowserFullscreen={handleToggleBrowserFullscreen}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
