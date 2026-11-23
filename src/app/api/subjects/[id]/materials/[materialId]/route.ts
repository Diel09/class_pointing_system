import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireSubjectInstructor } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  parseGoogleDriveUrl,
  verifyGoogleDriveLinkAccess,
} from "@/lib/submissions/google-drive-link";
import { updateSubjectMaterialSchema } from "@/lib/validations/subject";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; materialId: string }> }
) {
  const { id, materialId } = await context.params;
  const instructor = await requireSubjectInstructor(id);
  if (!instructor.ok) {
    return instructor.response;
  }

  const { user, subject } = instructor.data;
  if (subject.isArchived) {
    return jsonError(
      "Cannot edit materials on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (!UUID_REGEX.test(materialId)) {
    return jsonError("Learning material not found.", 404, "ERR_NOT_FOUND");
  }

  const existing = await db.subjectMaterial.findUnique({
    where: { id: materialId },
  });
  if (!existing || existing.subjectId !== id) {
    return jsonError("Learning material not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateSubjectMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid learning material update.",
      400,
      "ERR_VALIDATION"
    );
  }

  const requirePublicLink =
    parsed.data.requirePublicLink ?? existing.requirePublicLink;

  let nextDriveUrl = existing.driveUrl;
  let nextNormalizedUrl = existing.normalizedUrl;
  let nextResourceId = existing.driveResourceId;
  let nextResourceType = existing.resourceType;
  let nextAccessStatus = existing.accessStatus;
  let nextAccessCheckedAt = existing.accessCheckedAt;
  let accessWarning: string | null = null;

  if (
    parsed.data.driveUrl !== undefined ||
    parsed.data.requirePublicLink !== undefined
  ) {
    const rawUrl = parsed.data.driveUrl ?? existing.driveUrl;
    const linkParsed = parseGoogleDriveUrl(rawUrl);
    if (!linkParsed.ok) {
      return jsonError(linkParsed.error, 400, "ERR_VALIDATION");
    }

    const accessResult = await verifyGoogleDriveLinkAccess(
      linkParsed.data.normalizedUrl
    );

    if (accessResult.accessStatus === "NOT_FOUND") {
      return jsonError(
        accessResult.reason ?? "Google Drive item was not found (404).",
        422,
        "ERR_DRIVE_LINK_NOT_FOUND"
      );
    }

    if (
      accessResult.accessStatus === "PRIVATE_OR_RESTRICTED" &&
      requirePublicLink
    ) {
      return jsonError(
        accessResult.reason ??
          "This Google Drive link is private/restricted. Set sharing to 'Anyone with the link'.",
        422,
        "ERR_DRIVE_LINK_RESTRICTED"
      );
    }

    nextDriveUrl = linkParsed.data.originalUrl;
    nextNormalizedUrl = linkParsed.data.normalizedUrl;
    nextResourceId = linkParsed.data.resourceId;
    nextResourceType = linkParsed.data.resourceType;
    nextAccessStatus =
      accessResult.accessStatus === "PRIVATE_OR_RESTRICTED"
        ? "PRIVATE_OR_RESTRICTED"
        : accessResult.accessStatus === "PUBLIC_VERIFIED"
        ? "PUBLIC_VERIFIED"
        : "UNVERIFIED";
    nextAccessCheckedAt = accessResult.checkedAt;
    if (nextAccessStatus === "UNVERIFIED") {
      accessWarning =
        accessResult.reason ??
        "Could not automatically verify public access; double-check your Drive sharing settings.";
    }
  }

  const ipAddress = getClientIp(request);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.subjectMaterial.update({
      where: { id: materialId },
      data: {
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title }
          : {}),
        ...(parsed.data.topic !== undefined
          ? { topic: parsed.data.topic?.trim() || null }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description?.trim() || null }
          : {}),
        driveUrl: nextDriveUrl,
        normalizedUrl: nextNormalizedUrl,
        driveResourceId: nextResourceId,
        resourceType: nextResourceType,
        accessStatus: nextAccessStatus,
        accessCheckedAt: nextAccessCheckedAt,
        requirePublicLink,
      },
      include: {
        uploadedByTeacher: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: id,
        action: "SUBJECT_MATERIAL_UPDATED",
        targetType: "SubjectMaterial",
        targetId: materialId,
        beforeState: {
          title: existing.title,
          topic: existing.topic,
          normalizedUrl: existing.normalizedUrl,
          accessStatus: existing.accessStatus,
        },
        afterState: {
          title: next.title,
          topic: next.topic,
          normalizedUrl: next.normalizedUrl,
          accessStatus: next.accessStatus,
        },
        ipAddress,
      },
      tx
    );

    return next;
  });

  return NextResponse.json({
    material: {
      id: updated.id,
      subjectId: updated.subjectId,
      title: updated.title,
      topic: updated.topic,
      description: updated.description,
      driveUrl: updated.driveUrl,
      normalizedUrl: updated.normalizedUrl,
      driveResourceId: updated.driveResourceId,
      resourceType: updated.resourceType,
      accessStatus: updated.accessStatus,
      accessCheckedAt: updated.accessCheckedAt,
      requirePublicLink: updated.requirePublicLink,
      uploadedByTeacher: updated.uploadedByTeacher,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
    accessWarning,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; materialId: string }> }
) {
  const { id, materialId } = await context.params;
  const instructor = await requireSubjectInstructor(id);
  if (!instructor.ok) {
    return instructor.response;
  }

  const { user, subject } = instructor.data;
  if (subject.isArchived) {
    return jsonError(
      "Cannot delete materials on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (!UUID_REGEX.test(materialId)) {
    return jsonError("Learning material not found.", 404, "ERR_NOT_FOUND");
  }

  const existing = await db.subjectMaterial.findUnique({
    where: { id: materialId },
  });
  if (!existing || existing.subjectId !== id) {
    return jsonError("Learning material not found.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.subjectMaterial.delete({
      where: { id: materialId },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: id,
        action: "SUBJECT_MATERIAL_DELETED",
        targetType: "SubjectMaterial",
        targetId: materialId,
        beforeState: {
          title: existing.title,
          topic: existing.topic,
          normalizedUrl: existing.normalizedUrl,
        },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
