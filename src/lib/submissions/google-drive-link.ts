export type GoogleDriveResourceType =
  | "FILE"
  | "FOLDER"
  | "DOCUMENT"
  | "SPREADSHEET"
  | "PRESENTATION"
  | "FORM";

export interface ParsedGoogleDriveLink {
  originalUrl: string;
  normalizedUrl: string;
  resourceId: string;
  resourceType: GoogleDriveResourceType;
}

export type DriveLinkCheckStatus =
  | "PUBLIC_VERIFIED"
  | "UNVERIFIED"
  | "PRIVATE_OR_RESTRICTED"
  | "NOT_FOUND";

export interface DriveLinkAccessResult {
  accessStatus: DriveLinkCheckStatus;
  checkedAt: Date;
  reason?: string;
}

const RESOURCE_ID_REGEX = /^[A-Za-z0-9_-]{10,120}$/;

const ALLOWED_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

function isSafeGoogleRedirectHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "google.com" ||
    lower.endsWith(".google.com") ||
    lower.endsWith(".googleusercontent.com")
  );
}

/**
 * Parses, validates, and normalizes a Google Drive or Google Docs/Sheets/Slides/Forms share link.
 * Rejects non-HTTPS URLs, embedded credentials, non-Google-Drive hosts, and Drive home URLs.
 */
export function parseGoogleDriveUrl(
  rawUrl: string
):
  | { ok: true; data: ParsedGoogleDriveLink }
  | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "Please enter a Google Drive link." };
  }
  if (trimmed.length > 2048) {
    return { ok: false, error: "Google Drive link is too long." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: "Invalid URL. Paste a complete https://drive.google.com/... link.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Google Drive links must use https://.",
    };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "Invalid Google Drive URL." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_DRIVE_HOSTS.has(host)) {
    return {
      ok: false,
      error:
        "Only Google Drive links (drive.google.com or docs.google.com) are accepted.",
    };
  }

  const path = parsed.pathname;

  if (host === "drive.google.com") {
    // /file/d/<ID>/view or /u/0/file/d/<ID>/view
    const fileMatch =
      /^\/(?:u\/\d+\/)?file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
    if (fileMatch && RESOURCE_ID_REGEX.test(fileMatch[1]!)) {
      const resourceId = fileMatch[1]!;
      return {
        ok: true,
        data: {
          originalUrl: trimmed,
          normalizedUrl: `https://drive.google.com/file/d/${resourceId}/view`,
          resourceId,
          resourceType: "FILE",
        },
      };
    }

    // /drive/folders/<ID> or /drive/u/0/folders/<ID>
    const folderMatch =
      /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
    if (folderMatch && RESOURCE_ID_REGEX.test(folderMatch[1]!)) {
      const resourceId = folderMatch[1]!;
      return {
        ok: true,
        data: {
          originalUrl: trimmed,
          normalizedUrl: `https://drive.google.com/drive/folders/${resourceId}`,
          resourceId,
          resourceType: "FOLDER",
        },
      };
    }

    // /open?id=<ID>, /uc?id=<ID>, /folderview?id=<ID>
    if (
      path === "/open" ||
      path === "/uc" ||
      path === "/folderview" ||
      path === "/drive/open"
    ) {
      const idParam = parsed.searchParams.get("id")?.trim() ?? "";
      if (RESOURCE_ID_REGEX.test(idParam)) {
        const isFolder = path === "/folderview";
        return {
          ok: true,
          data: {
            originalUrl: trimmed,
            normalizedUrl: isFolder
              ? `https://drive.google.com/drive/folders/${idParam}`
              : `https://drive.google.com/file/d/${idParam}/view`,
            resourceId: idParam,
            resourceType: isFolder ? "FOLDER" : "FILE",
          },
        };
      }
    }

    return {
      ok: false,
      error:
        "Paste a direct Google Drive file or folder share link (e.g. https://drive.google.com/file/d/.../view).",
    };
  }

  // docs.google.com/(document|spreadsheets|presentation|forms)/d/[e/]<ID>/...
  const docsMatch =
    /^\/(?:u\/\d+\/)?(document|spreadsheets|presentation|forms)\/d\/(?:(e)\/)?([A-Za-z0-9_-]+)(?:\/|$)/.exec(
      path
    );
  if (docsMatch && RESOURCE_ID_REGEX.test(docsMatch[3]!)) {
    const kindSegment = docsMatch[1]!;
    const isPublishedForm = docsMatch[2] === "e";
    const resourceId = docsMatch[3]!;

    const resourceTypeMap: Record<string, GoogleDriveResourceType> = {
      document: "DOCUMENT",
      spreadsheets: "SPREADSHEET",
      presentation: "PRESENTATION",
      forms: "FORM",
    };

    const normalizedUrl =
      kindSegment === "forms"
        ? isPublishedForm
          ? `https://docs.google.com/forms/d/e/${resourceId}/viewform`
          : `https://docs.google.com/forms/d/${resourceId}/viewform`
        : `https://docs.google.com/${kindSegment}/d/${resourceId}/view`;

    return {
      ok: true,
      data: {
        originalUrl: trimmed,
        normalizedUrl,
        resourceId,
        resourceType: resourceTypeMap[kindSegment] ?? "DOCUMENT",
      },
    };
  }

  return {
    ok: false,
    error:
      "Paste a direct Google Drive or Google Docs/Sheets/Slides share link.",
  };
}

