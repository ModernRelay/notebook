import type { NotebookRuntime, RuntimeSnapshot } from "@omnigraph/runtime";

/**
 * Resolve once the runtime snapshot satisfies `predicate`, or reject on timeout.
 * The runtime test ships a 1000ms variant; a headless CLI needs a larger,
 * configurable deadline (a real server read can take seconds, especially on a
 * cold start). Always predicate on `ready || fatal` so a compatibility failure
 * rejects instead of hanging.
 */
export function waitForSnapshot(
  runtime: NotebookRuntime,
  predicate: (snapshot: RuntimeSnapshot) => boolean,
  timeoutMs: number,
): Promise<RuntimeSnapshot> {
  const current = runtime.getSnapshot();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for the notebook`));
    }, timeoutMs);
    const unsubscribe = runtime.subscribe(() => {
      const next = runtime.getSnapshot();
      if (predicate(next)) {
        clearTimeout(timer);
        unsubscribe();
        resolvePromise(next);
      }
    });
  });
}
