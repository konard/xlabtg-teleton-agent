import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

/**
 * Structural validation for the deployment artifacts shipped with the repo
 * (Docker Compose stack + Helm chart). These guard against accidental breakage
 * of the operator-facing files referenced by docs/deployment.md.
 *
 * The repo root is the vitest working directory.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("Docker Compose stack", () => {
  const compose = parse(read("compose.yaml")) as {
    services: Record<string, Record<string, unknown>>;
    volumes: Record<string, unknown>;
  };

  it("defines the agent service", () => {
    expect(compose.services).toBeDefined();
    expect(compose.services.agent).toBeDefined();
  });

  it("points at the published GHCR image by default", () => {
    const image = compose.services.agent.image as string;
    expect(image).toContain("ghcr.io/xlabtg/teleton-agent");
  });

  it("uses an unless-stopped restart policy", () => {
    expect(compose.services.agent.restart).toBe("unless-stopped");
  });

  it("persists the data directory through a named volume", () => {
    const volumes = compose.services.agent.volumes as string[];
    expect(volumes.some((v) => v.endsWith(":/data"))).toBe(true);
    expect(compose.volumes).toHaveProperty("teleton-data");
  });

  it("publishes the WebUI port and probes the /health endpoint", () => {
    const ports = compose.services.agent.ports as string[];
    expect(ports.some((p) => p.includes("7777"))).toBe(true);
    const healthcheck = compose.services.agent.healthcheck as { test: string[] };
    expect(healthcheck.test.join(" ")).toContain("/health");
  });

  it("ships an .env.example template", () => {
    expect(existsSync(resolve(root, ".env.example"))).toBe(true);
  });
});

describe("Helm chart", () => {
  const chart = parse(read("helm/teleton-agent/Chart.yaml")) as {
    apiVersion: string;
    name: string;
    version: string;
    appVersion: string;
  };
  const values = parse(read("helm/teleton-agent/values.yaml")) as {
    image: { repository: string };
    service: { port: number };
    persistence: { enabled: boolean };
  };

  it("has a valid v2 Chart.yaml", () => {
    expect(chart.apiVersion).toBe("v2");
    expect(chart.name).toBe("teleton-agent");
    expect(chart.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("defaults to the published GHCR image", () => {
    expect(values.image.repository).toBe("ghcr.io/xlabtg/teleton-agent");
  });

  it("enables persistence and exposes the WebUI port", () => {
    expect(values.persistence.enabled).toBe(true);
    expect(values.service.port).toBe(7777);
  });

  it("ships the core templates", () => {
    for (const tpl of ["deployment.yaml", "service.yaml", "pvc.yaml", "secret.yaml"]) {
      expect(existsSync(resolve(root, "helm/teleton-agent/templates", tpl))).toBe(true);
    }
  });

  it("probes the /health endpoint in the Deployment", () => {
    const deployment = read("helm/teleton-agent/templates/deployment.yaml");
    expect(deployment).toContain("livenessProbe");
    expect(deployment).toContain("/health");
  });
});
