import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";

const fetchMock = vi.fn();

let tempHome: string;
let originalTeletonHome: string | undefined;
let webDownloadBinaryExecutor: typeof import("../download-binary.js").webDownloadBinaryExecutor;
let WEB_DOWNLOAD_BINARY_MAX_BYTES: typeof import("../../../../constants/limits.js").WEB_DOWNLOAD_BINARY_MAX_BYTES;

function makeContext(): ToolContext {
  return {
    bridge: {} as any,
    db: {} as any,
    chatId: "1",
    senderId: 1,
    isGroup: false,
    config: {} as any,
  };
}

function makeResponse(
  body: Uint8Array | string,
  headers: Record<string, string>,
  url = "https://example.com/file"
): Response {
  const response = new Response(body, {
    status: 200,
    statusText: "OK",
    headers,
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("webDownloadBinaryExecutor", () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    originalTeletonHome = process.env.TELETON_HOME;
    tempHome = mkdtempSync(join(tmpdir(), "teleton-web-download-"));
    process.env.TELETON_HOME = tempHome;

    ({ webDownloadBinaryExecutor } = await import("../download-binary.js"));
    ({ WEB_DOWNLOAD_BINARY_MAX_BYTES } = await import("../../../../constants/limits.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalTeletonHome === undefined) {
      delete process.env.TELETON_HOME;
    } else {
      process.env.TELETON_HOME = originalTeletonHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("downloads binary content to workspace downloads with an extension inferred from MIME type", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    fetchMock.mockResolvedValue(
      makeResponse(
        bytes,
        {
          "content-type": "image/jpeg",
          "content-length": String(bytes.byteLength),
        },
        "https://cdn.example.com/generated"
      )
    );

    const result = await webDownloadBinaryExecutor(
      { url: "https://cdn.example.com/generated" },
      makeContext()
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      filePath: string;
      relativePath: string;
      filename: string;
      mimeType: string;
      size: number;
    };
    expect(data.filename).toBe("generated.jpg");
    expect(data.relativePath).toBe(join("downloads", "generated.jpg"));
    expect(data.filePath).toBe(join(tempHome, "workspace", "downloads", "generated.jpg"));
    expect(data.mimeType).toBe("image/jpeg");
    expect(data.size).toBe(bytes.byteLength);
    expect(readFileSync(data.filePath)).toEqual(Buffer.from(bytes));
  });

  it("passes optional request headers to fetch", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fetchMock.mockResolvedValue(
      makeResponse(bytes, {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
      })
    );

    const result = await webDownloadBinaryExecutor(
      {
        url: "https://example.com/report",
        headers: {
          Authorization: "Bearer token",
          Accept: "application/pdf",
        },
      },
      makeContext()
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/report",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Accept: "application/pdf",
        }),
        redirect: "follow",
      })
    );
  });

  it("rejects non HTTP(S) URLs", async () => {
    const result = await webDownloadBinaryExecutor(
      { url: "ftp://example.com/file.jpg" },
      makeContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked URL scheme/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects text responses instead of saving them as binary downloads", async () => {
    fetchMock.mockResolvedValue(
      makeResponse("<html>not media</html>", {
        "content-type": "text/html; charset=utf-8",
      })
    );

    const result = await webDownloadBinaryExecutor(
      { url: "https://example.com/file.jpg" },
      makeContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unsupported MIME type: text\/html/);
    expect(existsSync(join(tempHome, "workspace", "downloads"))).toBe(false);
  });

  it("rejects responses larger than the 10 MB limit from Content-Length", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(new Uint8Array(), {
        "content-type": "application/pdf",
        "content-length": String(WEB_DOWNLOAD_BINARY_MAX_BYTES + 1),
      })
    );

    const result = await webDownloadBinaryExecutor(
      { url: "https://example.com/report.pdf" },
      makeContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds maximum download size/);
  });

  it("rejects streamed responses that exceed the 10 MB limit", async () => {
    fetchMock.mockResolvedValue(
      makeResponse(new Uint8Array(WEB_DOWNLOAD_BINARY_MAX_BYTES + 1), {
        "content-type": "application/octet-stream",
      })
    );

    const result = await webDownloadBinaryExecutor(
      { url: "https://example.com/archive.bin" },
      makeContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds maximum download size/);
  });
});
