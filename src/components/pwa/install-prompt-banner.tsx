"use client";

import { Download, Share, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_STORAGE_KEY = "classpulse.pwa.install.dismissed";

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function isIosSafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

/**
 * Non-intrusive PWA install banner for Android/Desktop (beforeinstallprompt)
 * and iOS Safari (Add to Home Screen guidance for Web Push support).
 */
export function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandaloneMode()) {
      return;
    }

    try {
      const wasDismissed = window.localStorage.getItem(DISMISS_STORAGE_KEY);
      if (wasDismissed === "1") {
        return;
      }
    } catch {
      // Ignore storage failures in restricted contexts.
    }

    setDismissed(false);

    if (isIosSafariBrowser()) {
      setShowIosGuide(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIosGuide(false);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  function handleDismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
        setDismissed(true);
      }
    } finally {
      setInstalling(false);
    }
  }

  if (dismissed || (!deferredPrompt && !showIosGuide)) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Install Puento app"
      className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-xs text-indigo-950 flex items-start justify-between gap-3"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <p className="font-bold text-indigo-950">
            Install Puento to Your Home Screen
          </p>
          {deferredPrompt ? (
            <p className="text-indigo-800">
              Launch faster in standalone mode for QR check-ins and instant push
              alerts.
            </p>
          ) : (
            <p className="text-indigo-800 inline-flex flex-wrap items-center gap-1">
              <span>On iOS Safari, tap</span>
              <Share className="h-3.5 w-3.5 inline text-indigo-700" />
              <span className="font-semibold">Share</span>
              <span>&rarr;</span>
              <span className="font-semibold">Add to Home Screen</span>
              <span>to enable Web Push alerts and full-screen mode.</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {deferredPrompt && (
          <button
            type="button"
            disabled={installing}
            onClick={() => void handleInstallClick()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{installing ? "Installing..." : "Install App"}</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          className="rounded-lg p-1 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
