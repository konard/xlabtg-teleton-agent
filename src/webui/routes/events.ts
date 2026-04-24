import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { EVENT_TYPES, getEventBus, type EventListFilters } from "../../services/event-bus.js";
import { getErrorMessage } from "../../utils/errors.js";

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function createEventsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function bus() {
    return getEventBus(deps.memory.db);
  }

  app.get("/", (c) => {
    try {
      const filters: EventListFilters = {
        type: c.req.query("type"),
        from: c.req.query("from"),
        to: c.req.query("to"),
        limit: parseInteger(c.req.query("limit")),
        offset: parseInteger(c.req.query("offset")),
      };
      return c.json<APIResponse>({ success: true, data: bus().listEvents(filters) });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 400);
    }
  });

  app.get("/types", (c) => {
    return c.json<APIResponse<string[]>>({ success: true, data: [...EVENT_TYPES] });
  });

  app.get("/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let aborted = false;
      const unsubscribe = bus().subscribe("*", (event) => {
        if (aborted) return;
        void stream.writeSSE({
          event: "event",
          id: event.id,
          data: JSON.stringify(event),
        });
      });

      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
      });

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ timestamp: new Date().toISOString() }),
      });

      while (!aborted) {
        await stream.sleep(30_000);
        if (!aborted) await stream.writeSSE({ event: "ping", data: "" });
      }

      unsubscribe();
    });
  });

  app.get("/:id", (c) => {
    try {
      const event = bus().getEvent(c.req.param("id"));
      if (!event) return c.json<APIResponse>({ success: false, error: "Event not found" }, 404);
      return c.json<APIResponse>({ success: true, data: event });
    } catch (error) {
      return c.json<APIResponse>({ success: false, error: getErrorMessage(error) }, 500);
    }
  });

  app.post("/:id/replay", async (c) => {
    try {
      const event = await bus().replay(c.req.param("id"));
      return c.json<APIResponse>({ success: true, data: event }, 202);
    } catch (error) {
      const message = getErrorMessage(error);
      return c.json<APIResponse>(
        { success: false, error: message },
        message === "Event not found" ? 404 : 500
      );
    }
  });

  return app;
}
