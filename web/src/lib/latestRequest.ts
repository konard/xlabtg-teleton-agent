export type LatestRequestRef = { current: number };

export async function runLatestRequest<T>(
  requestRef: LatestRequestRef,
  run: () => Promise<T>,
  handlers: {
    onSuccess: (result: T) => void;
    onError: (error: unknown) => void;
    onFinally?: () => void;
  }
): Promise<void> {
  const requestId = requestRef.current + 1;
  requestRef.current = requestId;

  try {
    const result = await run();
    if (requestRef.current !== requestId) return;
    handlers.onSuccess(result);
  } catch (error) {
    if (requestRef.current !== requestId) return;
    handlers.onError(error);
  } finally {
    if (requestRef.current === requestId) {
      handlers.onFinally?.();
    }
  }
}
