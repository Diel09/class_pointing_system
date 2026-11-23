import { NextResponse } from "next/server";
import {
  jsonError,
  pointsDisabledError,
  requireSubjectMember,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { verifyP2pQrPayload } from "@/lib/points/p2p-qr";
import { inspectP2pQrSchema } from "@/lib/validations/points";

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
      "Only enrolled students can inspect P2P transfer QRs.",
      403,
      "ERR_FORBIDDEN"
    );
  }

  if (subject.isArchived) {
    return jsonError(
      "P2P transfers are unavailable on archived subjects.",
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

  const parsed = inspectP2pQrSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid QR payload.",
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

  if (verified.data.receiverEnrollmentId === enrollment.id.toLowerCase()) {
    return jsonError(
      "You cannot transfer points to yourself.",
      400,
      "ERR_SELF_TRANSFER"
    );
  }

  const receiverEnrollment = await db.subjectEnrollment.findUnique({
    where: { id: verified.data.receiverEnrollmentId },
    include: {
      student: {
        select: { id: true, fullName: true, institutionalId: true, status: true },
      },
    },
  });

  if (
    !receiverEnrollment ||
    receiverEnrollment.subjectId.toLowerCase() !== id.toLowerCase()
  ) {
    return jsonError(
      "Transfers are only allowed between classmates in the same subject.",
      400,
      "ERR_CROSS_SUBJECT_QR"
    );
  }

  if (receiverEnrollment.student.status !== "ACTIVE") {
    return jsonError(
      "Recipient account is not active.",
      400,
      "ERR_RECIPIENT_INACTIVE"
    );
  }

  return NextResponse.json({
    receiver: {
      enrollmentId: receiverEnrollment.id,
      fullName: receiverEnrollment.student.fullName,
      institutionalId: receiverEnrollment.student.institutionalId,
    },
    subject: {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
    },
    requestedAmount: verified.data.requestedAmount,
    requestedNote: verified.data.requestedNote,
  });
}
