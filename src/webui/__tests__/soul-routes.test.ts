import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock filesystem operations (readFileSync, writeFileSync)
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock WORKSPACE_ROOT path
vi.mock("../../workspace/paths.js", () => ({
  WORKSPACE_ROOT: "/fake/workspace",
  TELETON_ROOT: "/fake/teleton",
  WORKSPACE_PATHS: {},
  ALLOWED_EXTENSIONS: {},
  MAX_FILE_SIZES: {},
}));

// Mock clearPromptCache to avoid side effects
vi.mock("../../soul/loader.js", () => ({
  clearPromptCache: vi.fn(),
}));

// Mock soul-versions service using an in-memory store
let mockVersions: Map<
  string,
  Array<{
    id: number;
    content: string;
    comment: string | null;
    created_at: string;
    filename: string;
  }>
> = new Map();
let nextVersionId = 1;

vi.mock("../../services/soul-versions.js", () => ({
  listVersions: vi.fn((filename: string) => {
    const versions = mockVersions.get(filename) ?? [];
    return versions.map((v) => ({
      id: v.id,
      filename: v.filename,
      comment: v.comment,
      created_at: v.created_at,
      content_length: v.content.length,
    }));
  }),
  getVersion: vi.fn((filename: string, id: number) => {
    const versions = mockVersions.get(filename) ?? [];
    return versions.find((v) => v.id === id) ?? null;
  }),
  saveVersion: vi.fn((filename: string, content: string, comment?: string) => {
    const id = nextVersionId++;
    const entry = {
      id,
      filename,
      content,
      comment: comment ?? null,
      created_at: new Date().toISOString(),
    };
    if (!mockVersions.has(filename)) {
      mockVersions.set(filename, []);
    }
    mockVersions.get(filename)!.push(entry);
    return {
      id,
      filename,
      comment: entry.comment,
      created_at: entry.created_at,
      content_length: content.length,
    };
  }),
  deleteVersion: vi.fn((filename: string, id: number) => {
    const versions = mockVersions.get(filename) ?? [];
    const idx = versions.findIndex((v) => v.id === id);
    if (idx === -1) return false;
    versions.splice(idx, 1);
    return true;
  }),
  closeSoulVersionsDb: vi.fn(),
}));

// Must import AFTER mocks are set up
import { readFileSync, writeFileSync } from "node:fs";
import { clearPromptCache } from "../../soul/loader.js";
import {
  listVersions,
  getVersion,
  saveVersion,
  deleteVersion,
} from "../../services/soul-versions.js";
import { createSoulRoutes } from "../routes/soul.js";
import type { WebUIServerDeps } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function buildApp() {
  const deps = {} as unknown as WebUIServerDeps;
  const app = new Hono();
  app.route("/soul", createSoulRoutes(deps));
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("GET /soul/:file", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("returns file content for a valid soul file", async () => {
    vi.mocked(readFileSync).mockReturnValue("# My Soul\n\nThis is my soul content.");

    const res = await app.request("/soul/SOUL.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.content).toBe("# My Soul\n\nThis is my soul content.");
  });

  it("returns empty content when file does not exist (ENOENT)", async () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw error;
    });

    const res = await app.request("/soul/SOUL.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.content).toBe("");
  });

  it("returns 400 for an invalid soul file name", async () => {
    const res = await app.request("/soul/INVALID.md");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid soul file");
    expect(json.error).toContain("SOUL.md");
  });

  it("returns content for SECURITY.md", async () => {
    vi.mocked(readFileSync).mockReturnValue("# Security\n\nContent here.");

    const res = await app.request("/soul/SECURITY.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.content).toBe("# Security\n\nContent here.");
  });

  it("returns content for STRATEGY.md", async () => {
    vi.mocked(readFileSync).mockReturnValue("# Strategy");

    const res = await app.request("/soul/STRATEGY.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns content for MEMORY.md", async () => {
    vi.mocked(readFileSync).mockReturnValue("# Memory");

    const res = await app.request("/soul/MEMORY.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns content for HEARTBEAT.md", async () => {
    vi.mocked(readFileSync).mockReturnValue("# Heartbeat");

    const res = await app.request("/soul/HEARTBEAT.md");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns 500 when an unexpected read error occurs", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("Unexpected IO error");
    });

    const res = await app.request("/soul/SOUL.md");
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unexpected IO error");
  });
});

describe("PUT /soul/:file", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(clearPromptCache).mockReset();
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("writes file content and clears prompt cache", async () => {
    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Updated Soul\n\nNew content." }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toContain("SOUL.md");
    expect(json.data.message).toContain("updated successfully");
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("SOUL.md"),
      "# Updated Soul\n\nNew content.",
      "utf-8"
    );
    expect(clearPromptCache).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for invalid soul file name", async () => {
    const res = await app.request("/soul/NOTASOULFILE.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "content" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid soul file");
  });

  it("returns 400 when content field is missing", async () => {
    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("content");
  });

  it("returns 400 when content is not a string", async () => {
    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 12345 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 413 when content exceeds 1MB", async () => {
    const largeContent = "x".repeat(1024 * 1024 + 1);
    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: largeContent }),
    });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("1MB");
  });

  it("allows writing exactly 1MB of content", async () => {
    const content = "x".repeat(1024 * 1024);
    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns 500 when writeFileSync throws an error", async () => {
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error("Disk full");
    });

    const res = await app.request("/soul/SOUL.md", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Some content" }),
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Disk full");
  });
});

