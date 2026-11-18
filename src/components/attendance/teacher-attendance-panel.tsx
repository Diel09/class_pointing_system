"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  LocateFixed,
  MapPin,
  QrCode,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  captureCurrentPosition,
  GeoCaptureError,
  type GeoPositionReading,
} from "@/lib/attendance/client-geo";
import { AttendanceStatusBadge } from "./status-badge";

interface SessionSummary {
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
  counts?: {
    PRESENT: number;
    LATE: number;
    EXCUSED: number;
    ABSENT: number;
  };
}

interface TeacherAttendancePanelProps {
  subjectId: string;
  isArchived: boolean;
}

export function TeacherAttendancePanel({
  subjectId,
  isArchived,
}: TeacherAttendancePanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [geo, setGeo] = useState<GeoPositionReading | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [radiusMeters, setRadiusMeters] = useState(50);
  const [presentWindowMinutes, setPresentWindowMinutes] = useState(15);
  const [lateWindowMinutes, setLateWindowMinutes] = useState(30);
  const [presentPoints, setPresentPoints] = useState(10);
  const [latePoints, setLatePoints] = useState(5);
  const [qrRotationSeconds, setQrRotationSeconds] = useState(12);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    sessions: SessionSummary[];
    openSessionId: string | null;
  }>({
    queryKey: ["subject-sessions", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/sessions`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Unable to load attendance sessions.");
      }
      return (await res.json()) as {
        sessions: SessionSummary[];
        openSessionId: string | null;
      };
    },
  });

  async function handleCaptureGps() {
    setGeoError(null);
    setGeoLoading(true);
    try {
      const pos = await captureCurrentPosition();
      setGeo(pos);
    } catch (err) {
      setGeoError(
        err instanceof GeoCaptureError
          ? err.message
          : "Failed to capture GPS coordinates."
      );
    } finally {
      setGeoLoading(false);
    }
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    let activeGeo = geo;
    if (!activeGeo) {
      setGeoError(null);
      setGeoLoading(true);
      try {
        activeGeo = await captureCurrentPosition();
        setGeo(activeGeo);
      } catch (err) {
        setGeoError(
          err instanceof GeoCaptureError
            ? err.message
            : "Location capture is required to start an attendance session."
        );
        setGeoLoading(false);
        return;
      } finally {
        setGeoLoading(false);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/subjects/${subjectId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherLat: activeGeo.lat,
          teacherLng: activeGeo.lng,
          teacherAccuracyM: activeGeo.accuracy,
          radiusMeters,
          presentWindowMinutes,
          lateWindowMinutes,
          presentPoints,
          latePoints,
          qrRotationSeconds,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        session?: { id: string };
      };
      if (!res.ok || !payload.session) {
        setSubmitError(payload.error ?? "Unable to start attendance session.");
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["subject-sessions", subjectId],
      });
      router.push(`/subjects/${subjectId}/attendance/${payload.session.id}`);
    } catch {
      setSubmitError("Network error while starting attendance session.");
    } finally {
      setSubmitting(false);
    }
  }

  const sessions = data?.sessions ?? [];
  const openSession = sessions.find((s) => s.status === "OPEN") ?? null;

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">
            Attendance Monitoring (QR + GPS)
          </h3>
        </div>
        {openSession && (
          <Link
            href={`/subjects/${subjectId}/attendance/${openSession.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            <span>Open Live QR &amp; Roster</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {openSession ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AttendanceStatusBadge status="OPEN" />
              <span className="text-xs font-semibold text-emerald-900">
                Live Attendance Session In Progress
              </span>
            </div>
            <p className="text-xs text-emerald-800">
              Radius: {openSession.radiusMeters}m • Present:{" "}
              {openSession.presentPoints} pts • Late: {openSession.latePoints}{" "}
              pts • Present cutoff:{" "}
              {new Date(openSession.presentCutoffAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <Link
            href={`/subjects/${subjectId}/attendance/${openSession.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            <span>Manage Live Session</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : isArchived ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          This subject is archived. Unarchive it to start new attendance sessions.
        </div>
      ) : (
        <form
          onSubmit={handleStartSession}
          className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-4"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-slate-900">
                Start New Attendance Session
              </p>
              <p className="text-[11px] text-slate-500">
                Captures your current device GPS only as the classroom geofence
                anchor.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCaptureGps}
              disabled={geoLoading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              <LocateFixed className="h-3.5 w-3.5 text-indigo-600" />
              <span>
                {geoLoading
                  ? "Capturing GPS..."
                  : geo
                  ? "Refresh GPS Anchor"
                  : "Capture GPS Anchor"}
              </span>
            </button>
          </div>

          {geo && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2 flex-wrap">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>
                Anchor ready: {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} (±
                {Math.round(geo.accuracy)}m)
              </span>
            </div>
          )}

          {geoError && (
            <div
              role="alert"
              className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
            >
              {geoError}
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
            >
              {submitError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label
                htmlFor="att-radius"
                className="block text-[11px] font-semibold text-slate-700"
              >
                Geofence Radius (m)
              </label>
              <input
                id="att-radius"
                type="number"
                min={15}
                max={500}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="att-present-window"
                className="block text-[11px] font-semibold text-slate-700"
              >
                Present Window (min)
              </label>
              <input
                id="att-present-window"
                type="number"
                min={1}
                max={180}
                value={presentWindowMinutes}
                onChange={(e) =>
                  setPresentWindowMinutes(Number(e.target.value))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="att-late-window"
                className="block text-[11px] font-semibold text-slate-700"
              >
                Late Window (min)
              </label>
              <input
                id="att-late-window"
                type="number"
                min={0}
                max={240}
                value={lateWindowMinutes}
                onChange={(e) => setLateWindowMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="att-present-pts"
                className="block text-[11px] font-semibold text-slate-700"
              >
                Present Points
              </label>
              <input
                id="att-present-pts"
                type="number"
                min={0}
                max={1000}
                value={presentPoints}
                onChange={(e) => setPresentPoints(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="att-late-pts"
                className="block text-[11px] font-semibold text-slate-700"
              >
                Late Points
              </label>
              <input
                id="att-late-pts"
                type="number"
                min={0}
                max={1000}
                value={latePoints}
                onChange={(e) => setLatePoints(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="att-qr-rot"
                className="block text-[11px] font-semibold text-slate-700"
              >
                QR Rotation (sec)
              </label>
              <input
                id="att-qr-rot"
                type="number"
                min={10}
                max={15}
                value={qrRotationSeconds}
                onChange={(e) => setQrRotationSeconds(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || geoLoading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              <QrCode className="h-3.5 w-3.5" />
              <span>
                {submitting
                  ? "Starting Session..."
                  : geo
                  ? "Start Attendance Session"
                  : "Capture GPS & Start Session"}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Session History */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Recent Sessions
        </h4>
        {isLoading ? (
          <p className="text-xs text-slate-500">Loading attendance history...</p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-slate-500">
            No attendance sessions recorded yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/subjects/${subjectId}/attendance/${session.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AttendanceStatusBadge status={session.status} />
                    <span className="text-xs font-semibold text-slate-900">
                      {new Date(session.startedAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      •{" "}
                      {new Date(session.startedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>
                      Radius {session.radiusMeters}m • P: {session.counts?.PRESENT ?? 0}, L:{" "}
                      {session.counts?.LATE ?? 0}, E: {session.counts?.EXCUSED ?? 0}, A:{" "}
                      {session.counts?.ABSENT ?? 0}
                    </span>
                  </p>
                </div>
                <span className="text-xs font-semibold text-indigo-600 shrink-0">
                  View →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
