import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import {
  buildClassGradeSheetWorkbook,
  buildGradeSheetFilename,
  buildStudentGradeSheetWorkbook,
} from "@/lib/grading/grade-sheet-xlsx";
import { buildSubjectGradeSheetData } from "@/lib/grading/grade-sheet-service";

const uuidSchema = z.string().uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { searchParams } = new URL(request.url);
  const enrollmentIdParam = searchParams.get("enrollmentId");
  if (enrollmentIdParam && !uuidSchema.safeParse(enrollmentIdParam).success) {
    return jsonError("Invalid enrollmentId parameter.", 400, "ERR_VALIDATION");
  }

  const data = await buildSubjectGradeSheetData({
    subjectId: id,
    ...(enrollmentIdParam ? { enrollmentId: enrollmentIdParam } : {}),
  });

  if (!data) {
    return jsonError(
      enrollmentIdParam
        ? "Student enrollment not found in this subject."
        : "Subject not found.",
      404,
      enrollmentIdParam ? "ERR_ENROLLMENT_NOT_FOUND" : "ERR_NOT_FOUND"
    );
  }

  let workbookBytes: Uint8Array;
  let filename: string;

  if (enrollmentIdParam) {
    const targetStudent = data.students[0];
    if (!targetStudent) {
      return jsonError(
        "Student enrollment not found in this subject.",
        404,
        "ERR_ENROLLMENT_NOT_FOUND"
      );
    }
    workbookBytes = await buildStudentGradeSheetWorkbook(data, targetStudent);
    filename = buildGradeSheetFilename(data, targetStudent);
  } else {
    workbookBytes = await buildClassGradeSheetWorkbook(data);
    filename = buildGradeSheetFilename(data);
  }

  return new NextResponse(Buffer.from(workbookBytes), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
