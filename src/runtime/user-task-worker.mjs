import { userHttpIdempotencyKey } from '../intake/user-http-intake.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

/**
 * Bounded external-request worker. Pre-arm before HTTP delivery; discover the
 * durable task by the client's request id, never create a second task here.
 * One execution only: execution/publication failures require an explicit resume.
 */
export async function runUserTaskWorker({
  query, runtime, principalId, requestId, maxWaitMs = 180_000,
  pollIntervalMs = 500, signal,
} = {}) {
  if (typeof query !== 'function' || typeof runtime?.runTask !== 'function') throw new TypeError('query and runtime.runTask are required');
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 600_000) throw new TypeError('maxWaitMs is out of range');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1000) throw new TypeError('pollIntervalMs is out of range');
  const key = userHttpIdempotencyKey({ principalId, requestId });
  const deadline = performance.now() + maxWaitMs;
  while (performance.now() < deadline) {
    if (signal?.aborted) fail('USER_WORKER_ABORTED');
    let result;
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('USER_WORKER_DISCOVERY_TIMEOUT'), { code: 'USER_WORKER_DISCOVERY_TIMEOUT' })),
        Math.max(1, deadline - performance.now()));
      onAbort = () => reject(Object.assign(new Error('USER_WORKER_ABORTED'), { code: 'USER_WORKER_ABORTED' }));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      result = await Promise.race([query(
        `SELECT id::text AS task_id FROM tasks
         WHERE idempotency_key=$1
           AND request_payload #>> '{source,type}'='authenticated_http'
           AND request_payload #>> '{source,principalId}'=$2
           AND request_payload #>> '{source,requestId}'=$3
         LIMIT 2`,
        [key, principalId, requestId],
      ), interrupted]);
    } catch (error) {
      if (['USER_WORKER_ABORTED', 'USER_WORKER_DISCOVERY_TIMEOUT'].includes(error?.code)) throw error;
      fail('USER_WORKER_DISCOVERY_FAILED');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    // A caller-supplied synchronous transport can block the event loop past the
    // timer. Never start paid work after the request wait/abort boundary.
    if (signal?.aborted) fail('USER_WORKER_ABORTED');
    if (performance.now() >= deadline) fail('USER_WORKER_DISCOVERY_TIMEOUT');
    if (!Array.isArray(result?.rows) || result.rows.length > 1) fail('USER_WORKER_IDENTITY_INVALID');
    if (result.rows.length === 1) {
      const id = result.rows[0]?.task_id;
      if (typeof id !== 'string' || !UUID.test(id)) fail('USER_WORKER_IDENTITY_INVALID');
      return runtime.runTask(id);
    }
    const waitMs = Math.min(pollIntervalMs, Math.max(0, deadline - performance.now()));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  fail('USER_WORKER_REQUEST_NOT_FOUND');
}
