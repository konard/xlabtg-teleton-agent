// ── CSRF Protection Middleware ────────────────────────────────────────────────
// Implements the double-submit cookie pattern for CSRF protection.
//
// How it works:
//   1. On first request (or when cookie is missing), a CSRF token is generated
//      and set as a readable (non-HttpOnly) cookie so the frontend JS can read it.
//   2. For all state-changing requests (POST/PUT/PATCH/DELETE), the client must
//      echo the same token value in the X-CSRF-Token request header.
//   3. The middleware compares the header value against the cookie value using a
//      timing-safe comparison to prevent oracle attacks.
//
// Why double-submit cookies are safe here:
//   - Attackers on a different origin cannot read the SameSite=Strict session
//     cookie, nor can they read the CSRF cookie (same-origin cookie read).
//   - Even if a CSRF cookie is somehow set, an attacker cannot know the value
//     and therefore cannot forge the required X-CSRF-Token header.
//
// Note: Auth routes (/auth/*) are excluded because they are login flows that
// require the token before the JS frontend has a chance to read it.

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const CSRF_COOKIE_NAME = "teleton_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days — same as session

/** Generate a 32-byte base64url CSRF token. */
function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Timing-safe comparison of two strings. */
function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns a Hono middleware that enforces CSRF token validation on
 * state-changing requests to /api/* routes.
 *
 * The CSRF token is delivered to the browser via a readable cookie
 * (not HttpOnly) so that JavaScript can include it in request headers.
 */
export function createCsrfMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;

    // Skip auth exchange / login endpoints — CSRF token not yet available there
    if (path.startsWith("/auth/")) {
      return next();
    }

    // Ensure a CSRF cookie exists (set one if missing)
    let csrfToken = getCookie(c, CSRF_COOKIE_NAME);
    if (!csrfToken) {
      csrfToken = generateCsrfToken();
      setCookie(c, CSRF_COOKIE_NAME, csrfToken, {
        path: "/",
        httpOnly: false, // must be readable by JS
        sameSite: "Strict",
        secure: false, // localhost is HTTP; set to true behind HTTPS proxy
        maxAge: CSRF_COOKIE_MAX_AGE,
      });
    }

    // Enforce token check only on state-changing requests to /api/*
    if (MUTATION_METHODS.has(c.req.method) && path.startsWith("/api/")) {
      const headerToken = c.req.header(CSRF_HEADER_NAME);
      if (!headerToken || !safeCompare(headerToken, csrfToken)) {
        return c.json(
          {
            success: false,
            error: `CSRF token missing or invalid. Include the value of the '${CSRF_COOKIE_NAME}' cookie in the '${CSRF_HEADER_NAME}' request header.`,
          },
          403
        );
      }
    }

    return next();
  };
}
