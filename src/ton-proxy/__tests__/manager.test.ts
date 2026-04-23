import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "crypto";

// ── Stable temp dir for binary output ────────────────────────────────────────

const { tempBinDir } = vi.hoisted(() => {
  const { mkdtempSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const { tmpdir } = require("os") as typeof import("os");
  const dir = mkdtempSync(join(tmpdir(), "teleton-ton-proxy-test-"));
  return { tempBinDir: dir };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../workspace/paths.js", () => {
  const { join } = require("path") as typeof import("path");
  return { TELETON_ROOT: join(tempBinDir, "teleton") };
});

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** Binary name used by the current platform in checksums.json */
const PLATFORM_BINARY = (() => {
  const p = process.platform;
  const a = process.arch;
  const os = p === "linux" ? "linux" : p === "darwin" ? "darwin" : "windows";
  const arch = a === "arm64" ? "arm64" : "amd64";
  const ext = p === "win32" ? ".exe" : "";
  return `tonutils-proxy-cli-${os}-${arch}${ext}`;
})();

/**
 * Build a mock Response whose .url, .ok, .body, and Content-Length match the
 * given parameters.
 */
function mockResponse(opts: {
  url?: string;
  ok?: boolean;
  bytes?: Buffer;
  contentLength?: number | null;
  /** Override the checksums.json so install() can find a digest for PLATFORM_BINARY */
  fakeChecksumJson?: string;
}): Response {
  const bytes = opts.bytes ?? Buffer.from("fake-binary");
  const url =
    opts.url ?? "https://objects.githubusercontent.com/releases/tonutils-proxy-cli-linux-amd64";
  return {
    ok: opts.ok ?? true,
    url,
    status: opts.ok === false ? 404 : 200,
    statusText: opts.ok === false ? "Not Found" : "OK",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
    headers: {
      get: (name: string) =>
        name === "content-length"
          ? opts.contentLength !== undefined
            ? opts.contentLength === null
              ? null
              : String(opts.contentLength)
            : String(bytes.length)
          : null,
    },
  } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TonProxyManager.install()", () => {
  const chmodSyncMock = vi.fn();
  // Capture the real readFileSync before any module mocking replaces it
  let realReadFileSync: typeof import("fs").readFileSync;

  beforeEach(async () => {
    vi.resetModules();
    chmodSyncMock.mockReset();
    vi.restoreAllMocks();
    realReadFileSync = (await vi.importActual<typeof import("fs")>("fs")).readFileSync;
  });

  /**
   * Install a manager with a checksums.json that maps PLATFORM_BINARY to
   * the SHA-256 of `correctBytes`.
   */
  async function makeManager(correctBytes: Buffer) {
    const fakeDigest = createHash("sha256").update(correctBytes).digest("hex");
    const fakeChecksums = JSON.stringify({
      tag: "v1.8.3",
      binaries: { [PLATFORM_BINARY]: fakeDigest },
    });

    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      return {
        ...actual,
        chmodSync: chmodSyncMock,
        readFileSync: (path: unknown, ...args: unknown[]) => {
          if (typeof path === "string" && path.endsWith("checksums.json")) {
            return fakeChecksums;
          }
          return (realReadFileSync as (...a: unknown[]) => unknown)(path, ...args);
        },
      };
    });

    const { TonProxyManager } = await import("../manager.js");
    return new TonProxyManager({ enabled: true, port: 8080 });
  }

  // ── Correct binary passes ──────────────────────────────────────────────────

  it("calls chmodSync when checksum matches", async () => {
    const fakeBytes = Buffer.from("fake-correct-binary-content-for-test");
    const mgr = await makeManager(fakeBytes);

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({ bytes: fakeBytes }));

    await mgr.install();
    expect(chmodSyncMock).toHaveBeenCalledOnce();
  });

  // ── Checksum mismatch ──────────────────────────────────────────────────────

  it("throws on checksum mismatch before calling chmodSync", async () => {
    const correctBytes = Buffer.from("correct-bytes");
    const corruptBytes = Buffer.from("this-is-totally-not-the-real-binary");

    // Manager expects hash of correctBytes, but we serve corruptBytes
    const mgr = await makeManager(correctBytes);

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({ bytes: corruptBytes }));

    await expect(mgr.install()).rejects.toThrow(/checksum mismatch/i);
    expect(chmodSyncMock).not.toHaveBeenCalled();
  });

  // ── Oversized binary ───────────────────────────────────────────────────────

  it("throws when Content-Length exceeds 50 MB without calling chmodSync", async () => {
    const mgr = await makeManager(Buffer.from("any"));

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({ contentLength: 51 * 1024 * 1024 }));

    await expect(mgr.install()).rejects.toThrow(/Content-Length/);
    expect(chmodSyncMock).not.toHaveBeenCalled();
  });

  // ── Cross-domain redirect ──────────────────────────────────────────────────

  it("throws when download is redirected to an unexpected domain", async () => {
    const mgr = await makeManager(Buffer.from("any"));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ url: "https://evil.example.com/malicious-binary" }));

    await expect(mgr.install()).rejects.toThrow(/unexpected host/i);
    expect(chmodSyncMock).not.toHaveBeenCalled();
  });

  // ── HTTP failure ───────────────────────────────────────────────────────────

  it("throws when the download HTTP response is not ok", async () => {
    const mgr = await makeManager(Buffer.from("any"));

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({ ok: false }));

    await expect(mgr.install()).rejects.toThrow(/Download failed/i);
    expect(chmodSyncMock).not.toHaveBeenCalled();
  });
});
