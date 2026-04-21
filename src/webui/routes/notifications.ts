import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getNotificationService, notificationBus } from "../../services/notifications.js";
import { getErrorMessage } from "../../utils/errors.js";

export function createNotificationsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function svc() {
    return getNotificationService(deps.memory.db);
  }

  // GET /api/notifications?unread=true
  app.get("/", (c) => {
    try {
      const unreadOnly = c.req.query("unread") === "true";
      const notifications = svc().list(unreadOnly);
      const response: APIResponse = { success: true, data: notifications };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  // GET /api/notifications/unread-count
  app.get("/unread-count", (c) => {
    try {
      const count = svc().unreadCount();
      const response: APIResponse = { success: true, data: { count } };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  // GET /api/notifications/stream — SSE for real-time badge updates
  app.get("/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;

      stream.onAbort(() => {
        aborted = true;
      });

      // Send current unread count immediately on connect
      try {
        const count = svc().unreadCount();
        await stream.writeSSE({
          event: "unread-count",
          data: JSON.stringify({ count }),
        });
      } catch {
        // db may not be ready yet — ignore
      }

      const onUpdate = (count: number) => {
        if (aborted) return;
        void stream.writeSSE({
          event: "unread-count",
          data: JSON.stringify({ count }),
        });
      };

      notificationBus.on("update", onUpdate);

      // Heartbeat to keep connection alive
      while (!aborted) {
        await stream.sleep(30_000);
        if (aborted) break;
        await stream.writeSSE({ event: "ping", data: "" });
      }

      notificationBus.off("update", onUpdate);
    });
  });

  // PATCH /api/notifications/:id/read
  app.patch("/:id/read", (c) => {
    try {
      const ok = svc().markRead(c.req.param("id"));
      if (!ok) {
        return c.json({ success: false, error: "Notification not found" } as APIResponse, 404);
      }
      const count = svc().unreadCount();
      notificationBus.emit("update", count);
      const response: APIResponse = { success: true, data: { count } };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  // POST /api/notifications/read-all
  app.post("/read-all", (c) => {
    try {
      const changed = svc().markAllRead();
      const count = svc().unreadCount();
      notificationBus.emit("update", count);
      const response: APIResponse = { success: true, data: { changed, count } };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  // DELETE /api/notifications/:id
  app.delete("/:id", (c) => {
    try {
      const ok = svc().delete(c.req.param("id"));
      if (!ok) {
        return c.json({ success: false, error: "Notification not found" } as APIResponse, 404);
      }
      const count = svc().unreadCount();
      notificationBus.emit("update", count);
      const response: APIResponse = { success: true, data: { message: "Notification deleted" } };
      return c.json(response);
    } catch (error) {
      return c.json({ success: false, error: getErrorMessage(error) } as APIResponse, 500);
    }
  });

  return app;
}
