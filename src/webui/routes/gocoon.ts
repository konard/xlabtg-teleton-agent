import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import {
  ensureGocoonBinaries,
  init,
  isInstalled,
  runnerBaseUrl,
  topup,
  walletInfo,
  withdrawAll,
  GOCOON_DEFAULT_PORT,
  GOCOON_VERSION,
  type GocoonProgress,
} from "../../gocoon/index.js";

/**
 * Gocoon management routes — thin shells over the shared lifecycle core, so the
 * WebUI drives the exact same install/setup/top-up/withdraw flow as the CLI.
 * Mounted at /api/gocoon (WebUI) and /v1/gocoon (Management API).
 */
export function createGocoonRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const port = (): number => deps.agent.getConfig().gocoon?.port ?? GOCOON_DEFAULT_PORT;

  // One withdraw at a time: POST starts it, GET polls progress (myduckai pattern).
  let withdraw: {
    running: boolean;
    done: boolean;
    events: GocoonProgress[];
    error?: string;
  } | null = null;

  app.get("/status", async (c) => {
    const data: Record<string, unknown> = {
      installed: isInstalled(),
      version: isInstalled() ? GOCOON_VERSION : null,
    };
    try {
      const w = await walletInfo();
      data.wallet = { ownerAddress: w.ownerAddress, balanceTon: w.balanceTon, funded: w.funded };
    } catch {
      data.wallet = null;
    }
    data.runner = await fetch(`${runnerBaseUrl(port())}/jsonstats`, {
      signal: AbortSignal.timeout(800),
    })
      .then(() => true)
      .catch(() => false);
    return c.json({ success: true, data } as APIResponse);
  });

  app.post("/install", async (c) => {
    try {
      await ensureGocoonBinaries();
      return c.json({ success: true, data: { version: GOCOON_VERSION } } as APIResponse);
    } catch (err) {
      return c.json({ success: false, error: getErrorMessage(err) } as APIResponse, 500);
    }
  });

  app.post("/init", async (c) => {
    try {
      const s = await init();
      return c.json({
        success: true,
        data: { fundAddress: s.fundAddress, recommendedFundingTon: s.recommendedFundingTon },
      } as APIResponse);
    } catch (err) {
      return c.json({ success: false, error: getErrorMessage(err) } as APIResponse, 500);
    }
  });

  // Poll this until `funded` flips true after the user sends the TON.
  app.get("/balance", async (c) => {
    try {
      const w = await walletInfo();
      return c.json({
        success: true,
        data: { balanceTon: w.balanceTon, balanceNano: w.balanceNano.toString(), funded: w.funded },
      } as APIResponse);
    } catch (err) {
      return c.json({ success: false, error: getErrorMessage(err) } as APIResponse, 400);
    }
  });

  app.post("/topup", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { amount?: string | number };
      const amount = String(body.amount ?? "").trim();
      if (!amount)
        return c.json({ success: false, error: "amount (TON) is required" } as APIResponse, 400);
      await topup(amount, port());
      return c.json({ success: true, data: { amount } } as APIResponse);
    } catch (err) {
      return c.json({ success: false, error: getErrorMessage(err) } as APIResponse, 400);
    }
  });

  app.post("/withdraw", async (c) => {
    if (withdraw?.running) {
      return c.json(
        { success: false, error: "a withdraw is already in progress" } as APIResponse,
        409
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { destination?: string };
    const destination = String(body.destination ?? "").trim();
    if (!destination)
      return c.json({ success: false, error: "destination is required" } as APIResponse, 400);

    const job: { running: boolean; done: boolean; events: GocoonProgress[]; error?: string } = {
      running: true,
      done: false,
      events: [],
    };
    withdraw = job;
    void withdrawAll(destination, (e) => job.events.push(e), port())
      .then(() => {
        job.running = false;
        job.done = true;
      })
      .catch((err) => {
        job.running = false;
        job.done = true;
        job.error = getErrorMessage(err);
      });
    return c.json({ success: true, data: { started: true } } as APIResponse);
  });

  app.get("/withdraw", (c) =>
    c.json({
      success: true,
      data: withdraw ?? { running: false, done: false, events: [] },
    } as APIResponse)
  );

  return app;
}
