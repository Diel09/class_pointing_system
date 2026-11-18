import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { duplicateSubjectInTransaction } from "@/lib/subjects/duplicate-subject";
import {
  duplicateSubjectSchema,
  isSameSectionName,
} from "@/lib/validations/subject";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = duplicateSubjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid section name.",
      400,
      "ERR_VALIDATION"
    );
  }

  if (isSameSectionName(parsed.data.section, owner.data.subject.section)) {
    return jsonError(
      "New section must be different from the original section.",
      400,
      "ERR_SAME_SECTION"
    );
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    duplicateSubjectInTransaction(tx, {
      sourceSubjectId: owner.data.subject.id,
      newSection: parsed.data.section,
      actorUserId: owner.data.user.id,
      ipAddress,
    })
  );

  return NextResponse.json(result, { status: 201 });
}
