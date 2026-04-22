import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { WebUIServer } from "../server.js";
import { addLogListener } from "../../utils/logger.js";
import { maskToken } from "../middleware/auth.js";
import type { WebUIServerDeps } from "../types.js";

// AUDIT-C4 regression test: the full WebUI auth token must not appear in any
// log.* output at startup, because any centralized log collector (journalctl,
// Docker log driver, CI artifacts, `teleton --debug > log.txt`) would
// otherwise persist a valid 7-day session token.
//
// The one-time exchange URL with the full token is acceptable on stderr only
// when it bypasses the logger (i.e. raw process.stderr.write, not captured by
// pino's stdout/webui streams or any LogListener).

function buildDeps(authToken: string): WebUIServerDeps {
  const db = new Database(":memory:");
  return {
    memory: { db },
    config: {
      enabled: true,
      host: "127.0.0.1",
      port: 0, // ephemeral port — avoid collisions
      auth_token: authToken,
      cors_origins: [],
      log_requests: false,
    },
    configPath: "/tmp/teleton-test-config.yaml",
  } as unknown as WebUIServerDeps;
}

describe("WebUIServer startup — AUDIT-C4 token leak regression", () => {
  const started: WebUIServer[] = [];

  afterEach(async () => {
    for (const s of started.splice(0)) {
      await s.stop();
    }
  });

  it("does not print the full auth token through the logger", async () => {
    const authToken = "supersecrettoken_abcd1234_xyz_do_not_leak_please";

    // Capture everything the logger emits (this is what any log sink sees:
    // stdout, WebUI SSE stream, pretty transport, file redirection).
    const logMessages: string[] = [];
    const removeListener = addLogListener((entry) => {
      logMessages.push(entry.message);
    });

    const server = new WebUIServer(buildDeps(authToken));
    started.push(server);

    try {
      await server.start();
    } finally {
      removeListener();
    }

    const combined = logMessages.join("\n");

    // Hard requirement from acceptance criteria:
    //   grep "$AUTH_TOKEN" logs/*.log → zero matches
    expect(combined).not.toContain(authToken);

    // Masked form is still fine (and expected) for operator visibility.
    expect(combined).toContain(maskToken(authToken));
  });

  it("prints the one-time exchange URL to stderr without routing it through the logger", async () => {
    const authToken = "stderr_only_token_qwertyuiop_asdfghjkl_zxcvbnm";

    const logMessages: string[] = [];
    const removeListener = addLogListener((entry) => {
      logMessages.push(entry.message);
    });

    // Wrap process.stderr.write so we can see exactly what the server writes
    // out-of-band (bypassing pino). We still forward to the real write so other
    // concurrent consumers (pino-pretty workers, etc.) are unaffected.
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: string[] = [];
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return originalWrite(chunk, ...rest);
    }) as typeof process.stderr.write;

    const server = new WebUIServer(buildDeps(authToken));
    started.push(server);

    try {
      await server.start();
    } finally {
      removeListener();
      process.stderr.write = originalWrite;
    }

    // Logger must never see the raw token.
    expect(logMessages.join("\n")).not.toContain(authToken);

    // stderr must contain the one-time exchange URL with the token, so a human
    // operator can still click it from an interactive terminal.
    const stderrOutput = stderrChunks.join("");
    expect(stderrOutput).toContain(`/auth/exchange?token=${authToken}`);
  });
});
