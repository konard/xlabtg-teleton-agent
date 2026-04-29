import Database from "better-sqlite3";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { ensureSchema } from "../src/memory/schema.js";
import { createNetworkRoutes } from "../src/webui/routes/network.js";
import type { WebUIServerDeps } from "../src/webui/types.js";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
ensureSchema(db);

const deps: WebUIServerDeps = {
  configPath: "/tmp/teleton/config.yaml",
  config: {
    auth_token: "test",
    cors_origins: ["*"],
    log_requests: false,
  } as WebUIServerDeps["config"],
  memory: {
    db,
    embedder: {} as WebUIServerDeps["memory"]["embedder"],
    knowledge: {} as WebUIServerDeps["memory"]["knowledge"],
  },
  agent: {} as WebUIServerDeps["agent"],
  bridge: {} as WebUIServerDeps["bridge"],
  toolRegistry: {
    getAll: () => [
      { name: "web_search" },
      { name: "workspace_write" },
      { name: "telegram_send_message" },
    ],
  } as unknown as WebUIServerDeps["toolRegistry"],
  plugins: [],
  mcpServers: [],
};

const app = new Hono();

app.get("/api/auth/check", (c) =>
  c.json({ success: true, data: { authenticated: true } })
);
app.get("/auth/check", (c) =>
  c.json({ success: true, data: { authenticated: true } })
);
app.get("/api/setup/status", (c) =>
  c.json({
    success: true,
    data: { complete: true, hasConfig: true, configured: true },
  })
);
app.get("/api/status", (c) =>
  c.json({
    success: true,
    data: { running: true, version: "0.8.19", connected: true },
  })
);
app.get("/api/notifications/unread", (c) =>
  c.json({ success: true, data: { count: 0 } })
);
app.get("/api/notifications", (c) =>
  c.json({ success: true, data: [] })
);

app.route("/api/network", createNetworkRoutes(deps));

const distDir = resolve(process.cwd(), "dist/web");
console.log("Serving from", distDir);

const indexPath = join(distDir, "index.html");
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "<h1>missing build</h1>";

app.use(
  "/assets/*",
  serveStatic({
    root: "./dist/web",
  })
);

app.get("*", (c) => {
  return c.html(indexHtml);
});

const port = 7777;
serve({ fetch: app.fetch, port }, () => {
  console.log(`smoke server: http://localhost:${port}`);
});
