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
    getAll: () => [{ name: "web_search" }],
  } as unknown as WebUIServerDeps["toolRegistry"],
  plugins: [],
  mcpServers: [],
};

const app = new Hono();
app.route("/api/network", createNetworkRoutes(deps));

await app.request("/api/network/agents", {
  method: "POST",
  body: JSON.stringify({
    agentId: "remote-1",
    name: "Remote One",
    endpoint: "https://r1.example.com/api/agent-network",
    capabilities: ["summarization"],
    status: "available",
    load: 0.4,
    trustLevel: "verified",
  }),
  headers: { "Content-Type": "application/json" },
});

const res = await app.request("/api/network/status");
const body = await res.json();
console.log(JSON.stringify(body.data, null, 2));
