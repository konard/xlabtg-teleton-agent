import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createCsrfMiddleware, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../middleware/csrf.js";

// ── Helpers ──────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.use("*", createCsrfMiddleware());

  app.get("/api/data", (c) => c.json({ success: true, data: "ok" }));
  app.post("/api/data", (c) => c.json({ success: true, data: "created" }));
  app.put("/api/data", (c) => c.json({ success: true, data: "updated" }));
  app.delete("/api/data", (c) => c.json({ success: true, data: "deleted" }));
  app.patch("/api/data", (c) => c.json({ success: true, data: "patched" }));

  // Auth route — should bypass CSRF check
  app.post("/auth/login", (c) => c.json({ success: true, data: "logged in" }));

  return app;
}

/** Extract the CSRF token value from a Set-Cookie header. */
function extractCsrfCookie(res: Response): string | null {
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("CSRF middleware — GET requests are allowed without token", () => {
  const app = buildApp();

  it("allows GET /api/data without a CSRF header", async () => {
    const res = await app.request("/api/data");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("sets the CSRF cookie on a GET request so the browser can read it", async () => {
    const res = await app.request("/api/data");
    const cookie = extractCsrfCookie(res);
    expect(cookie).toBeTruthy();
    expect(typeof cookie).toBe("string");
    expect(cookie!.length).toBeGreaterThan(0);
  });
});

describe("CSRF middleware — mutation requests require the token header", () => {
  const app = buildApp();

  it("rejects POST /api/data without CSRF header (403)", async () => {
    const res = await app.request("/api/data", { method: "POST" });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain(CSRF_COOKIE_NAME);
  });

  it("rejects PUT /api/data without CSRF header (403)", async () => {
    const res = await app.request("/api/data", { method: "PUT" });
    expect(res.status).toBe(403);
  });

  it("rejects DELETE /api/data without CSRF header (403)", async () => {
    const res = await app.request("/api/data", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("rejects PATCH /api/data without CSRF header (403)", async () => {
    const res = await app.request("/api/data", { method: "PATCH" });
    expect(res.status).toBe(403);
  });
});

describe("CSRF middleware — mutation succeeds when token matches cookie", () => {
  const app = buildApp();

  it("allows POST when X-CSRF-Token header matches the cookie value", async () => {
    // Step 1: perform a GET to obtain the CSRF token via cookie
    const getRes = await app.request("/api/data");
    const csrfToken = extractCsrfCookie(getRes);
    expect(csrfToken).toBeTruthy();

    // Step 2: POST with the token in the header and the cookie in the request
    const postRes = await app.request("/api/data", {
      method: "POST",
      headers: {
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: csrfToken!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(postRes.status).toBe(200);
    const json = await postRes.json();
    expect(json.success).toBe(true);
  });

  it("rejects POST when header token does not match cookie", async () => {
    const getRes = await app.request("/api/data");
    const csrfToken = extractCsrfCookie(getRes);
    expect(csrfToken).toBeTruthy();

    const postRes = await app.request("/api/data", {
      method: "POST",
      headers: {
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: "wrong-token-value",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(postRes.status).toBe(403);
  });
});

describe("CSRF middleware — /auth/* routes bypass token check", () => {
  const app = buildApp();

  it("allows POST /auth/login without a CSRF header", async () => {
    const res = await app.request("/auth/login", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