describe("GET /soul/:file/versions", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("returns empty array when no versions exist", async () => {
    const res = await app.request("/soul/SOUL.md/versions");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });

  it("returns list of versions for a soul file", async () => {
    vi.mocked(saveVersion).mockImplementation((filename, content, comment) => {
      const id = nextVersionId++;
      const entry = {
        id,
        filename,
        content,
        comment: comment ?? null,
        created_at: new Date().toISOString(),
      };
      if (!mockVersions.has(filename)) mockVersions.set(filename, []);
      mockVersions.get(filename)!.push(entry);
      return {
        id,
        filename,
        comment: entry.comment,
        created_at: entry.created_at,
        content_length: content.length,
      };
    });

    // Seed a version directly in mock store
    const stored = [
      {
        id: 1,
        filename: "SOUL.md",
        content: "v1",
        comment: "first",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];
    mockVersions.set("SOUL.md", stored);

    const res = await app.request("/soul/SOUL.md/versions");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].id).toBe(1);
    expect(json.data[0].filename).toBe("SOUL.md");
    expect(json.data[0].content_length).toBe(2); // "v1".length
  });

  it("returns 400 for invalid soul file name", async () => {
    const res = await app.request("/soul/INVALID.md/versions");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid soul file");
  });
});

describe("POST /soul/:file/versions", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("saves a new version and returns 201", async () => {
    const res = await app.request("/soul/SOUL.md/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Version content", comment: "v1.0" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.data.id).toBe("number");
    expect(json.data.filename).toBe("SOUL.md");
    expect(json.data.comment).toBe("v1.0");
    expect(json.data.content_length).toBe("Version content".length);
  });

  it("saves a version without a comment", async () => {
    const res = await app.request("/soul/SOUL.md/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "No comment version" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.comment).toBeNull();
  });

  it("returns 400 for invalid soul file name", async () => {
    const res = await app.request("/soul/NOTREAL.md/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "content" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns 400 when content field is missing", async () => {
    const res = await app.request("/soul/SOUL.md/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "oops" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("content");
  });

  it("returns 413 when content exceeds 1MB", async () => {
    const largeContent = "y".repeat(1024 * 1024 + 1);
    const res = await app.request("/soul/SOUL.md/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: largeContent }),
    });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("1MB");
  });
});

describe("GET /soul/:file/versions/:id", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("returns a specific version by id", async () => {
    mockVersions.set("SOUL.md", [
      {
        id: 42,
        filename: "SOUL.md",
        content: "Version 42 content",
        comment: "test",
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const res = await app.request("/soul/SOUL.md/versions/42");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(42);
    expect(json.data.content).toBe("Version 42 content");
    expect(json.data.filename).toBe("SOUL.md");
  });

  it("returns 404 when version does not exist", async () => {
    const res = await app.request("/soul/SOUL.md/versions/9999");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("not found");
  });

  it("returns 400 for invalid (non-numeric) version id", async () => {
    const res = await app.request("/soul/SOUL.md/versions/not-a-number");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid version id");
  });

  it("returns 400 for invalid soul file name", async () => {
    const res = await app.request("/soul/BADFILE.md/versions/1");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid soul file");
  });
});

describe("DELETE /soul/:file/versions/:id", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockVersions = new Map();
    nextVersionId = 1;
    app = buildApp();
  });

  it("deletes a version and returns success message", async () => {
    mockVersions.set("SOUL.md", [
      {
        id: 7,
        filename: "SOUL.md",
        content: "Content",
        comment: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const res = await app.request("/soul/SOUL.md/versions/7", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.message).toBe("Version deleted");
  });

  it("returns 404 when version does not exist", async () => {
    const res = await app.request("/soul/SOUL.md/versions/9999", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("not found");
  });

  it("returns 400 for invalid version id", async () => {
    const res = await app.request("/soul/SOUL.md/versions/abc", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid version id");
  });

  it("returns 400 for invalid soul file name", async () => {
    const res = await app.request("/soul/NOTREAL.md/versions/1", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("removes the version from the versions list", async () => {
    mockVersions.set("MEMORY.md", [
      {
        id: 10,
        filename: "MEMORY.md",
        content: "Old content",
        comment: null,
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    await app.request("/soul/MEMORY.md/versions/10", { method: "DELETE" });

    const listRes = await app.request("/soul/MEMORY.md/versions");
    const listJson = await listRes.json();
    expect(listJson.data.length).toBe(0);
  });
});
