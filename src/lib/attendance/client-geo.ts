export interface GeoPositionReading {
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: number;
}

export type GeoCaptureErrorCode =
  | "UNSUPPORTED"
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT";

export class GeoCaptureError extends Error {
  readonly code: GeoCaptureErrorCode;

  constructor(code: GeoCaptureErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Captures a fresh high-accuracy browser GPS reading for on-demand attendance verification.
 */
export function captureCurrentPosition(
  timeoutMs = 10_000
): Promise<GeoPositionReading> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      reject(
        new GeoCaptureError(
          "UNSUPPORTED",
          "Geolocation is not supported by this browser."
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: Date.now(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new GeoCaptureError(
              "PERMISSION_DENIED",
              "Location permission denied. Allow location access in your browser settings and retry."
            )
          );
          return;
        }
        if (err.code === err.TIMEOUT) {
          reject(
            new GeoCaptureError(
              "TIMEOUT",
              "GPS request timed out. Move near a window or open area and try again."
            )
          );
          return;
        }
        reject(
          new GeoCaptureError(
            "POSITION_UNAVAILABLE",
            "Unable to determine your GPS position right now. Check that device Location Services are turned on."
          )
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: timeoutMs,
      }
    );
  });
}
