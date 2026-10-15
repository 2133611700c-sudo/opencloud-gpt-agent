import { createHash, timingSafeEqual } from 'node:crypto';

import { requirePhonePublicBaseUrl } from '../phone/terminal-phone-publication.mjs';
import { persistUserHttpIntake, requireUserHttpPrincipal, UserHttpIntakeError } from './user-http-intake.mjs';

const MAX_BODY_BYTES = 20_000;
const BODY_TIMEOUT_MS = 5_000;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i;
const response = (status, value, headers = {}) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const reject = (code) => { throw new UserHttpIntakeError(code); };

async function readBody(request) {
  const rawLength = request.headers.get('content-length');
  if (rawLength !== null && !/^(0|[1-9]\d*)$/.test(rawLength)) reject('CONTENT_LENGTH_INVALID');
  const expectedLength = rawLength === null ? null : Number(rawLength);
  if (expectedLength !== null && (!Number.isSafeInteger(expectedLength) || expectedLength > MAX_BODY_BYTES)) reject('BODY_TOO_LARGE');
  if (!request.body) reject('REQUEST_JSON_INVALID');
  const reader = request.body.getReader();
  let timer;
  let completed = false;
  const timeout = new Promise((_, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new UserHttpIntakeError('BODY_TIMEOUT')), BODY_TIMEOUT_MS);
  });
  try {
    let length = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) reject('BODY_INVALID');
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) reject('BODY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    if (expectedLength !== null && expectedLength !== length) reject('CONTENT_LENGTH_INVALID');
    let body;
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)); }
    catch { reject('BODY_UTF8_INVALID'); }
    completed = true;
    return body;
  } finally {
    clearTimeout(timer);
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createUserHttpHandler({ kernel, secret, principalId, publicBaseUrl, now = () => new Date() } = {}) {
  if (!kernel || typeof kernel.createLiteResearchTask !== 'function') throw new TypeError('kernel.createLiteResearchTask must be a function');
  if (typeof secret !== 'string' || !/^\S{32,512}$/.test(secret)) throw new TypeError('secret must contain 32 to 512 non-whitespace characters');
  requireUserHttpPrincipal(principalId);
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const origin = requirePhonePublicBaseUrl(publicBaseUrl);
  const expected = createHash('sha256').update(secret, 'utf8').digest();

  return async function handleUserHttp(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/research/tasks' || url.search || url.hash) return response(404, { error: 'NOT_FOUND' });
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
    const authorization = request.headers.get('authorization');
    if (typeof authorization !== 'string' || !/^Bearer \S{32,512}$/.test(authorization)
        || !timingSafeEqual(expected, createHash('sha256').update(authorization.slice(7), 'utf8').digest())) {
      return response(401, { error: 'UNAUTHORIZED' });
    }
    const contentType = request.headers.get('content-type');
    const encoding = request.headers.get('content-encoding');
    if (!contentType || !JSON_CONTENT_TYPE.test(contentType) || (encoding !== null && encoding.toLowerCase() !== 'identity')) {
      return response(415, { error: 'CONTENT_TYPE_UNSUPPORTED' });
    }
    const requestId = request.headers.get('idempotency-key');
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(requestId)) {
      return response(400, { error: 'REQUEST_ID_INVALID' });
    }
    try {
      const body = await readBody(request);
      // Reject the intake credential before persistence, including escaped JSON
      // strings. It is a transport credential, never part of a research goal.
      let decoded;
      try { decoded = JSON.stringify(JSON.parse(body)); } catch { reject('REQUEST_JSON_INVALID'); }
      if (body.includes(secret) || decoded.includes(secret)) reject('SENSITIVE_REQUEST_CONTENT');
      const result = await persistUserHttpIntake({ body, requestId, principalId, kernel, now });
      return response(202, {
        taskId: result.taskId,
        created: result.created,
        idempotencyKey: result.idempotencyKey,
        phoneUrl: `${origin}/tasks/${result.taskId}/phone`,
        deepLogUrl: `${origin}/tasks/${result.taskId}/deep-log`,
      });
    } catch (error) {
      if (error instanceof UserHttpIntakeError) {
        const status = error.code === 'BODY_TOO_LARGE' ? 413 : error.code === 'BODY_TIMEOUT' ? 408 : 400;
        return response(status, { error: error.code });
      }
      if (error?.code === 'P0001' && error.message === 'idempotency key reused with different request contract') {
        return response(409, { error: 'IDEMPOTENCY_CONFLICT' });
      }
      if (error?.code === 'P0001' && error.message === 'deadline must be in the future') {
        return response(400, { error: 'DEADLINE_EXPIRED' });
      }
      return response(503, { error: 'INTAKE_UNAVAILABLE' });
    }
  };
}
