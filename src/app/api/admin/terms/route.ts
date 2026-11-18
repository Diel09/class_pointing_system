import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireAuth, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { adminCreateTermSchema } from "@/lib/validations/auth";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const terms = await db.academicTerm.findMany({
    orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
    include: {
      _count: {
        select: { subjects: true },
      },
    },
  });

  return NextResponse.json({ terms });
}

export async function POST(request: Request) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = adminCreateTermSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid academic term payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  if (parsed.data.endDate <= parsed.data.startDate) {
    return jsonError(
      "End date must be after start date.",
      400,
      "ERR_INVALID_DATES"
    );
  }

  try {
    const term = await db.$transaction(async (tx) => {
      if (parsed.data.isActive) {
        await tx.academicTerm.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }

      const created = await tx.academicTerm.create({
        data: {
          name: parsed.data.name,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          isActive: parsed.data.isActive,
        },
      });

      await recordAuditLog(
        {
          actorUserId: roleCheck.data.id,
          action: "ACADEMIC_TERM_CREATED",
          targetType: "AcademicTerm",
          targetId: created.id,
          afterState: {
            name: created.name,
            isActive: created.isActive,
          },
          ipAddress: getClientIp(request),
        },
        tx
      );

      return created;
    });

    return NextResponse.json({ term }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        "An academic term with this name already exists.",
        409,
        "ERR_TERM_EXISTS"
      );
    }
    console.error("Create term error:", error);
    return jsonError("Failed to create academic term.", 500, "ERR_INTERNAL");
  }
}
