import { describe, expect, it } from "vitest";
import {
  calculateHaversineDistanceMeters,
  evaluateGeofence,
} from "../geofence";

describe("attendance geofence & Haversine distance", () => {
  it("returns 0 meters for identical coordinates and accurate distance for nearby points", () => {
    const zeroDist = calculateHaversineDistanceMeters(
      14.5995,
      120.9842,
      14.5995,
      120.9842
    );
    expect(zeroDist).toBe(0);

    // ~0.001 degree latitude is ~111.19 meters
    const northDist = calculateHaversineDistanceMeters(
      14.5995,
      120.9842,
      14.6005,
      120.9842
    );
    expect(northDist).toBeGreaterThan(108);
    expect(northDist).toBeLessThan(115);
  });

  it("caps the student GPS accuracy tolerance buffer at 25 meters", () => {
    // ~70m north of anchor
    const targetLat = 14.5995 + 70 / 111_195;
    const resultAllowed = evaluateGeofence({
      teacherLat: 14.5995,
      teacherLng: 120.9842,
      studentLat: targetLat,
      studentLng: 120.9842,
      studentAccuracyM: 80, // capped to +25m => effectiveRadius = 75m
      radiusMeters: 50,
    });
    expect(resultAllowed.allowed).toBe(true);
    expect(resultAllowed.accuracyBufferMeters).toBe(25);
    expect(resultAllowed.effectiveRadiusMeters).toBe(75);

    // ~80m north should fail even though studentAccuracyM is 80m (buffer capped at 25m => 75m)
    const farLat = 14.5995 + 80 / 111_195;
    const resultBlocked = evaluateGeofence({
      teacherLat: 14.5995,
      teacherLng: 120.9842,
      studentLat: farLat,
      studentLng: 120.9842,
      studentAccuracyM: 80,
      radiusMeters: 50,
    });
    expect(resultBlocked.allowed).toBe(false);
    if (!resultBlocked.allowed) {
      expect(resultBlocked.code).toBe("ERR_OUT_OF_RANGE");
      expect(resultBlocked.effectiveRadiusMeters).toBe(75);
      expect(resultBlocked.distanceMeters).toBeGreaterThan(75);
    }
  });

  it("rejects GPS readings with accuracy worse than 100 meters", () => {
    const result = evaluateGeofence({
      teacherLat: 14.5995,
      teacherLng: 120.9842,
      studentLat: 14.5995,
      studentLng: 120.9842,
      studentAccuracyM: 125,
      radiusMeters: 50,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("ERR_LOW_GPS_ACCURACY");
    }
  });
});
