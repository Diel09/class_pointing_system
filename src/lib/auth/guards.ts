import type {
  AttendanceSession,
  Subject,
  SubjectEnrollment,
  UserRole,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, type AuthenticatedUser } from "./session";

export type GuardResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

/**
 * Builds a consistent JSON error response for API route handlers.
 */
export function jsonError(
  message: string,
  status: number,
  code?: string
): NextResponse {
  return NextResponse.json(
    code ? { error: message, code } : { error: message },
    { status }
  );
}

/**
 * Ensures the request has a valid, active authenticated user session.
 */
export async function requireAuth(): Promise<GuardResult<AuthenticatedUser>> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: jsonError("Authentication required.", 401, "ERR_UNAUTHORIZED"),
    };
  }
  return { ok: true, data: user };
}

/**
 * Ensures the authenticated user holds one of the allowed roles.
 */
export async function requireRole(
  allowedRoles: UserRole[]
): Promise<GuardResult<AuthenticatedUser>> {
  const authResult = await requireAuth();
  if (!authResult.ok) {
    return authResult;
  }
  if (!allowedRoles.includes(authResult.data.role)) {
    return {
      ok: false,
      response: jsonError(
        "You do not have permission to access this resource.",
        403,
        "ERR_FORBIDDEN"
      ),
    };
  }
  return authResult;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireSubjectForRoles(
  subjectId: string,
  allowedRoles: UserRole[]
): Promise<GuardResult<{ user: AuthenticatedUser; subject: Subject }>> {
  const roleResult = await requireRole(allowedRoles);
  if (!roleResult.ok) {
    return roleResult;
  }

  if (!UUID_REGEX.test(subjectId)) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const subject = await db.subject.findUnique({
    where: { id: subjectId },
  });
  if (!subject) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }
  if (
    roleResult.data.role === "TEACHER" &&
    subject.teacherId !== roleResult.data.id
  ) {
    return {
      ok: false,
      response: jsonError(
        "You do not own this subject.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      ),
    };
  }

  return { ok: true, data: { user: roleResult.data, subject } };
}

async function isUserSubjectCoTeacher(
  subjectId: string,
  userId: string
): Promise<boolean> {
  if (typeof db.subjectCoTeacher?.findUnique !== "function") {
    return false;
  }
  const coTeacher = await db.subjectCoTeacher.findUnique({
    where: {
      subjectId_teacherId: {
        subjectId,
        teacherId: userId,
      },
    },
    select: { id: true },
  });
  return Boolean(coTeacher);
}

/**
 * Ensures the caller is a TEACHER who owns the specified subject.
 */
export async function requireTeacherSubjectOwner(
  subjectId: string
): Promise<GuardResult<{ user: AuthenticatedUser; subject: Subject }>> {
  return requireSubjectForRoles(subjectId, ["TEACHER"]);
}

/**
 * Ensures the caller is a TEACHER who is either the primary owner or an assigned co-teacher of the subject.
 */
export async function requireSubjectInstructor(
  subjectId: string
): Promise<
  GuardResult<{
    user: AuthenticatedUser;
    subject: Subject;
    isOwner: boolean;
    isCoTeacher: boolean;
  }>
> {
  const roleResult = await requireRole(["TEACHER"]);
  if (!roleResult.ok) {
    return roleResult;
  }

  if (!UUID_REGEX.test(subjectId)) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const subject = await db.subject.findUnique({
    where: { id: subjectId },
  });
  if (!subject) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const isOwner = subject.teacherId === roleResult.data.id;
  const isCoTeacher = isOwner
    ? false
    : await isUserSubjectCoTeacher(subject.id, roleResult.data.id);

  if (!isOwner && !isCoTeacher) {
    return {
      ok: false,
      response: jsonError(
        "You do not have instructor access to this subject.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      ),
    };
  }

  return {
    ok: true,
    data: {
      user: roleResult.data,
      subject,
      isOwner,
      isCoTeacher,
    },
  };
}

/**
 * Ensures the caller is either the TEACHER who owns the subject or an ADMIN.
 */
export async function requireSubjectOwnerOrAdmin(
  subjectId: string
): Promise<GuardResult<{ user: AuthenticatedUser; subject: Subject }>> {
  return requireSubjectForRoles(subjectId, ["TEACHER", "ADMIN"]);
}

/**
 * Ensures the caller is the owning teacher, a co-teacher, an enrolled student, or an admin.
 */
export async function requireSubjectMember(subjectId: string): Promise<
  GuardResult<{
    user: AuthenticatedUser;
    subject: Subject;
    enrollment: SubjectEnrollment | null;
    isOwner?: boolean;
    isCoTeacher?: boolean;
  }>
> {
  const authResult = await requireAuth();
  if (!authResult.ok) {
    return authResult;
  }
  const user = authResult.data;

  if (!UUID_REGEX.test(subjectId)) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const subject = await db.subject.findUnique({
    where: { id: subjectId },
  });
  if (!subject) {
    return {
      ok: false,
      response: jsonError("Subject not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  if (user.role === "ADMIN") {
    return {
      ok: true,
      data: {
        user,
        subject,
        enrollment: null,
        isOwner: false,
        isCoTeacher: false,
      },
    };
  }

  if (user.role === "TEACHER") {
    const isOwner = subject.teacherId === user.id;
    const isCoTeacher = isOwner
      ? false
      : await isUserSubjectCoTeacher(subject.id, user.id);

    if (!isOwner && !isCoTeacher) {
      return {
        ok: false,
        response: jsonError(
          "You do not have access to this subject.",
          403,
          "ERR_SUBJECT_FORBIDDEN"
        ),
      };
    }
    return {
      ok: true,
      data: {
        user,
        subject,
        enrollment: null,
        isOwner,
        isCoTeacher,
      },
    };
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: {
      subjectId_studentId: {
        subjectId: subject.id,
        studentId: user.id,
      },
    },
  });
  if (!enrollment) {
    return {
      ok: false,
      response: jsonError(
        "You are not enrolled in this subject.",
        403,
        "ERR_NOT_ENROLLED"
      ),
    };
  }

  return {
    ok: true,
    data: {
      user,
      subject,
      enrollment,
      isOwner: false,
      isCoTeacher: false,
    },
  };
}

/**
 * Ensures the caller is a TEACHER (owner or co-teacher) of the subject associated with an attendance session.
 */
export async function requireTeacherSessionOwner(sessionId: string): Promise<
  GuardResult<{
    user: AuthenticatedUser;
    session: AttendanceSession;
    subject: Subject;
  }>
> {
  const roleResult = await requireRole(["TEACHER"]);
  if (!roleResult.ok) {
    return roleResult;
  }

  if (!UUID_REGEX.test(sessionId)) {
    return {
      ok: false,
      response: jsonError("Attendance session not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const sessionWithSubject = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    include: { subject: true },
  });
  if (!sessionWithSubject) {
    return {
      ok: false,
      response: jsonError("Attendance session not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const { subject, ...session } = sessionWithSubject;
  const isOwner = subject.teacherId === roleResult.data.id;
  const isCoTeacher = isOwner
    ? false
    : await isUserSubjectCoTeacher(subject.id, roleResult.data.id);

  if (!isOwner && !isCoTeacher) {
    return {
      ok: false,
      response: jsonError(
        "You do not own this attendance session.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      ),
    };
  }

  return { ok: true, data: { user: roleResult.data, session, subject } };
}
