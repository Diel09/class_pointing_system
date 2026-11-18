"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, QrCode, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";

interface P2pQrResponse {
  qrPayload: string;
  requestedAmount: number | null;
  requestedNote: string | null;
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
}

interface StudentP2pReceiveModalProps {
  subjectId: string;
  subjectCode: string;
  open: boolean;
  onClose: () => void;
}

export function StudentP2pReceiveModal({
  subjectId,
  subjectCode,
  open,
  onClose,
}: StudentP2pReceiveModalProps) {
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [appliedAmount, setAppliedAmount] = useState("");
  const [appliedNote, setAppliedNote] = useState("");
  const [copied, setCopied] = useState(false);
  const isOnline = useOnlineStatus();

  const { data, isLoading, error } = useQuery<P2pQrResponse>({
    queryKey: ["p2p-receive-qr", subjectId, appliedAmount, appliedNote],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appliedAmount.trim()) {
        params.set("amount", appliedAmount.trim());
      }
      if (appliedNote.trim()) {
        params.set("note", appliedNote.trim());
      }
      const qs = params.toString();
      const res = await fetch(
        `/api/subjects/${subjectId}/p2p-qr${qs ? `?${qs}` : ""}`,
        { credentials: "same-origin" }
      );
      const body = (await res.json()) as P2pQrResponse & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Unable to generate P2P QR code.");
      }
      return body;
    },
    enabled: open,
  });

  if (!open) return null;

  function handleApplyDetails() {
    setAppliedAmount(amountInput);
    setAppliedNote(noteInput);
  }

  async function handleCopyQr() {
    if (!data?.qrPayload) return;
    await navigator.clipboard.writeText(data.qrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="p2p-receive-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="p2p-receive-title"
                className="text-base font-bold text-slate-900"
              >
                Receive Points ({subjectCode})
              </h3>
              <p className="text-xs text-slate-500">
                Classmates in {subjectCode} can scan this QR to send points.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Receive QR"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isOnline && (
          <OfflineBanner message="Internet connection required to generate a signed P2P QR code." />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="p2p-req-amount"
              className="block text-xs font-medium text-slate-700"
            >
              Requested Amount (optional)
            </label>
            <input
              id="p2p-req-amount"
              type="number"
              min={1}
              max={100000}
              placeholder="e.g. 15"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="p2p-req-note"
              className="block text-xs font-medium text-slate-700"
            >
              Note (optional)
            </label>
            <input
              id="p2p-req-note"
              type="text"
              maxLength={140}
              placeholder="e.g. Group project split"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleApplyDetails}
          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Update QR Details
        </button>

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
            Generating signed QR code...
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
          >
            {error instanceof Error
              ? error.message
              : "Unable to generate P2P QR."}
          </div>
        ) : data ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex flex-col items-center space-y-3 text-center">
            <div className="rounded-xl bg-white p-3 shadow-sm border border-slate-200">
              <QRCodeSVG
                value={data.qrPayload}
                size={190}
                level="M"
                role="img"
                aria-label="Personal P2P Receive QR Code"
              />
            </div>

            <div className="space-y-0.5">
              <p className="text-sm font-bold text-slate-900">
                {data.receiver.fullName}
              </p>
              <p className="text-xs text-slate-500">
                {data.subject.code} • {data.subject.section}
                {data.receiver.institutionalId
                  ? ` • ${data.receiver.institutionalId}`
                  : ""}
              </p>
              {data.requestedAmount !== null && (
                <p className="text-xs font-semibold text-teal-700 pt-1">
                  Requesting: {data.requestedAmount} pts
                  {data.requestedNote ? ` (“${data.requestedNote}”)` : ""}
                </p>
              )}
            </div>

            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={() => void handleCopyQr()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Copied QR Code Payload</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy QR Code Payload</span>
                  </>
                )}
              </button>
              <p
                data-testid="p2p-qr-payload"
                className="text-[10px] font-mono text-slate-400 break-all select-all"
              >
                {data.qrPayload}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
