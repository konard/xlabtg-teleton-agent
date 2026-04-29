import Database from "better-sqlite3";
import { Hono } from "hono";
import { ensureSchema } from "../src/memory/schema.js";
import { createNetworkRoutes } from "../src/webui/routes/network.js";
import type { WebUIServerDeps } from "../src/webui/types.js";

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
    getAll: () => [{ name: "web_search" }, { name: "workspace_write" }],
  } as unknown as WebUIServerDeps["toolRegistry"],
  plugins: [],
  mcpServers: [],
  // No network config — should still report a local agent and counts
};

const app = new Hono();
app.route("/api/network", createNetworkRoutes(deps));

const res = await app.request("/api/network/status");
const body = await res.json();
console.log("Status:", res.status);
console.log("Body:", JSON.stringify(body, null, 2));
