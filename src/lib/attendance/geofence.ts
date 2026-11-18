const EARTH_RADIUS_METERS = 6_371_000;

export const MAX_STUDENT_GPS_ACCURACY_METERS = 100;
export const ACCURACY_BUFFER_CAP_METERS = 25;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Computes great-circle distance in meters between two WGS84 coordinates using the Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) *
      Math.cos(rLat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export interface GeofenceInput {
  teacherLat: number;
  teacherLng: number;
  studentLat: number;
  studentLng: number;
  studentAccuracyM: number;
  radiusMeters: number;
}

export type GeofenceResult =
  | {
      allowed: true;
      distanceMeters: number;
      accuracyBufferMeters: number;
      effectiveRadiusMeters: number;
    }
  | {
      allowed: false;
      code: "ERR_LOW_GPS_ACCURACY" | "ERR_OUT_OF_RANGE";
      message: string;
      distanceMeters?: number;
      accuracyBufferMeters?: number;
      effectiveRadiusMeters?: number;
    };

/**
 * Evaluates whether a student's GPS reading passes accuracy and capped geofence distance rules.
 */
export function evaluateGeofence(input: GeofenceInput): GeofenceResult {
  if (
    !Number.isFinite(input.studentAccuracyM) ||
    input.studentAccuracyM < 0 ||
    input.studentAccuracyM > MAX_STUDENT_GPS_ACCURACY_METERS
  ) {
    return {
      allowed: false,
      code: "ERR_LOW_GPS_ACCURACY",
      message: `GPS accuracy (±${Math.round(
        input.studentAccuracyM
      )}m) exceeds the ${MAX_STUDENT_GPS_ACCURACY_METERS}m limit. Move near a window or ask your teacher for a manual override.`,
    };
  }

  const rawDistance = calculateHaversineDistanceMeters(
    input.teacherLat,
    input.teacherLng,
    input.studentLat,
    input.studentLng
  );
  const distanceMeters = Math.round(rawDistance * 100) / 100;
  const accuracyBufferMeters = Math.min(
    input.studentAccuracyM,
    ACCURACY_BUFFER_CAP_METERS
  );
  const effectiveRadiusMeters =
    Math.round((input.radiusMeters + accuracyBufferMeters) * 100) / 100;

  if (distanceMeters > effectiveRadiusMeters) {
    return {
      allowed: false,
      code: "ERR_OUT_OF_RANGE",
      message: `You are ${Math.round(distanceMeters)}m away from the classroom anchor (allowed effective radius: ${Math.round(effectiveRadiusMeters)}m).`,
      distanceMeters,
      accuracyBufferMeters,
      effectiveRadiusMeters,
    };
  }

  return {
    allowed: true,
    distanceMeters,
    accuracyBufferMeters,
    effectiveRadiusMeters,
  };
}
