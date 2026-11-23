import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import {
  jsonError,
  POINTS_DISABLED_MESSAGE,
  pointsDisabledError,
  requireSubjectMember,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { validateP2pLimits } from "@/lib/points/p2p-limits";
import { verifyP2pQrPayload } from "@/lib/points/p2p-qr";
import { createP2pTransferSchema } from "@/lib/validations/points";

interface LockedEnrollmentRow {
  id: string;
  subjectId: string;
  studentId: string;
  availableBalance: number;
  escrowedBalance: number;
}

class TransferRejectedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { user, subject, enrollment } = member.data;
  if (user.role !== "STUDENT" || !enrollment) {
    return jsonError(
      "Only enrolled students can send P2P point transfers.",
      403,
      "ERR_FORBIDDEN"
    );
  }

  if (subject.isArchived) {
    return jsonError(
      "Cannot transfer points on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (subject.pointsEnabled === false) {
    return pointsDisabledError();
  }

  if (!subject.allowP2pTransfers) {
    return jsonError(
      "Peer-to-peer point transfers are currently disabled for this subject.",
      400,
      "ERR_P2P_DISABLED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createP2pTransferSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid transfer request.",
      400,
      "ERR_VALIDATION"
    );
  }

  const verified = verifyP2pQrPayload(parsed.data.qrPayload);
  if (!verified.valid) {
    return jsonError(
      "Invalid or tampered P2P QR code.",
      400,
      "ERR_INVALID_P2P_QR"
    );
  }

  if (verified.data.subjectId !== id.toLowerCase()) {
    return jsonError(
      "Transfers are only allowed between classmates in the same subject.",
      400,
      "ERR_CROSS_SUBJECT_QR"
    );
  }

  const receiverEnrollmentId = verified.data.receiverEnrollmentId;
  if (receiverEnrollmentId === enrollment.id.toLowerCase()) {
    return jsonError(
      "You cannot transfer points to yourself.",
      400,
      "ERR_SELF_TRANSFER"
    );
  }

  const amount = parsed.data.amount;
  const transferNote =
    parsed.data.note?.trim() || verified.data.requestedNote || null;
  const ipAddress = getClientIp(request);
  const transferId = randomUUID();
  const lockIds = [enrollment.id, receiverEnrollmentId].sort();

  try {
    const { receipt, receiverUserId } = await db.$transaction(async (tx) => {
      const liveSubject = await tx.subject.findUnique({
        where: { id },
        include: {
          term: { select: { startDate: true, endDate: true } },
        },
      });
      if (!liveSubject) {
        throw new TransferRejectedError("Subject not found.", "ERR_NOT_FOUND", 404);
      }
      if (liveSubject.isArchived) {
        throw new TransferRejectedError(
          "Cannot transfer points on an archived subject.",
          "ERR_SUBJECT_ARCHIVED",
          400
        );
      }
      if (liveSubject.pointsEnabled === false) {
        throw new TransferRejectedError(
          POINTS_DISABLED_MESSAGE,
          "ERR_POINTS_DISABLED",
          400
        );
      }
      if (!liveSubject.allowP2pTransfers) {
        throw new TransferRejectedError(
          "Peer-to-peer point transfers are currently disabled for this subject.",
          "ERR_P2P_DISABLED",
          400
        );
      }

      // Acquire FOR UPDATE row locks in deterministic ascending UUID order to prevent deadlocks.
      const lockedRows = await tx.$queryRaw<LockedEnrollmentRow[]>`
        SELECT id, "subjectId", "studentId", "availableBalance", "escrowedBalance"
        FROM "SubjectEnrollment"
        WHERE id IN (${Prisma.join(lockIds.map((eid) => Prisma.sql`${eid}::uuid`))})
        ORDER BY id ASC
        FOR UPDATE
      `;

      const senderRow = lockedRows.find(
        (r) => r.id.toLowerCase() === enrollment.id.toLowerCase()
      );
      const receiverRow = lockedRows.find(
        (r) => r.id.toLowerCase() === receiverEnrollmentId.toLowerCase()
      );

      if (!senderRow || !receiverRow) {
        throw new TransferRejectedError(
          "Recipient enrollment not found in this subject.",
          "ERR_ENROLLMENT_NOT_FOUND",
          404
        );
      }

      if (
        senderRow.subjectId.toLowerCase() !== id.toLowerCase() ||
        receiverRow.subjectId.toLowerCase() !== id.toLowerCase()
      ) {
        throw new TransferRejectedError(
          "Transfers are only allowed between classmates in the same subject.",
          "ERR_CROSS_SUBJECT_QR",
          400
        );
      }

      const receiverUser = await tx.user.findUnique({
        where: { id: receiverRow.studentId },
        select: { id: true, fullName: true, institutionalId: true, status: true },
      });
      if (!receiverUser || receiverUser.status !== "ACTIVE") {
        throw new TransferRejectedError(
          "Recipient account is not active.",
          "ERR_RECIPIENT_INACTIVE",
          400
        );
      }

      let senderSentToday = 0;
      let receiverReceivedToday = 0;
      let senderSentInTerm = 0;
      let receiverReceivedInTerm = 0;

      const now = new Date();
      if (liveSubject.p2pMaxPerDay !== null) {
        const startOfUtcDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        );
        const [senderDayAgg, receiverDayAgg] = await Promise.all([
          tx.pointLedgerEntry.aggregate({
            where: {
              enrollmentId: senderRow.id,
              entryType: "P2P_SEND",
              createdAt: { gte: startOfUtcDay },
            },
            _sum: { availableDelta: true },
          }),
          tx.pointLedgerEntry.aggregate({
            where: {
              enrollmentId: receiverRow.id,
              entryType: "P2P_RECEIVE",
              createdAt: { gte: startOfUtcDay },
            },
            _sum: { availableDelta: true },
          }),
        ]);
        senderSentToday = Math.abs(senderDayAgg._sum.availableDelta ?? 0);
        receiverReceivedToday = Math.max(
          0,
          receiverDayAgg._sum.availableDelta ?? 0
        );
      }

      if (liveSubject.p2pMaxPerTerm !== null) {
        const termWindow = {
          gte: liveSubject.term.startDate,
          lte: liveSubject.term.endDate,
        };
        const [senderTermAgg, receiverTermAgg] = await Promise.all([
          tx.pointLedgerEntry.aggregate({
            where: {
              enrollmentId: senderRow.id,
              entryType: "P2P_SEND",
              createdAt: termWindow,
            },
            _sum: { availableDelta: true },
          }),
          tx.pointLedgerEntry.aggregate({
            where: {
              enrollmentId: receiverRow.id,
              entryType: "P2P_RECEIVE",
              createdAt: termWindow,
            },
            _sum: { availableDelta: true },
          }),
        ]);
        senderSentInTerm = Math.abs(senderTermAgg._sum.availableDelta ?? 0);
        receiverReceivedInTerm = Math.max(
          0,
          receiverTermAgg._sum.availableDelta ?? 0
        );
      }

      const limitResult = validateP2pLimits({
        allowP2pTransfers: liveSubject.allowP2pTransfers,
        amount,
        senderAvailableBalance: senderRow.availableBalance,
        p2pMaxPerTransfer: liveSubject.p2pMaxPerTransfer,
        p2pMaxPerDay: liveSubject.p2pMaxPerDay,
        p2pMaxPerTerm: liveSubject.p2pMaxPerTerm,
        senderSentToday,
        senderSentInTerm,
        receiverReceivedToday,
        receiverReceivedInTerm,
      });

      if (!limitResult.ok) {
        throw new TransferRejectedError(
          limitResult.message,
          limitResult.code,
          400
        );
      }

      const senderAfter = senderRow.availableBalance - amount;
      const receiverAfter = receiverRow.availableBalance + amount;

      await tx.subjectEnrollment.update({
        where: { id: senderRow.id },
        data: { availableBalance: senderAfter },
      });

      await tx.subjectEnrollment.update({
        where: { id: receiverRow.id },
        data: { availableBalance: receiverAfter },
      });

      const sendNote = transferNote
        ? `Sent to ${receiverUser.fullName}: ${transferNote}`
        : `Sent to ${receiverUser.fullName}`;
      const receiveNote = transferNote
        ? `Received from ${user.fullName}: ${transferNote}`
        : `Received from ${user.fullName}`;

      await tx.pointLedgerEntry.createMany({
        data: [
          {
            enrollmentId: senderRow.id,
            subjectId: id,
            entryType: "P2P_SEND",
            availableDelta: -amount,
            escrowDelta: 0,
            availableAfter: senderAfter,
            escrowAfter: senderRow.escrowedBalance,
            referenceType: "P2pTransfer",
            referenceId: transferId,
            note: sendNote,
            actorUserId: user.id,
          },
          {
            enrollmentId: receiverRow.id,
            subjectId: id,
            entryType: "P2P_RECEIVE",
            availableDelta: amount,
            escrowDelta: 0,
            availableAfter: receiverAfter,
            escrowAfter: receiverRow.escrowedBalance,
            referenceType: "P2pTransfer",
            referenceId: transferId,
            note: receiveNote,
            actorUserId: user.id,
          },
        ],
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          subjectId: id,
          action: "P2P_TRANSFER_COMPLETED",
          targetType: "P2pTransfer",
          targetId: transferId,
          beforeState: {
            senderEnrollmentId: senderRow.id,
            senderAvailableBalance: senderRow.availableBalance,
            receiverEnrollmentId: receiverRow.id,
            receiverAvailableBalance: receiverRow.availableBalance,
          },
          afterState: {
            amount,
            note: transferNote,
            senderAvailableBalance: senderAfter,
            receiverAvailableBalance: receiverAfter,
          },
          ipAddress,
        },
      });

      return {
        receiverUserId: receiverRow.studentId,
        receipt: {
          transferId,
          createdAt: now.toISOString(),
          amount,
          note: transferNote,
          subject: {
            id: liveSubject.id,
            code: liveSubject.code,
            title: liveSubject.title,
            section: liveSubject.section,
          },
          sender: {
            enrollmentId: senderRow.id,
            fullName: user.fullName,
            institutionalId: user.institutionalId,
            availableBalanceAfter: senderAfter,
          },
          receiver: {
            enrollmentId: receiverRow.id,
            fullName: receiverUser.fullName,
            institutionalId: receiverUser.institutionalId,
          },
        },
      };
    });

    await dispatchNotifications([
      {
        userId: receiverUserId,
        subjectId: id,
        type: "P2P_RECEIVED",
        title: `Points Received (${receipt.subject.code})`,
        body: `${user.fullName} sent you +${amount} pts${
          transferNote ? ` — "${transferNote}"` : ""
        }.`,
        linkUrl: `/subjects/${id}`,
      },
    ]);

    return NextResponse.json({ receipt }, { status: 201 });
  } catch (error) {
    if (error instanceof TransferRejectedError) {
      return jsonError(error.message, error.status, error.code);
    }
    throw error;
  }
}
