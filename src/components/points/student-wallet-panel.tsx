"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Award,
  Coins,
  MinusCircle,
  PlusCircle,
  QrCode,
  Send,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { PointLedgerFeed } from "./point-ledger-feed";
import { StudentP2pReceiveModal } from "./student-p2p-receive-modal";

interface WalletResponse {
  wallet: {
    enrollmentId: string;
    availableBalance: number;
    escrowedBalance: number;
    manualStandingOverride: string;
    allowNegativeBalance: boolean;
    totalEarned: number;
    totalDemerits: number;
    totalSpent: number;
    meritCount: number;
    demeritCount: number;
    attendanceCount: number;
  };
}

interface StudentWalletPanelProps {
  subjectId: string;
  subjectCode: string;
  initialAvailableBalance: number;
  initialEscrowedBalance: number;
  manualStandingOverride: string;
  allowNegativeBalance: boolean;
  allowP2pTransfers: boolean;
  isArchived: boolean;
  p2pMaxPerTransfer: number | null;
  p2pMaxPerDay: number | null;
  p2pMaxPerTerm: number | null;
}

export function StudentWalletPanel({
  subjectId,
  subjectCode,
  initialAvailableBalance,
  initialEscrowedBalance,
  manualStandingOverride,
  allowNegativeBalance,
  allowP2pTransfers,
  isArchived,
  p2pMaxPerTransfer,
  p2pMaxPerDay,
  p2pMaxPerTerm,
}: StudentWalletPanelProps) {
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const { data } = useQuery<WalletResponse>({
    queryKey: ["subject-wallet", subjectId],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${subjectId}/wallet`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Unable to load wallet.");
      }
      return (await res.json()) as WalletResponse;
    },
  });

  const wallet = data?.wallet ?? {
    enrollmentId: "",
    availableBalance: initialAvailableBalance,
    escrowedBalance: initialEscrowedBalance,
    manualStandingOverride,
    allowNegativeBalance,
    totalEarned: 0,
    totalDemerits: 0,
    totalSpent: 0,
    meritCount: 0,
    demeritCount: 0,
    attendanceCount: 0,
  };

  const inDebt = wallet.availableBalance < 0;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className={cn(
            "rounded-2xl bg-white border p-5 shadow-sm space-y-1.5",
            inDebt ? "border-rose-300 bg-rose-50/40" : "border-slate-200"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <Coins
                className={cn(
                  "h-4 w-4",
                  inDebt ? "text-rose-600" : "text-emerald-600"
                )}
              />
              <span>Available Balance</span>
            </div>
            {inDebt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                <span>Point Debt</span>
              </span>
            )}
          </div>
          <p
            className={cn(
              "text-3xl font-bold",
              inDebt ? "text-rose-700" : "text-slate-900"
            )}
          >
            {wallet.availableBalance} pts
          </p>
          <p className="text-xs text-slate-500">
            {inDebt
              ? "Earn positive points to clear debt before spending or transferring."
              : `Isolated exclusively to ${subjectCode}`}
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <Award className="h-4 w-4 text-indigo-600" />
            <span>Pending / Escrowed</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {wallet.escrowedBalance} pts
          </p>
          <p className="text-xs text-slate-500">
            Standing Override: {wallet.manualStandingOverride}
          </p>
        </div>
      </div>

      {/* Lifetime Summary Strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
            <span>Lifetime Earned</span>
          </p>
          <p className="mt-1 text-base font-bold text-slate-900">
            +{wallet.totalEarned} pts
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <PlusCircle className="h-3.5 w-3.5 text-indigo-600" />
            <span>Merits</span>
          </p>
          <p className="mt-1 text-base font-bold text-slate-900">
            {wallet.meritCount}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <MinusCircle className="h-3.5 w-3.5 text-rose-600" />
            <span>Demerits</span>
          </p>
          <p className="mt-1 text-base font-bold text-slate-900">
            {wallet.demeritCount} (-{wallet.totalDemerits} pts)
          </p>
        </div>
      </div>

      {/* GCash-Style P2P QR Sharing Bar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-sm font-bold text-slate-900">
            Peer-to-Peer QR Sharing
          </p>
          <p className="text-xs text-slate-500">
            {!allowP2pTransfers
              ? "Peer-to-peer point transfers are currently disabled by your teacher."
              : isArchived
              ? "Transfers are unavailable on archived subjects."
              : [
                  p2pMaxPerTransfer ? `Max ${p2pMaxPerTransfer}/transfer` : null,
                  p2pMaxPerDay ? `${p2pMaxPerDay}/day` : null,
                  p2pMaxPerTerm ? `${p2pMaxPerTerm}/term` : null,
                ]
                  .filter(Boolean)
                  .join(" • ") ||
                `Instant classmate transfers within ${subjectCode}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!allowP2pTransfers || isArchived}
            onClick={() => setReceiveModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>Receive Points</span>
          </button>

          {allowP2pTransfers && !isArchived && wallet.availableBalance > 0 ? (
            <Link
              href={`/subjects/${subjectId}/p2p/send`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send Points</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send Points</span>
            </button>
          )}
        </div>
      </div>

      <StudentP2pReceiveModal
        subjectId={subjectId}
        subjectCode={subjectCode}
        open={receiveModalOpen}
        onClose={() => setReceiveModalOpen(false)}
      />

      {/* Student Immutable Ledger Feed */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
        <PointLedgerFeed subjectId={subjectId} mode="student" />
      </div>
    </section>
  );
}
