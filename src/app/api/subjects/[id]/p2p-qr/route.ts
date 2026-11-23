import { NextResponse } from "next/server";
import {
  jsonError,
  pointsDisabledError,
  requireSubjectMember,
} from "@/lib/auth/guards";
import { signP2pQrPayload } from "@/lib/points/p2p-qr";
import { p2pQrQuerySchema } from "@/lib/validations/points";

export async function GET(
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
      "Only enrolled students can generate P2P receive QR codes.",
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

  const { searchParams } = new URL(request.url);
  const rawAmount = searchParams.get("amount");
  const rawNote = searchParams.get("note");

  const parsed = p2pQrQuerySchema.safeParse({
    amount: rawAmount && rawAmount.trim() !== "" ? rawAmount : undefined,
    note: rawNote && rawNote.trim() !== "" ? rawNote : undefined,
  });

  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid P2P QR parameters.",
      400,
      "ERR_VALIDATION"
    );
  }

  const requestedAmount = parsed.data.amount ?? null;
  const requestedNote = parsed.data.note?.trim() || null;

  const qrPayload = signP2pQrPayload({
    subjectId: subject.id,
    receiverEnrollmentId: enrollment.id,
    requestedAmount,
    requestedNote,
  });

  return NextResponse.json({
    qrPayload,
    requestedAmount,
    requestedNote,
    receiver: {
      enrollmentId: enrollment.id,
      fullName: user.fullName,
      institutionalId: user.institutionalId,
    },
    subject: {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
    },
  });
}
