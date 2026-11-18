"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  LocateFixed,
  MapPin,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttendanceStatusBadge } from "@/components/attendance/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  captureCurrentPosition,
  GeoCaptureError,
  type GeoPositionReading,
} from "@/lib/attendance/client-geo";
import {
  getIndexedDbDeviceToken,
  setIndexedDbDeviceToken,
} from "@/lib/device/indexeddb";

interface CheckInSuccess {
  record: {
    id: string;
    status: "PRESENT" | "LATE";
    distanceMeters: number;
    pointsAwarded: number;
  };
  availableBalance: number;
  pointsAwarded: number;
  mirrorToken?: string;
}

export default function StudentCheckInPage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [geo, setGeo] = useState<GeoPositionReading | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const geoRef = useRef<GeoPositionReading | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [success, setSuccess] = useState<CheckInSuccess | null>(null);

  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);

  const refreshGeo = useCallback(async (): Promise<GeoPositionReading | null> => {
    setGeoError(null);
    setGeoLoading(true);
    try {
      const reading = await captureCurrentPosition();
      setGeo(reading);
      geoRef.current = reading;
      if (reading.accuracy > 100) {
        setGeoError(
          `GPS accuracy is currently ±${Math.round(
            reading.accuracy
          )}m (exceeds 100m limit). Move near a window and retry GPS.`
        );
      }
      return reading;
    } catch (err) {
      setGeoError(
        err instanceof GeoCaptureError
          ? err.message
          : "Unable to read device GPS."
      );
      return null;
    } finally {
      setGeoLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGeo();
    return () => {
      if (scannerRef.current) {
        void scannerRef.current
          .stop()
          .catch(() => undefined)
          .finally(() => {
            scannerRef.current?.clear();
          });
      }
    };
  }, [refreshGeo]);

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors when camera is already stopped.
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  async function submitQrCheckIn(qrPayload: string) {
    if (!navigator.onLine) {
      setSubmitError({
        message: "Internet connection required for QR & GPS attendance check-in.",
      });
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      let activeGeo = geoRef.current;
      const isStale =
        !activeGeo || Date.now() - activeGeo.capturedAt > 30_000;
      if (!activeGeo || isStale || activeGeo.accuracy > 100) {
        activeGeo = await refreshGeo();
      }
      if (!activeGeo) {
        setSubmitError({
          message:
            "GPS coordinates are required before submitting attendance. Enable location permissions and retry.",
        });
        return;
      }

      const mirrorToken = await getIndexedDbDeviceToken();

      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload,
          studentLat: activeGeo.lat,
          studentLng: activeGeo.lng,
          studentAccuracyM: activeGeo.accuracy,
          mirrorToken,
        }),
      });

      const payload = (await res.json()) as CheckInSuccess & {
        error?: string;
        code?: string;
      };

      if (!res.ok) {
        setSubmitError({
          message: payload.error ?? "Attendance check-in failed.",
          code: payload.code,
        });
        return;
      }

      if (payload.mirrorToken) {
        await setIndexedDbDeviceToken(payload.mirrorToken);
      }

      setSuccess(payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
        queryClient.invalidateQueries({ queryKey: ["subjects"] }),
        queryClient.invalidateQueries({
          queryKey: ["subject-sessions", subjectId],
        }),
      ]);
    } catch {
      setSubmitError({
        message: "Network error while submitting attendance check-in.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function startScanner() {
    setCameraError(null);
    setSubmitError(null);
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("attendance-qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => {
          void stopScanner().then(() => submitQrCheckIn(decodedText));
        },
        () => {
          // Keep scanning across per-frame misses.
        }
      );
    } catch {
      setScanning(false);
      setCameraError(
        "Unable to access camera. Allow camera permission in your browser settings or ask your teacher for a manual override."
      );
    }
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto space-y-4">
        <Link
          href={`/subjects/${subjectId}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Subject</span>
        </Link>

        {!isOnline && (
          <OfflineBanner message="Internet connection required for QR & GPS attendance check-in. Reconnect and try again." />
        )}

        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900">
              Scan Attendance QR
            </h2>
            <p className="text-xs text-slate-500">
              Your camera and GPS are captured on-demand only to verify classroom
              presence.
            </p>
          </div>

          {success ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <AttendanceStatusBadge status={success.record.status} />
                  <span className="text-sm font-bold text-emerald-900">
                    +{success.pointsAwarded} pts
                  </span>
                </div>
                <p className="text-xs text-emerald-800">
                  Checked in at {Math.round(success.record.distanceMeters)}m
                  from classroom anchor.
                </p>
                <p className="text-xs font-semibold text-emerald-900">
                  Updated Subject Balance: {success.availableBalance} pts
                </p>
              </div>
              <Link
                href={`/subjects/${subjectId}`}
                className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Return to Class Workspace
              </Link>
            </div>
          ) : (
            <>
              {/* GPS Readiness Card */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <LocateFixed className="h-4 w-4 text-indigo-600" />
                    <span>Device GPS Status</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshGeo()}
                    disabled={geoLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    <RefreshCw
                      className={
                        geoLoading ? "h-3 w-3 animate-spin" : "h-3 w-3"
                      }
                    />
                    <span>{geoLoading ? "Locating..." : "Refresh GPS"}</span>
                  </button>
                </div>

                {geo && !geoError && (
                  <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      GPS ready (±{Math.round(geo.accuracy)}m accuracy)
                    </span>
                  </p>
                )}

                {geoError && (
                  <p role="alert" className="text-xs text-rose-700">
                    {geoError}
                  </p>
                )}
              </div>

              {cameraError && (
                <div
                  role="alert"
                  className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{cameraError}</span>
                </div>
              )}

              {submitError && (
                <div
                  role="alert"
                  className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-800 space-y-1"
                >
                  <p className="font-semibold">{submitError.message}</p>
                  {submitError.code && (
                    <p className="font-mono text-[10px] text-rose-600">
                      {submitError.code}
                    </p>
                  )}
                </div>
              )}

              {/* Camera Scanner */}
              <div className="space-y-3">
                {!scanning ? (
                  <button
                    type="button"
                    onClick={() => void startScanner()}
                    disabled={!isOnline || submitting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    <Camera className="h-4 w-4" />
                    <span>
                      {submitting
                        ? "Verifying Check-In..."
                        : submitError
                        ? "Scan QR Again"
                        : "Open Camera & Scan QR"}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void stopScanner()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    <CameraOff className="h-4 w-4" />
                    <span>Stop Camera</span>
                  </button>
                )}

                <div
                  id="attendance-qr-reader"
                  className={
                    scanning
                      ? "overflow-hidden rounded-xl border border-slate-200"
                      : "hidden"
                  }
                />
              </div>

              <p className="text-[11px] text-slate-500 text-center">
                Having trouble with camera or indoor GPS? Ask your teacher for a
                manual attendance override on the live roster.
              </p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
