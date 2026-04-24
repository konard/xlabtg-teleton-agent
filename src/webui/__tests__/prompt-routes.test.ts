import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

import { createPromptRoutes } from "../routes/prompts.js";
import type { WebUIServerDeps } from "../types.js";

function buildDeps(db: Database.Database): WebUIServerDeps {
  return {
    memory: { db },
  } as unknown as WebUIServerDeps;
}

describe("prompt optimization routes", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    app = new Hono();
    app.route("/prompts", createPromptRoutes(buildDeps(db)));
  });

  afterEach(() => {
    db.close();
  });

  it("creates, lists, and activates prompt variants", async () => {
    const first = await app.request("/prompts/sections/persona/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "You are direct.", activate: true }),
    });
    expect(first.status).toBe(201);
    const firstJson = await first.json();
    expect(firstJson.data.active).toBe(true);

    const second = await app.request("/prompts/sections/persona/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "You are concise." }),
    });
    const secondJson = await second.json();

    const activate = await app.request(
      `/prompts/sections/persona/variants/${secondJson.data.id}/activate`,
      { method: "PUT" }
    );
    expect(activate.status).toBe(200);

    const list = await app.request("/prompts/sections/persona/variants");
    const listJson = await list.json();
    expect(listJson.data).toHaveLength(2);
    expect(listJson.data[0].id).toBe(secondJson.data.id);
    expect(listJson.data[0].active).toBe(true);
  });

  it("creates a running experiment and exposes status", async () => {
    const control = await app.request("/prompts/sections/safety/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Confirm irreversible actions and protect private data.",
        activate: true,
      }),
    });
    const candidate = await app.request("/prompts/sections/safety/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Confirm before irreversible actions, ask permission, and preserve privacy.",
      }),
    });
    const controlJson = await control.json();
    const candidateJson = await candidate.json();

    const create = await app.request("/prompts/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "safety",
        controlVariantId: controlJson.data.id,
        candidateVariantId: candidateJson.data.id,
        trafficPercentage: 25,
        minSamples: 2,
        start: true,
      }),
    });
    expect(create.status).toBe(201);
    const createJson = await create.json();
    expect(createJson.data.status).toBe("running");

    const status = await app.request(`/prompts/experiments/${createJson.data.id}`);
    const statusJson = await status.json();
    expect(statusJson.data.trafficPercentage).toBe(25);
  });

  it("suggests and persists optimizer variants", async () => {
    await app.request("/prompts/sections/tool_usage/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Use tools when needed.", activate: true }),
    });

    const res = await app.request("/prompts/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: "tool_usage", createVariant: true }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.validation.passed).toBe(true);
    expect(json.data.createdVariant.source).toBe("optimizer");
  });
});