/**
 * Performs an unauthenticated HTTP probe against a normalized Google Drive URL
 * to detect whether the file is publicly viewable ("Anyone with the link"),
 * restricted/private (redirects to accounts.google.com or returns 401/403),
 * or missing (404/410).
 */
export async function verifyGoogleDriveLinkAccess(
  normalizedUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<DriveLinkAccessResult> {
  const checkedAt = new Date();
  let currentUrl = normalizedUrl;

  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "PuentoLinkVerifier/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            accessStatus: "UNVERIFIED",
            checkedAt,
            reason: "Redirect without location from Google Drive.",
          };
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return {
            accessStatus: "UNVERIFIED",
            checkedAt,
            reason: "Invalid redirect URL from Google Drive.",
          };
        }

        if (nextUrl.hostname.toLowerCase() === "accounts.google.com") {
          return {
            accessStatus: "PRIVATE_OR_RESTRICTED",
            checkedAt,
            reason:
              "This Google Drive link is restricted or private. In Google Drive, open Share -> General access -> select 'Anyone with the link'.",
          };
        }

        if (
          nextUrl.protocol !== "https:" ||
          !isSafeGoogleRedirectHost(nextUrl.hostname)
        ) {
          return {
            accessStatus: "UNVERIFIED",
            checkedAt,
            reason: "Unexpected redirect host while checking link.",
          };
        }

        currentUrl = nextUrl.toString();
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return {
          accessStatus: "PRIVATE_OR_RESTRICTED",
          checkedAt,
          reason:
            "This Google Drive link is restricted or private. In Google Drive, open Share -> General access -> select 'Anyone with the link'.",
        };
      }

      if (response.status === 404 || response.status === 410) {
        return {
          accessStatus: "NOT_FOUND",
          checkedAt,
          reason:
            "Google Drive item was not found (404). Verify that the link is complete and the file has not been deleted.",
        };
      }

      if (response.status === 200) {
        const contentType =
          response.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType.includes("text/html")) {
          const snippet = (await response.text()).slice(0, 16_384);
          if (
            snippet.includes("accounts.google.com/ServiceLogin") ||
            snippet.includes("accounts.google.com/v3/signin")
          ) {
            return {
              accessStatus: "PRIVATE_OR_RESTRICTED",
              checkedAt,
              reason:
                "This Google Drive link requires sign-in. In Google Drive, open Share -> General access -> select 'Anyone with the link'.",
            };
          }
        }
        return {
          accessStatus: "PUBLIC_VERIFIED",
          checkedAt,
        };
      }

      return {
        accessStatus: "UNVERIFIED",
        checkedAt,
        reason: `Google Drive returned HTTP ${response.status} while verifying access.`,
      };
    }

    return {
      accessStatus: "UNVERIFIED",
      checkedAt,
      reason: "Too many redirects while verifying Google Drive link.",
    };
  } catch {
    return {
      accessStatus: "UNVERIFIED",
      checkedAt,
      reason: "Could not reach Google Drive to verify public access right now.",
    };
  }
}
