import { AsyncLocalStorage } from "node:async_hooks";
import type { HookRegistry } from "./registry.js";
import type { HookHandlerMap, HookName, HookRunnerOptions } from "./types.js";
import { getErrorMessage } from "../../utils/errors.js";

const DEFAULT_TIMEOUT_MS = 5000;

async function withTimeout(
  fn: () => void | Promise<void>,
  ms: number,
  label: string,
  _log: HookRunnerOptions["logger"]
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(fn()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Hook timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Hooks that support short-circuit via block=true */
const BLOCKABLE_HOOKS: ReadonlySet<HookName> = new Set([
  "tool:before",
  "message:receive",
  "response:before",
]);

export function createHookRunner(registry: HookRegistry, opts: HookRunnerOptions) {
  // Per-async-context depth: concurrent unrelated events each start at 0, while
  // true synchronous reentrancy (a hook re-entering the runner in the same call
  // stack) is still detected because AsyncLocalStorage propagates to child contexts.
  const depthStorage = new AsyncLocalStorage<number>();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const catchErrors = opts.catchErrors ?? true;

  function currentDepth(): number {
    return depthStorage.getStore() ?? 0;
  }

  async function runModifyingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    const depth = currentDepth();
    if (!registry.hasHooks(name) || depth > 0) {
      if (depth > 0) {
        opts.logger.debug(`Skipping ${name} hooks (reentrancy depth=${depth})`);
      }
      return;
    }

    const hooks = registry.getHooks(name); // pre-sorted by effectivePriority in registry
    return depthStorage.run(depth + 1, async () => {
      for (const hook of hooks) {
        const label = `${hook.pluginId}:${name}`;
        const t0 = Date.now();
        try {
          await withTimeout(
            () => (hook.handler as (e: typeof event) => void | Promise<void>)(event),
            timeoutMs,
            label,
            opts.logger
          );
        } catch (err) {
          if (catchErrors) {
            opts.logger.error(
              `Hook error [${label}]: ${getErrorMessage(err)} (after ${Date.now() - t0}ms)`
            );
          } else {
            throw err;
          }
        }

        // Short-circuit for blockable hooks when block=true
        if (BLOCKABLE_HOOKS.has(name) && (event as { block?: boolean }).block) {
          break;
        }
      }
    });
  }

  async function runObservingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    const depth = currentDepth();
    if (!registry.hasHooks(name) || depth > 0) {
      if (depth > 0) {
        opts.logger.debug(`Skipping ${name} hooks (reentrancy depth=${depth})`);
      }
      return;
    }

    const hooks = registry.getHooks(name); // order irrelevant — parallel execution
    return depthStorage.run(depth + 1, async () => {
      // Observing hooks run in parallel (no order guarantees)
      const results = await Promise.allSettled(
        hooks.map(async (hook) => {
          const label = `${hook.pluginId}:${name}`;
          const t0 = Date.now();
          try {
            await withTimeout(
              () => (hook.handler as (e: typeof event) => void | Promise<void>)(event),
              timeoutMs,
              label,
              opts.logger
            );
          } catch (err) {
            if (catchErrors) {
              opts.logger.error(
                `Hook error [${label}]: ${getErrorMessage(err)} (after ${Date.now() - t0}ms)`
              );
            } else {
              throw err;
            }
          }
        })
      );

      // When catchErrors=false, re-throw the first rejection that allSettled absorbed
      if (!catchErrors) {
        const firstRejected = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        if (firstRejected) throw firstRejected.reason;
      }
    });
  }

  return {
    runModifyingHook,
    runObservingHook,
    get depth() {
      return currentDepth();
    },
  };
}
