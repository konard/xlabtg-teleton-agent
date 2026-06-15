import { describe, expect, it, vi } from "vitest";

import { runLatestRequest } from "../latestRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runLatestRequest", () => {
  it("ignores a stale response that resolves after a newer request", async () => {
    const requestRef = { current: 0 };
    const slow = deferred<string>();
    const fast = deferred<string>();
    const apply = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();

    const slowRequest = runLatestRequest(requestRef, () => slow.promise, {
      onSuccess: apply,
      onError: fail,
      onFinally: finish,
    });
    const fastRequest = runLatestRequest(requestRef, () => fast.promise, {
      onSuccess: apply,
      onError: fail,
      onFinally: finish,
    });

    fast.resolve("newer");
    await fastRequest;

    expect(apply).toHaveBeenCalledWith("newer");
    expect(finish).toHaveBeenCalledTimes(1);

    slow.resolve("stale");
    await slowRequest;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale error and finalizer after a newer request starts", async () => {
    const requestRef = { current: 0 };
    const stale = deferred<string>();
    const current = deferred<string>();
    const apply = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();

    const staleRequest = runLatestRequest(requestRef, () => stale.promise, {
      onSuccess: apply,
      onError: fail,
      onFinally: finish,
    });
    const currentRequest = runLatestRequest(requestRef, () => current.promise, {
      onSuccess: apply,
      onError: fail,
      onFinally: finish,
    });

    stale.reject(new Error("old failure"));
    await staleRequest;

    expect(fail).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();

    current.resolve("current");
    await currentRequest;

    expect(apply).toHaveBeenCalledWith("current");
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
