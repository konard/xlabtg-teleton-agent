/**
 * AUDIT-L2: Error responses must not leak workspace absolute paths.
 * Unit tests verify that WorkspaceSecurityError responses return a generic
 * message and do not include /home/, /tmp/, or C:\ substrings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(),
}));

vi.mock("../../workspace/validator.js", () => ({
  validateReadPath: vi.fn(),
  validatePath: vi.fn(),
  validateWritePath: vi.fn(),
  validateDirectory: vi.fn(),
  WorkspaceSecurityError: class WorkspaceSecurityError extends Error {
    constructor(
      message: string,
      public readonly attemptedPath: string
    ) {
      super(message);
      this.name = "WorkspaceSecurityError";
    }
  },
}));

vi.mock("../../workspace/paths.js", () => ({
  WORKSPACE_ROOT: "/tmp/test-workspace",
}));

vi.mock("../../utils/errors.js", () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  validateReadPath,
  validateWritePath,
  validatePath,
  validateDirectory,
  WorkspaceSecurityError,
} from "../../workspace/validator.js";
import { createLogger } from "../../utils/logger.js";
import { createWorkspaceRoutes } from "../routes/workspace.js";
import type { WebUIServerDeps } from "../types.js";

const ABSOLUTE_PATH_RE = /\/home\/|\/tmp\/|C:\\/;
const GENERIC_ERROR = "Workspace path is not allowed";

describe("AUDIT-L2: workspace routes do not leak absolute paths in error responses", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/workspace", createWorkspaceRoutes({} as WebUIServerDeps));
  });

  function makeSecurityError(msg: string, path: string) {
    return new WorkspaceSecurityError(msg, path);
  }

  it("GET /raw: returns generic 403 when path is outside workspace", async () => {
    vi.mocked(validateReadPath).mockImplementation(() => {
      throw makeSecurityError(
        "Access denied: Path '/home/alice/secret' is outside the workspace.",
        "/home/alice/secret"
      );
    });

    const res = await app.request("/workspace/raw?path=/home/alice/secret");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expect(body.error).not.toMatch(ABSOLUTE_PATH_RE);
  });

  it("GET /read: returns generic 403 and does not leak /home/ paths", async () => {
    vi.mocked(validateReadPath).mockImplementation(() => {
      throw makeSecurityError(
        "File not found: '/home/user/outside.txt' does not exist in workspace.",
        "/home/user/outside.txt"
      );
    });

    const res = await app.request("/workspace/read?path=/home/user/outside.txt");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expect(body.error).not.toMatch(ABSOLUTE_PATH_RE);
  });

  it("POST /write: returns generic 403 and does not leak /tmp/ paths", async () => {
    vi.mocked(validateWritePath).mockImplementation(() => {
      throw makeSecurityError(
        "Access denied: Path '/tmp/evil' is outside the workspace.",
        "/tmp/evil"
      );
    });

    const res = await app.request("/workspace/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/evil", content: "x" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expect(body.error).not.toMatch(ABSOLUTE_PATH_RE);
  });

  it("GET /read: returns generic 403 and does not leak C:\\ paths", async () => {
    vi.mocked(validateReadPath).mockImplementation(() => {
      throw makeSecurityError(
        "Access denied: Path 'C:\\Windows\\System32\\evil.txt' is outside the workspace.",
        "C:\\Windows\\System32\\evil.txt"
      );
    });

    const res = await app.request("/workspace/read?path=C%3A%5CWindows%5CSystem32%5Cevil.txt");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expect(body.error).not.toMatch(ABSOLUTE_PATH_RE);
  });

  it("GET /read: returns generic 403 and not the internal file-not-found message", async () => {
    vi.mocked(validateReadPath).mockImplementation(() => {
      throw makeSecurityError(
        "File not found: '/home/user/private/data.txt' does not exist in workspace.",
        "/home/user/private/data.txt"
      );
    });

    const res = await app.request("/workspace/read?path=private%2Fdata.txt");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe(GENERIC_ERROR);
    expect(body.error).not.toMatch(ABSOLUTE_PATH_RE);
    expect(body.error).not.toContain("File not found");
  });
});
