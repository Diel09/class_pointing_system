import {
  CacheFirst,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface Window {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

interface SwPushEvent extends Event {
  data: {
    json: () => unknown;
    text: () => string;
  } | null;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SwNotificationClickEvent extends Event {
  notification: {
    close: () => void;
    data?: { linkUrl?: string } | null;
  };
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SwClient {
  url: string;
  focus?: () => Promise<SwClient>;
  navigate?: (url: string) => Promise<SwClient | null>;
}

interface SwGlobalScope {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  location: Location;
  registration: {
    showNotification: (
      title: string,
      options?: {
        body?: string;
        icon?: string;
        badge?: string;
        tag?: string;
        data?: { linkUrl: string };
      }
    ) => Promise<void>;
  };
  clients: {
    matchAll: (options?: {
      type?: "window" | "worker" | "sharedworker" | "all";
      includeUncontrolled?: boolean;
    }) => Promise<SwClient[]>;
    openWindow?: (url: string) => Promise<SwClient | null>;
  };
  addEventListener: (
    type: string,
    listener: (event: Event) => void
  ) => void;
}

const swSelf = self as unknown as SwGlobalScope;

// Cache static assets only; let authenticated App Router navigations, RSC
// prefetches, and /api/* requests go straight to the network natively.
const staticAssetCaching: RuntimeCaching[] = [
  {
    matcher: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
    handler: new CacheFirst({
      cacheName: "google-fonts-webfonts",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 4,
          maxAgeSeconds: 31_536_000,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
    handler: new StaleWhileRevalidate({
      cacheName: "google-fonts-stylesheets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 4,
          maxAgeSeconds: 604_800,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-font-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 4,
          maxAgeSeconds: 604_800,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-image-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 2_592_000,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /\/_next\/static.+\.js$/i,
    handler: new CacheFirst({
      cacheName: "next-static-js-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 86_400,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /\/_next\/image\?url=.+$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "next-image",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 64,
          maxAgeSeconds: 86_400,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    matcher: /\.(?:css|less)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "static-style-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 32,
          maxAgeSeconds: 86_400,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: staticAssetCaching,
});

serwist.setCatchHandler(async () => Response.error());
serwist.addEventListeners();

swSelf.addEventListener("push", (rawEvent) => {
  const event = rawEvent as SwPushEvent;
  if (!event.data) return;

  let title = "Puento Notification";
  let body = "You have a new update.";
  let linkUrl = "/dashboard";
  let tag = "puento-alert";

  try {
    const payload = event.data.json() as {
      title?: string;
      body?: string;
      linkUrl?: string;
      tag?: string;
    };
    if (payload.title) title = payload.title;
    if (payload.body) body = payload.body;
    if (payload.linkUrl) linkUrl = payload.linkUrl;
    if (payload.tag) tag = payload.tag;
  } catch {
    const text = event.data.text();
    if (text) body = text;
  }

  event.waitUntil(
    swSelf.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag,
      data: { linkUrl },
    })
  );
});

swSelf.addEventListener("notificationclick", (rawEvent) => {
  const event = rawEvent as SwNotificationClickEvent;
  event.notification.close();

  const rawLink = event.notification.data?.linkUrl || "/dashboard";
  const targetUrl = new URL(rawLink, swSelf.location.origin).href;

  event.waitUntil(
    swSelf.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(swSelf.location.origin) && client.focus) {
            await client.focus();
            if (client.navigate) {
              await client.navigate(targetUrl);
            }
            return;
          }
        }
        if (swSelf.clients.openWindow) {
          await swSelf.clients.openWindow(targetUrl);
        }
      })
  );
});
