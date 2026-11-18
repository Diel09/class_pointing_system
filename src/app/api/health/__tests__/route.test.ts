import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: queryRawMock,
  },
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it("returns 200 ok when database query succeeds", async () => {
    queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);
    const { GET } = await import("../route");

    const response = await GET();
    const body = (await response.json()) as { status: string; db: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
  });

  it("returns 503 error when database query fails", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("Connection refused"));
    const { GET } = await import("../route");

    const response = await GET();
    const body = (await response.json()) as { status: string; db: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("disconnected");
  });
});
