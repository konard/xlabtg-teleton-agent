import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import {
  IntegrationRegistry,
  type CreateIntegrationInput,
  type CreateCredentialInput,
  type IntegrationAuthConfig,
  type IntegrationConfig,
  isIntegrationAuthType,
  isIntegrationType,
} from "../../services/integrations/index.js";
import { getErrorMessage } from "../../utils/errors.js";

const MAX_NAME_LENGTH = 120;

export function createIntegrationsRoutes(deps: WebUIServerDeps): Hono {
  const app = new Hono();
  const registry = new IntegrationRegistry({
    db: deps.memory.db,
    bridge: deps.bridge,
    mcpServers: deps.mcpServers,
    credentialKey: deps.marketplace?.config.integrations?.credential_key,
    globalRateLimit: {
      requestsPerMinute:
        deps.marketplace?.config.integrations?.global_rate_limit.requests_per_minute,
      requestsPerHour: deps.marketplace?.config.integrations?.global_rate_limit.requests_per_hour,
    },
  });

  app.get("/catalog", (c) => {
    const response: APIResponse = { success: true, data: registry.getCatalog() };
    return c.json(response);
  });

  app.get("/", (c) => {
    try {
      const response: APIResponse = { success: true, data: registry.list() };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      const validation = parseCreateIntegration(body);
      if (typeof validation === "string") {
        return c.json<APIResponse>({ success: false, error: validation }, 400);
      }

      const integration = registry.create(validation);
      return c.json<APIResponse>({ success: true, data: integration }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/:id", (c) => {
    try {
      const integration = registry.get(c.req.param("id"));
      if (!integration) {
        return c.json<APIResponse>({ success: false, error: "Integration not found" }, 404);
      }
      return c.json<APIResponse>({ success: true, data: integration });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.put("/:id", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      const validation = parseUpdateIntegration(body);
      if (typeof validation === "string") {
        return c.json<APIResponse>({ success: false, error: validation }, 400);
      }

      const updated = registry.update(c.req.param("id"), validation);
      if (!updated) {
        return c.json<APIResponse>({ success: false, error: "Integration not found" }, 404);
      }
      return c.json<APIResponse>({ success: true, data: updated });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.delete("/:id", (c) => {
    try {
      const deleted = registry.delete(c.req.param("id"));
      if (!deleted) {
        return c.json<APIResponse>({ success: false, error: "Integration not found" }, 404);
      }
      return c.json<APIResponse>({ success: true, data: null });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.get("/:id/health", async (c) => {
    try {
      const health = await registry.healthCheck(c.req.param("id"));
      return c.json<APIResponse>({ success: true, data: health });
    } catch (error) {
      const status = getErrorMessage(error).includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, status);
    }
  });

  app.post("/:id/test", async (c) => {
    try {
      const body = await optionalJson(c.req);
      const action = typeof body.action === "string" ? body.action : null;
      if (!action) {
        const health = await registry.healthCheck(c.req.param("id"));
        return c.json<APIResponse>({ success: true, data: health });
      }
      const params = isRecord(body.params) ? body.params : {};
      const result = await registry.execute(c.req.param("id"), action, params);
      return c.json<APIResponse>({ success: true, data: result });
    } catch (error) {
      const status = getErrorMessage(error).includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, status);
    }
  });

  app.post("/:id/execute", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      if (!isRecord(body) || typeof body.action !== "string") {
        return c.json<APIResponse>({ success: false, error: "action is required" }, 400);
      }
      const params = isRecord(body.params) ? body.params : {};
      const result = await registry.execute(c.req.param("id"), body.action, params);
      return c.json<APIResponse>({ success: true, data: result });
    } catch (error) {
      const status = getErrorMessage(error).includes("not found") ? 404 : 500;
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, status);
    }
  });

  app.get("/:id/credentials", (c) => {
    try {
      const response: APIResponse = {
        success: true,
        data: registry.auth.listCredentials(c.req.param("id")),
      };
      return c.json(response);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/:id/credentials", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      const validation = parseCreateCredential(c.req.param("id"), body);
      if (typeof validation === "string") {
        return c.json<APIResponse>({ success: false, error: validation }, 400);
      }
      const credential = registry.auth.createCredential(validation);
      registry.update(c.req.param("id"), {
        authId: credential.id,
        auth: { type: credential.authType, credentialId: credential.id },
      });
      const masked = registry.auth.listCredentials(c.req.param("id")).find((item) => {
        return item.id === credential.id;
      });
      return c.json<APIResponse>({ success: true, data: masked ?? credential }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.delete("/:id/credentials/:credentialId", (c) => {
    try {
      const deleted = registry.auth.deleteCredential(c.req.param("credentialId"));
      if (!deleted) {
        return c.json<APIResponse>({ success: false, error: "Credential not found" }, 404);
      }
      return c.json<APIResponse>({ success: true, data: null });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/:id/oauth/authorize", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      if (!isRecord(body)) {
        return c.json<APIResponse>(
          { success: false, error: "request body must be an object" },
          400
        );
      }
      const authorizeUrl = stringField(body.authorizeUrl);
      const clientId = stringField(body.clientId);
      const redirectUri = stringField(body.redirectUri);
      if (!authorizeUrl) {
        return c.json<APIResponse>({ success: false, error: "authorizeUrl is required" }, 400);
      }
      if (!clientId) {
        return c.json<APIResponse>({ success: false, error: "clientId is required" }, 400);
      }
      if (!redirectUri) {
        return c.json<APIResponse>({ success: false, error: "redirectUri is required" }, 400);
      }
      const scopes = Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is string => typeof scope === "string")
        : undefined;
      const authorizationUrl = registry.auth.buildOAuthAuthorizationUrl({
        authorizeUrl,
        clientId,
        redirectUri,
        scopes,
        state: typeof body.state === "string" ? body.state : undefined,
      });
      return c.json<APIResponse>({ success: true, data: { authorizationUrl } });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/:id/oauth/token", async (c) => {
    try {
      const body = await c.req.json<unknown>();
      if (!isRecord(body)) {
        return c.json<APIResponse>(
          { success: false, error: "request body must be an object" },
          400
        );
      }
      const tokenUrl = stringField(body.tokenUrl);
      const clientId = stringField(body.clientId);
      const code = stringField(body.code);
      const redirectUri = stringField(body.redirectUri);
      if (!tokenUrl)
        return c.json<APIResponse>({ success: false, error: "tokenUrl is required" }, 400);
      if (!clientId)
        return c.json<APIResponse>({ success: false, error: "clientId is required" }, 400);
      if (!code) return c.json<APIResponse>({ success: false, error: "code is required" }, 400);
      if (!redirectUri) {
        return c.json<APIResponse>({ success: false, error: "redirectUri is required" }, 400);
      }
      const credential = await registry.auth.exchangeOAuthCode({
        integrationId: c.req.param("id"),
        tokenUrl,
        clientId,
        code,
        redirectUri,
        clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
      });
      registry.update(c.req.param("id"), {
        authId: credential.id,
        auth: { type: "oauth2", credentialId: credential.id },
      });
      const masked = registry.auth.listCredentials(c.req.param("id")).find((item) => {
        return item.id === credential.id;
      });
      return c.json<APIResponse>({ success: true, data: masked ?? credential }, 201);
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}

function parseCreateIntegration(value: unknown): CreateIntegrationInput | string {
  if (!isRecord(value)) return "request body must be an object";
  const name = typeof value.name === "string" ? value.name.trim().slice(0, MAX_NAME_LENGTH) : "";
  if (!name) return "name is required";
  if (!isIntegrationType(value.type)) return "type must be one of: api, webhook, oauth, mcp";
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  if (!provider) return "provider is required";
  const config = parseConfig(value.config);
  if (typeof config === "string") return config;
  const auth = parseAuth(value.auth);
  if (typeof auth === "string") return auth;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    name,
    type: value.type,
    provider,
    auth,
    authId: typeof value.authId === "string" ? value.authId : null,
    config,
    healthCheckUrl: typeof value.healthCheckUrl === "string" ? value.healthCheckUrl : null,
  };
}

function parseUpdateIntegration(
  value: unknown
): Parameters<IntegrationRegistry["update"]>[1] | string {
  if (!isRecord(value)) return "request body must be an object";
  const patch: Parameters<IntegrationRegistry["update"]>[1] = {};
  if (value.name !== undefined) {
    if (typeof value.name !== "string" || !value.name.trim()) return "name cannot be empty";
    patch.name = value.name.trim().slice(0, MAX_NAME_LENGTH);
  }
  if (value.type !== undefined) {
    if (!isIntegrationType(value.type)) return "type must be one of: api, webhook, oauth, mcp";
    patch.type = value.type;
  }
  if (value.provider !== undefined) {
    if (typeof value.provider !== "string" || !value.provider.trim()) {
      return "provider cannot be empty";
    }
    patch.provider = value.provider.trim();
  }
  if (value.config !== undefined) {
    const config = parseConfig(value.config);
    if (typeof config === "string") return config;
    patch.config = config;
  }
  if (value.auth !== undefined) {
    const auth = parseAuth(value.auth);
    if (typeof auth === "string") return auth;
    patch.auth = auth;
  }
  if (value.authId !== undefined) {
    patch.authId = typeof value.authId === "string" ? value.authId : null;
  }
  if (value.healthCheckUrl !== undefined) {
    patch.healthCheckUrl = typeof value.healthCheckUrl === "string" ? value.healthCheckUrl : null;
  }
  return patch;
}

function parseCreateCredential(
  integrationId: string,
  value: unknown
): CreateCredentialInput | string {
  if (!isRecord(value)) return "request body must be an object";
  if (!isIntegrationAuthType(value.authType)) {
    return "authType must be one of: none, api_key, oauth2, jwt, basic, custom_header";
  }
  if (!isRecord(value.credentials)) return "credentials must be an object";
  return {
    integrationId,
    authType: value.authType,
    credentials: value.credentials,
    expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : null,
  };
}

function parseConfig(value: unknown): IntegrationConfig | string {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return "config must be an object";
  return value as IntegrationConfig;
}

function parseAuth(value: unknown): IntegrationAuthConfig | undefined | string {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return "auth must be an object";
  if (!isIntegrationAuthType(value.type)) {
    return "auth.type must be one of: none, api_key, oauth2, jwt, basic, custom_header";
  }
  return value as unknown as IntegrationAuthConfig;
}

async function optionalJson(req: { json: <T>() => Promise<T> }): Promise<Record<string, unknown>> {
  try {
    const value = await req.json<unknown>();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
