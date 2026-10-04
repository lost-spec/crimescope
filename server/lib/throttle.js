/**
 * Serialises upstream calls and keeps a minimum gap between them.
 *
 * GNews allows 1 request/second on the free plan. A single search here can need
 * several calls (the fallback ladder walks rungs until one returns articles), so
 * firing those rungs back to back trips the limit and the whole search fails
 * with 429 even though every individual query was valid.
 *
 * One shared gate per process means concurrent searches queue behind each other
 * instead of racing. On Vercel each instance gets its own gate, which is correct
 * as far as it goes — a shared limiter would need external storage.
 */
export function createThrottle({ minIntervalMs = 1100 } = {}) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function slot(fn) {
    const wait = lastStartedAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    return fn();
  }

  return function run(fn) {
    const result = tail.then(() => slot(fn));
    // Keep the chain alive even when a call rejects, otherwise one failure
    // would reject every queued call behind it.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}