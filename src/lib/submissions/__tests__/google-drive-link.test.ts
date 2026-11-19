import { describe, expect, it, vi } from "vitest";
import {
  parseGoogleDriveUrl,
  verifyGoogleDriveLinkAccess,
} from "@/lib/submissions/google-drive-link";

describe("parseGoogleDriveUrl", () => {
  it("normalizes Google Drive file, folder, open, and Google Docs/Sheets/Slides/Forms URLs", () => {
    const fileRes = parseGoogleDriveUrl(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing"
    );
    expect(fileRes).toEqual({
      ok: true,
      data: {
        originalUrl:
          "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing",
        normalizedUrl:
          "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
        resourceId: "1AbCdEfGhIjKlMnOpQrStUvWxYz12345",
        resourceType: "FILE",
      },
    });

    const folderRes = parseGoogleDriveUrl(
      "https://drive.google.com/drive/u/1/folders/1FolderId_9876543210?usp=drive_link"
    );
    expect(folderRes).toMatchObject({
      ok: true,
      data: {
        normalizedUrl:
          "https://drive.google.com/drive/folders/1FolderId_9876543210",
        resourceId: "1FolderId_9876543210",
        resourceType: "FOLDER",
      },
    });

    const openRes = parseGoogleDriveUrl(
      "https://drive.google.com/open?id=1OpenFileId_1234567890"
    );
    expect(openRes).toMatchObject({
      ok: true,
      data: {
        normalizedUrl:
          "https://drive.google.com/file/d/1OpenFileId_1234567890/view",
        resourceType: "FILE",
      },
    });

    const docRes = parseGoogleDriveUrl(
      "https://docs.google.com/document/d/1DocId_1234567890/edit?usp=sharing"
    );
    expect(docRes).toMatchObject({
      ok: true,
      data: {
        normalizedUrl:
          "https://docs.google.com/document/d/1DocId_1234567890/view",
        resourceType: "DOCUMENT",
      },
    });

    const formRes = parseGoogleDriveUrl(
      "https://docs.google.com/forms/d/e/1FAIpQLSf_1234567890/viewform"
    );
    expect(formRes).toMatchObject({
      ok: true,
      data: {
        normalizedUrl:
          "https://docs.google.com/forms/d/e/1FAIpQLSf_1234567890/viewform",
        resourceType: "FORM",
      },
    });
  });

  it("rejects non-Google-Drive domains, http://, credentials, and Drive home URLs", () => {
    expect(
      parseGoogleDriveUrl("https://onedrive.live.com/?id=1234567890").ok
    ).toBe(false);
    expect(
      parseGoogleDriveUrl("https://www.dropbox.com/s/abcdef123456/work.pdf").ok
    ).toBe(false);
    expect(
      parseGoogleDriveUrl(
        "http://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view"
      ).ok
    ).toBe(false);
    expect(
      parseGoogleDriveUrl(
        "https://user:pass@drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view"
      ).ok
    ).toBe(false);
    expect(
      parseGoogleDriveUrl("https://drive.google.com/drive/my-drive").ok
    ).toBe(false);
    expect(parseGoogleDriveUrl("https://127.0.0.1/file/d/123").ok).toBe(false);
  });
});

describe("verifyGoogleDriveLinkAccess", () => {
  it("returns PUBLIC_VERIFIED when Drive returns 200 without login markers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Assignment.pdf - Google Drive</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    const res = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      fetchMock as unknown as typeof fetch
    );
    expect(res.accessStatus).toBe("PUBLIC_VERIFIED");
  });

  it("returns PRIVATE_OR_RESTRICTED when Drive redirects to accounts.google.com", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location:
            "https://accounts.google.com/ServiceLogin?service=wise&passive=1209600",
        },
      })
    );

    const res = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      fetchMock as unknown as typeof fetch
    );
    expect(res.accessStatus).toBe("PRIVATE_OR_RESTRICTED");
  });

  it("returns PRIVATE_OR_RESTRICTED when 200 HTML contains ServiceLogin redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><script>window.location="https://accounts.google.com/v3/signin"</script></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        }
      )
    );

    const res = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      fetchMock as unknown as typeof fetch
    );
    expect(res.accessStatus).toBe("PRIVATE_OR_RESTRICTED");
  });

  it("returns NOT_FOUND on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    const res = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      fetchMock as unknown as typeof fetch
    );
    expect(res.accessStatus).toBe("NOT_FOUND");
  });

  it("returns UNVERIFIED on unexpected redirect host or network error", async () => {
    const badRedirectFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/probe" },
      })
    );
    const redirectRes = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      badRedirectFetch as unknown as typeof fetch
    );
    expect(redirectRes.accessStatus).toBe("UNVERIFIED");
    expect(badRedirectFetch).toHaveBeenCalledTimes(1);

    const errorFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const errorRes = await verifyGoogleDriveLinkAccess(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
      errorFetch as unknown as typeof fetch
    );
    expect(errorRes.accessStatus).toBe("UNVERIFIED");
  });
});
