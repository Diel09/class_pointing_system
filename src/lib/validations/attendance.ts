import { z } from "zod";

const latitudeSchema = z
  .number({ invalid_type_error: "Latitude must be a number." })
  .finite()
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.");

const longitudeSchema = z
  .number({ invalid_type_error: "Longitude must be a number." })
  .finite()
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.");

const accuracySchema = z
  .number({ invalid_type_error: "GPS accuracy must be a number." })
  .finite()
  .min(0, "GPS accuracy cannot be negative.")
  .max(10_000, "GPS accuracy reading is invalid.");

export const createSessionSchema = z.object({
  teacherLat: latitudeSchema,
  teacherLng: longitudeSchema,
  teacherAccuracyM: accuracySchema,
  radiusMeters: z.number().int().min(15).max(500).default(50),
  qrRotationSeconds: z.number().int().min(10).max(15).default(12),
  presentWindowMinutes: z.number().int().min(1).max(180).default(15),
  lateWindowMinutes: z.number().int().min(0).max(240).default(30),
  presentPoints: z.number().int().min(0).max(1000).default(10),
  latePoints: z.number().int().min(0).max(1000).default(5),
});

export const updateSessionLocationSchema = z.object({
  teacherLat: latitudeSchema,
  teacherLng: longitudeSchema,
  teacherAccuracyM: accuracySchema,
});

export const checkInSchema = z.object({
  qrPayload: z.string().trim().min(1, "QR payload is required.").max(256),
  studentLat: latitudeSchema,
  studentLng: longitudeSchema,
  studentAccuracyM: accuracySchema,
  mirrorToken: z.string().max(512).nullable().optional(),
});

export const overrideAttendanceSchema = z.object({
  enrollmentId: z.string().uuid("Invalid student enrollment ID."),
  status: z.enum(["PRESENT", "LATE", "EXCUSED", "ABSENT"]),
  reason: z
    .string()
    .trim()
    .min(2, "Override reason must be at least 2 characters.")
    .max(300, "Override reason must be 300 characters or fewer."),
});
