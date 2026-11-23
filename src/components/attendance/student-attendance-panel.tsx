"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarCheck2, Camera, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { AttendanceStatusBadge } from "./status-badge";

interface StudentSessionItem {
  id: string;
  status: "OPEN" | "CLOSED";
  radiusMeters: number;
  startedAt: string;
  presentCutoffAt: string;
  lateCutoffAt: string;
  presentPoints: number;
  latePoints: number;
  myRecord: {
    id: string;
    status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";
    checkInMethod: "QR_SCAN" | "TEACHER_OVERRIDE" | "SYSTEM_CLOSE";
    distanceMeters: number | null;
    pointsAwarded: number;
    overrideReason: string | null;
    recordedAt: string;
  } | null;
}

interface StudentAttendancePanelProps {
  subjectId: string;
  pointsEnabled?: boolean;
}

export function StudentAttendancePanel({
  subjectId,
  pointsEnabled: initialPointsEnabled = true,
}: StudentAttendancePanelProps) {
  const { data, isLoading } = useQuery<{
    pointsEnabled?: boolean;
    sessions: StudentSessionItem[];
    openSessionId: string | null;
  }>({
    queryKey: ["subject-sessions", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/sessions`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Unable to load attendance.");
      }
      return (await res.json()) as {
        pointsEnabled?: boolean;
        sessions: StudentSessionItem[];
        openSessionId: string | null;
      };
    },
    refetchInterval: 10_000,
  });

  const pointsEnabled = data?.pointsEnabled ?? initialPointsEnabled;
  const sessions = data?.sessions ?? [];
  const openSession = sessions.find((s) => s.status === "OPEN") ?? null;

  return (
    <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarCheck2 className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-900">
            Attendance Check-In
          </h3>
        </div>
        <Link
          href={`/subjects/${subjectId}/check-in`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Camera className="h-4 w-4" />
          <span>Scan Attendance QR</span>
        </Link>
      </div>

      {openSession && !openSession.myRecord && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AttendanceStatusBadge status="OPEN" />
              <span className="text-xs font-semibold text-emerald-900">
                Attendance Session Active Now
              </span>
            </div>
            <p className="text-xs text-emerald-800">
              Present
              {pointsEnabled ? ` (+${openSession.presentPoints} pts)` : ""}{" "}
              until{" "}
              {new Date(openSession.presentCutoffAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              • Late{pointsEnabled ? ` (+${openSession.latePoints} pts)` : ""}{" "}
              until{" "}
              {new Date(openSession.lateCutoffAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <Link
            href={`/subjects/${subjectId}/check-in`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Camera className="h-3.5 w-3.5" />
            <span>Check In Now</span>
          </Link>
        </div>
      )}

      {openSession && openSession.myRecord && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-indigo-900">
            <AttendanceStatusBadge status={openSession.myRecord.status} />
            <span className="font-semibold">
              You are checked in for today&apos;s session
              {pointsEnabled
                ? ` (+${openSession.myRecord.pointsAwarded} pts)`
                : ""}
              .
            </span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          My Attendance History
        </h4>
        {isLoading ? (
          <p className="text-xs text-slate-500">Loading attendance records...</p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-slate-500">
            No attendance sessions have been held for this class yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {sessions.map((session) => {
              const rec = session.myRecord;
              const badgeStatus =
                rec?.status ?? (session.status === "OPEN" ? "PENDING" : "ABSENT");

              return (
                <div
                  key={session.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AttendanceStatusBadge status={badgeStatus} />
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
                    <p className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>
                          {rec
                            ? rec.checkInMethod === "QR_SCAN"
                              ? "QR Scan"
                              : rec.checkInMethod === "TEACHER_OVERRIDE"
                              ? "Teacher Override"
                              : "Session Closed"
                            : "Not checked in yet"}
                        </span>
                      </span>
                      {rec?.distanceMeters != null && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span>{Math.round(rec.distanceMeters)}m</span>
                        </span>
                      )}
                      {rec?.overrideReason && (
                        <span className="text-slate-600">
                          • Note: {rec.overrideReason}
                        </span>
                      )}
                    </p>
                  </div>

                  {pointsEnabled && (
                    <span className="text-xs font-bold text-slate-800">
                      {rec ? `+${rec.pointsAwarded} pts` : "0 pts"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
