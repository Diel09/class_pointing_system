"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  ClipboardPaste,
  Send,
  UserCheck,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";

interface InspectedRecipient {
  receiver: {
    enrollmentId: string;
    fullName: string;
    institutionalId: string | null;
  };
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
  };
  requestedAmount: number | null;
  requestedNote: string | null;
}

interface TransferReceipt {
  transferId: string;
  createdAt: string;
  amount: number;
  note: string | null;
  subject: {
    id: string;
    code: string;
    title: string;
    section: string;
  };
  sender: {
    enrollmentId: string;
    fullName: string;
    institutionalId: string | null;
    availableBalanceAfter: number;
  };
  receiver: {
    enrollmentId: string;
    fullName: string;
    institutionalId: string | null;
  };
}

export default function StudentP2pSendPage() {
  const params = useParams<{ id: string }>();
  const subjectId = params.id;
  const queryClient = useQueryClient();

  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState("");
  const [activeQrPayload, setActiveQrPayload] = useState("");

  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedRecipient | null>(null);

  const [amountInput, setAmountInput] = useState("1");
  const [noteInput, setNoteInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);

  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (scannerRef.current) {
        void scannerRef.current
          .stop()
          .catch(() => undefined)
          .finally(() => scannerRef.current?.clear());
      }
    };
  }, []);

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

  async function inspectPayload(qrPayload: string) {
    if (!navigator.onLine) {
      setInspectError(
        "Internet connection required for peer-to-peer point transfers."
      );
      return;
    }

    setInspectError(null);
    setSendError(null);
    setInspecting(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/p2p-qr/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: qrPayload.trim() }),
      });
      const data = (await res.json()) as InspectedRecipient & {
        error?: string;
      };
      if (!res.ok) {
        setInspectError(data.error ?? "Unable to verify classmate QR code.");
        return;
      }

      setActiveQrPayload(qrPayload.trim());
      setInspected(data);
      setAmountInput(
        data.requestedAmount !== null ? String(data.requestedAmount) : "1"
      );
      setNoteInput(data.requestedNote ?? "");
    } catch {
      setInspectError("Network error while verifying QR code.");
    } finally {
      setInspecting(false);
    }
  }

  async function startScanner() {
    setCameraError(null);
    setInspectError(null);
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("p2p-qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          void stopScanner().then(() => inspectPayload(decodedText));
        },
        () => {
          // Keep scanning across per-frame misses.
        }
      );
    } catch {
      setScanning(false);
      setCameraError(
        "Unable to access camera. Allow camera permissions or paste the classmate's QR code below."
      );
    }
  }

  async function handleInspectManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await inspectPayload(manualPayload);
  }

  async function handleConfirmTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setSendError(
        "Internet connection required to complete point transfers."
      );
      return;
    }

    const parsedAmount = Number.parseInt(amountInput, 10);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setSendError("Enter a valid positive whole point amount.");
      return;
    }

    setSendError(null);
    setSending(true);

    try {
      const res = await fetch(`/api/subjects/${subjectId}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload: activeQrPayload,
          amount: parsedAmount,
          note: noteInput.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        receipt?: TransferReceipt;
        error?: string;
      };
      if (!res.ok || !data.receipt) {
        setSendError(data.error ?? "Transfer could not be completed.");
        return;
      }

      setReceipt(data.receipt);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["subject-wallet", subjectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["subject-ledger", subjectId],
        }),
        queryClient.invalidateQueries({ queryKey: ["subject", subjectId] }),
      ]);
    } catch {
      setSendError("Network error while sending points.");
    } finally {
      setSending(false);
    }
  }

  function resetTransfer() {
    setReceipt(null);
    setInspected(null);
    setActiveQrPayload("");
    setManualPayload("");
    setAmountInput("1");
    setNoteInput("");
    setInspectError(null);
    setSendError(null);
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto space-y-4">
        <Link
          href={`/subjects/${subjectId}/points`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Points</span>
        </Link>

        {!isOnline && (
          <div
            role="alert"
            className="rounded-2xl bg-amber-50 border border-amber-300 p-4 text-xs text-amber-900 flex items-start gap-2.5"
          >
            <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">You are offline</p>
              <p>
                Internet connection required for QR &amp; point transactions.
                Reconnect and try again.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-5">
          {receipt ? (
            /* Step 3: Digital Receipt */
            <div className="space-y-5 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Transfer Successful
                </p>
                <h2 className="text-3xl font-bold text-slate-900">
                  {receipt.amount} pts
                </h2>
                <p className="text-xs text-slate-500">
                  Sent to{" "}
                  <span className="font-semibold text-slate-800">
                    {receipt.receiver.fullName}
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Subject</span>
                  <span className="font-semibold text-slate-900">
                    {receipt.subject.code} • {receipt.subject.section}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Recipient</span>
                  <span className="font-semibold text-slate-900">
                    {receipt.receiver.fullName}
                    {receipt.receiver.institutionalId
                      ? ` (${receipt.receiver.institutionalId})`
                      : ""}
                  </span>
                </div>
                {receipt.note && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Note</span>
                    <span className="font-medium text-slate-800">
                      {receipt.note}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Updated Balance</span>
                  <span className="font-bold text-indigo-700">
                    {receipt.sender.availableBalanceAfter} pts
                  </span>
                </div>
                <div className="flex justify-between gap-2 pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Reference ID</span>
                  <span className="font-mono text-[10px] text-slate-600">
                    {receipt.transferId}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Timestamp</span>
                  <span className="text-slate-600">
                    {new Date(receipt.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetTransfer}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Send Again
                </button>
                <Link
                  href={`/subjects/${subjectId}`}
                  className="flex-1 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Done
                </Link>
              </div>
            </div>
          ) : inspected ? (
            /* Step 2: Confirmation Sheet */
            <form onSubmit={handleConfirmTransfer} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Confirm Point Transfer
                  </h2>
                  <p className="text-xs text-slate-500">
                    Review verified classmate details before sending.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                  Verified Recipient
                </p>
                <p className="text-base font-bold text-slate-900">
                  {inspected.receiver.fullName}
                </p>
                <p className="text-xs text-slate-600">
                  {inspected.subject.code} ({inspected.subject.section})
                  {inspected.receiver.institutionalId
                    ? ` • ${inspected.receiver.institutionalId}`
                    : ""}
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="p2p-send-amount"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Points to Send
                </label>
                <input
                  id="p2p-send-amount"
                  type="number"
                  min={1}
                  max={100000}
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="p2p-send-note"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Transfer Note (optional)
                </label>
                <input
                  id="p2p-send-note"
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Thanks for helping with lab!"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {sendError && (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700"
                >
                  {sendError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetTransfer}
                  disabled={sending}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={sending || !isOnline}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{sending ? "Sending..." : "Confirm & Send Points"}</span>
                </button>
              </div>
            </form>
          ) : (
            /* Step 1: Scan or Paste QR */
            <>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-slate-900">
                  Send Points to Classmate
                </h2>
                <p className="text-xs text-slate-500">
                  Scan your classmate&apos;s Receive QR code (same subject only)
                  or paste their QR code payload.
                </p>
              </div>

              {cameraError && (
                <p
                  role="alert"
                  className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900"
                >
                  {cameraError}
                </p>
              )}

              {inspectError && (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700"
                >
                  {inspectError}
                </p>
              )}

              <div className="space-y-3">
                {!scanning ? (
                  <button
                    type="button"
                    onClick={() => void startScanner()}
                    disabled={!isOnline || inspecting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    <Camera className="h-4 w-4" />
                    <span>
                      {inspecting
                        ? "Verifying QR..."
                        : "Open Camera & Scan Classmate QR"}
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
                  id="p2p-qr-reader"
                  className={
                    scanning
                      ? "overflow-hidden rounded-xl border border-slate-200"
                      : "hidden"
                  }
                />
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <form onSubmit={handleInspectManual} className="space-y-2">
                  <label
                    htmlFor="p2p-manual-payload"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5 text-slate-500" />
                    <span>Or Paste Classmate QR Payload</span>
                  </label>
                  <textarea
                    id="p2p-manual-payload"
                    rows={2}
                    placeholder="p2p:..."
                    value={manualPayload}
                    onChange={(e) => setManualPayload(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={
                      inspecting || !isOnline || manualPayload.trim().length < 10
                    }
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {inspecting ? "Verifying..." : "Verify Classmate QR"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
