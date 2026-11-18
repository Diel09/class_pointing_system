"use client";

import { useEffect } from "react";
import {
  getIndexedDbDeviceToken,
  setIndexedDbDeviceToken,
} from "@/lib/device/indexeddb";

/**
 * Keeps the server HTTP-only device_token cookie synchronized with an IndexedDB mirror.
 */
export function DeviceSync() {
  useEffect(() => {
    let cancelled = false;

    async function syncDeviceToken() {
      try {
        const mirrorToken = await getIndexedDbDeviceToken();
        const response = await fetch("/api/device/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mirrorToken }),
        });
        if (!response.ok || cancelled) {
          return;
        }
        const data = (await response.json()) as { mirrorToken?: string };
        if (data.mirrorToken && !cancelled) {
          await setIndexedDbDeviceToken(data.mirrorToken);
        }
      } catch {
        // Non-blocking background sync; Phase 2 check-ins re-verify server-side.
      }
    }

    void syncDeviceToken();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
