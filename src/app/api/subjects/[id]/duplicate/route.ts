import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  duplicateSubjectInTransaction,
  fetchDuplicateSubjectSource,
} from "@/lib/subjects/duplicate-subject";
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

  try {
    const prefetchedSource = await fetchDuplicateSubjectSource(
      owner.data.subject.id
    );
    if (!prefetchedSource) {
      return jsonError("Subject not found.", 404, "ERR_NOT_FOUND");
    }

    const result = await db.$transaction(
      (tx) =>
        duplicateSubjectInTransaction(tx, {
          sourceSubjectId: owner.data.subject.id,
          newSection: parsed.data.section,
          actorUserId: owner.data.user.id,
          ipAddress,
          prefetchedSource,
        }),
      { maxWait: 5000, timeout: 20000 }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Duplicate subject error:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2028") {
        return jsonError(
          "Duplication timed out while saving to the database. Please try again.",
          504,
          "ERR_TIMEOUT"
        );
      }
      if (error.code === "P2025") {
        return jsonError("Subject not found.", 404, "ERR_NOT_FOUND");
      }
      if (error.code === "P2002") {
        return jsonError(
          "A conflicting invite code occurred while duplicating. Please try again.",
          409,
          "ERR_CONFLICT"
        );
      }
    }

    return jsonError(
      "Failed to duplicate section. Please try again.",
      500,
      "ERR_INTERNAL"
    );
  }
}
