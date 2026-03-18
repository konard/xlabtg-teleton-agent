import { Hono } from "hono";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { WORKSPACE_ROOT } from "../../workspace/paths.js";
import { clearPromptCache } from "../../soul/loader.js";
import { getErrorMessage } from "../../utils/errors.js";
import {
  listVersions,
  getVersion,
  saveVersion,
  deleteVersion,
} from "../../services/soul-versions.js";

const SOUL_FILES = ["SOUL.md", "SECURITY.md", "STRATEGY.md", "MEMORY.md", "HEARTBEAT.md"] as const;
type SoulFile = (typeof SOUL_FILES)[number];

function isSoulFile(filename: string): filename is SoulFile {
  return SOUL_FILES.includes(filename as SoulFile);
}

export function createSoulRoutes(_deps: WebUIServerDeps) {
  const app = new Hono();

  // Get soul file content
  app.get("/:file", (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const filePath = join(WORKSPACE_ROOT, filename);

      try {
        const content = readFileSync(filePath, "utf-8");
        const response: APIResponse<{ content: string }> = {
          success: true,
          data: { content },
        };
        return c.json(response);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // File doesn't exist - return empty content
          const response: APIResponse<{ content: string }> = {
            success: true,
            data: { content: "" },
          };
          return c.json(response);
        }
        throw error;
      }
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Update soul file content
  app.put("/:file", async (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const body = await c.req.json<{ content: string }>();
      if (typeof body.content !== "string") {
        const response: APIResponse = {
          success: false,
          error: "Request body must contain 'content' field with string value",
        };
        return c.json(response, 400);
      }

      const MAX_SOUL_SIZE = 1024 * 1024; // 1MB
      if (Buffer.byteLength(body.content, "utf-8") > MAX_SOUL_SIZE) {
        const response: APIResponse = {
          success: false,
          error: "Soul file content exceeds 1MB limit",
        };
        return c.json(response, 413);
      }

      const filePath = join(WORKSPACE_ROOT, filename);
      writeFileSync(filePath, body.content, "utf-8");
      clearPromptCache();

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: `${filename} updated successfully` },
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // List versions for a soul file
  app.get("/:file/versions", (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const versions = listVersions(filename);
      const response: APIResponse<typeof versions> = {
        success: true,
        data: versions,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Save a named version of a soul file
  app.post("/:file/versions", async (c) => {
    try {
      const filename = c.req.param("file");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const body = await c.req.json<{ content: string; comment?: string }>();
      if (typeof body.content !== "string") {
        const response: APIResponse = {
          success: false,
          error: "Request body must contain 'content' field with string value",
        };
        return c.json(response, 400);
      }

      const MAX_SOUL_SIZE = 1024 * 1024; // 1MB
      if (Buffer.byteLength(body.content, "utf-8") > MAX_SOUL_SIZE) {
        const response: APIResponse = {
          success: false,
          error: "Soul file content exceeds 1MB limit",
        };
        return c.json(response, 413);
      }

      const comment =
        typeof body.comment === "string" ? body.comment.trim() || undefined : undefined;
      const version = saveVersion(filename, body.content, comment);

      const response: APIResponse<typeof version> = {
        success: true,
        data: version,
      };
      return c.json(response, 201);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Get specific version content
  app.get("/:file/versions/:id", (c) => {
    try {
      const filename = c.req.param("file");
      const idParam = c.req.param("id");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const id = parseInt(idParam, 10);
      if (isNaN(id)) {
        const response: APIResponse = {
          success: false,
          error: "Invalid version id",
        };
        return c.json(response, 400);
      }

      const version = getVersion(filename, id);
      if (!version) {
        const response: APIResponse = {
          success: false,
          error: "Version not found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<typeof version> = {
        success: true,
        data: version,
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Delete a specific version
  app.delete("/:file/versions/:id", (c) => {
    try {
      const filename = c.req.param("file");
      const idParam = c.req.param("id");

      if (!isSoulFile(filename)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid soul file. Must be one of: ${SOUL_FILES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const id = parseInt(idParam, 10);
      if (isNaN(id)) {
        const response: APIResponse = {
          success: false,
          error: "Invalid version id",
        };
        return c.json(response, 400);
      }

      const deleted = deleteVersion(filename, id);
      if (!deleted) {
        const response: APIResponse = {
          success: false,
          error: "Version not found",
        };
        return c.json(response, 404);
      }

      const response: APIResponse<{ message: string }> = {
        success: true,
        data: { message: "Version deleted" },
      };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
