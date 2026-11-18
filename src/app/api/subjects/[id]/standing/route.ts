import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireSubjectMember } from "@/lib/auth/guards";
import { computeSubjectStandings } from "@/lib/grading/standing-service";

const uuidSchema = z.string().uuid();

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

  if (user.role === "STUDENT") {
    if (!enrollment) {
      return jsonError("Not enrolled in this subject.", 403, "ERR_NOT_ENROLLED");
    }

    if (!subject.standingVisible) {
      return NextResponse.json({
        standingVisible: false,
        manualStandingOverride: enrollment.manualStandingOverride,
        standing: null,
      });
    }

    const computed = await computeSubjectStandings({
      subjectId: id,
      enrollmentId: enrollment.id,
    });

    return NextResponse.json({
      standingVisible: true,
      manualStandingOverride: enrollment.manualStandingOverride,
      usingDefaultScale: computed.usingDefaultScale,
      standing: computed.standings[0]?.standing ?? null,
    });
  }

  const { searchParams } = new URL(request.url);
  const enrollmentIdParam = searchParams.get("enrollmentId");
  if (enrollmentIdParam && !uuidSchema.safeParse(enrollmentIdParam).success) {
    return jsonError("Invalid enrollmentId parameter.", 400, "ERR_VALIDATION");
  }

  const computed = await computeSubjectStandings({
    subjectId: id,
    ...(enrollmentIdParam ? { enrollmentId: enrollmentIdParam } : {}),
  });

  return NextResponse.json({
    standingVisible: subject.standingVisible,
    usingDefaultScale: computed.usingDefaultScale,
    standings: computed.standings,
  });
}
