import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectInstructor,
  requireSubjectMember,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import {
  parseGoogleDriveUrl,
  verifyGoogleDriveLinkAccess,
} from "@/lib/submissions/google-drive-link";
import { createSubjectMaterialSchema } from "@/lib/validations/subject";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const materials =
    typeof db.subjectMaterial?.findMany === "function"
      ? await db.subjectMaterial.findMany({
          where: { subjectId: id },
          orderBy: { createdAt: "desc" },
          include: {
            uploadedByTeacher: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        })
      : [];

  return NextResponse.json({
    materials: materials.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      title: item.title,
      topic: item.topic,
      description: item.description,
      driveUrl: item.driveUrl,
      normalizedUrl: item.normalizedUrl,
      driveResourceId: item.driveResourceId,
      resourceType: item.resourceType,
      accessStatus: item.accessStatus,
      accessCheckedAt: item.accessCheckedAt,
      requirePublicLink: item.requirePublicLink,
      uploadedByTeacher: item.uploadedByTeacher,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const instructor = await requireSubjectInstructor(id);
  if (!instructor.ok) {
    return instructor.response;
  }

  const { user, subject } = instructor.data;
  if (subject.isArchived) {
    return jsonError(
      "Cannot post materials on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createSubjectMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid learning material input.",
      400,
      "ERR_VALIDATION"
    );
  }

  const linkParsed = parseGoogleDriveUrl(parsed.data.driveUrl);
  if (!linkParsed.ok) {
    return jsonError(linkParsed.error, 400, "ERR_VALIDATION");
  }

  const requirePublicLink = parsed.data.requirePublicLink ?? true;
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

  const persistedAccessStatus =
    accessResult.accessStatus === "PRIVATE_OR_RESTRICTED"
      ? "PRIVATE_OR_RESTRICTED"
      : accessResult.accessStatus === "PUBLIC_VERIFIED"
      ? "PUBLIC_VERIFIED"
      : "UNVERIFIED";

  const topic = parsed.data.topic?.trim() || null;
  const description = parsed.data.description?.trim() || null;
  const ipAddress = getClientIp(request);

  const created = await db.$transaction(async (tx) => {
    const material = await tx.subjectMaterial.create({
      data: {
        subjectId: id,
        uploadedByTeacherId: user.id,
        title: parsed.data.title,
        topic,
        description,
        driveUrl: linkParsed.data.originalUrl,
        normalizedUrl: linkParsed.data.normalizedUrl,
        driveResourceId: linkParsed.data.resourceId,
        resourceType: linkParsed.data.resourceType,
        accessStatus: persistedAccessStatus,
        accessCheckedAt: accessResult.checkedAt,
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
        action: "SUBJECT_MATERIAL_CREATED",
        targetType: "SubjectMaterial",
        targetId: material.id,
        afterState: {
          title: material.title,
          topic: material.topic,
          normalizedUrl: material.normalizedUrl,
          resourceType: material.resourceType,
          accessStatus: material.accessStatus,
        },
        ipAddress,
      },
      tx
    );

    return material;
  });

  const enrollments =
    typeof db.subjectEnrollment?.findMany === "function"
      ? await db.subjectEnrollment.findMany({
          where: { subjectId: id },
          select: { studentId: true },
        })
      : [];

  if (enrollments.length > 0) {
    await dispatchNotifications(
      enrollments.map((enr) => ({
        userId: enr.studentId,
        subjectId: id,
        type: "MATERIAL_POSTED" as const,
        title: `New Learning Material (${subject.code})`,
        body: `${user.fullName} posted "${created.title}"${
          created.topic ? ` (${created.topic})` : ""
        }.`,
        linkUrl: `/subjects/${id}/materials`,
      }))
    );
  }

  return NextResponse.json(
    {
      material: {
        id: created.id,
        subjectId: created.subjectId,
        title: created.title,
        topic: created.topic,
        description: created.description,
        driveUrl: created.driveUrl,
        normalizedUrl: created.normalizedUrl,
        driveResourceId: created.driveResourceId,
        resourceType: created.resourceType,
        accessStatus: created.accessStatus,
        accessCheckedAt: created.accessCheckedAt,
        requirePublicLink: created.requirePublicLink,
        uploadedByTeacher: created.uploadedByTeacher,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      accessWarning:
        persistedAccessStatus === "UNVERIFIED"
          ? accessResult.reason ??
            "Could not automatically verify public access; double-check your Drive sharing settings."
          : null,
    },
    { status: 201 }
  );
}
