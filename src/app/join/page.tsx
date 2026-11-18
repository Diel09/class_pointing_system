"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, CheckCircle2, QrCode } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";

function JoinClassContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [inviteCode, setInviteCode] = useState(
    () => searchParams.get("code")?.toUpperCase() ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(
    null
  );

  useEffect(() => {
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
  }, []);

  async function submitJoin(codeToJoin: string) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/subjects/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: codeToJoin }),
      });
      const data = (await response.json()) as {
        error?: string;
        subject?: { id: string };
      };
      if (!response.ok || !data.subject) {
        setError(data.error ?? "Unable to join class.");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
      router.push(`/subjects/${data.subject.id}`);
      router.refresh();
    } catch {
      setError("Network error while joining class.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitJoin(inviteCode);
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors when scanner was not actively running.
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  async function startScanner() {
    setCameraError(null);
    setError(null);
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("join-qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          void stopScanner().then(() => {
            setInviteCode(decodedText);
            void submitJoin(decodedText);
          });
        },
        () => {
          // Per-frame scan miss; keep scanning.
        }
      );
    } catch {
      setScanning(false);
      setCameraError(
        "Unable to access camera. Allow camera permissions or type the invite code manually."
      );
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
        <div className="space-y-1">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 mb-1">
            <QrCode className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Join a Class</h2>
          <p className="text-xs text-slate-500">
            Enter your teacher&apos;s invite code or scan the class invite QR code.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-700"
          >
            {error}
          </div>
        )}

        {cameraError && (
          <div
            role="alert"
            className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800"
          >
            {cameraError}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="inviteCode"
              className="block text-xs font-semibold text-slate-700"
            >
              Class Invite Code
            </label>
            <input
              id="inviteCode"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="CS101SEC"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase tracking-wider focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>{submitting ? "Joining..." : "Join Class"}</span>
          </button>
        </form>

        <div className="pt-3 border-t border-slate-100 space-y-3">
          {!scanning ? (
            <button
              type="button"
              onClick={startScanner}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Camera className="h-4 w-4" />
              <span>Scan Invite QR with Camera</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopScanner}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
            >
              <CameraOff className="h-4 w-4" />
              <span>Stop Camera Scanner</span>
            </button>
          )}

          <div
            id="join-qr-reader"
            className={scanning ? "overflow-hidden rounded-xl border border-slate-200" : "hidden"}
          />
        </div>
      </div>
    </div>
  );
}

export default function JoinClassPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="text-sm text-slate-500">Loading...</div>}>
        <JoinClassContent />
      </Suspense>
    </AppShell>
  );
}
