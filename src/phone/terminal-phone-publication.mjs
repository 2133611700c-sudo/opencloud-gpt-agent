import { createHash } from 'node:crypto';

import { serializeEvidenceBundle, validateEvidenceBundle } from '../evidence/evidence-contract.mjs';
import { renderDeepLogMarkdown } from './deep-log-markdown.mjs';
import { formatPhoneResult } from './phone-result.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const PHONE_CONTENT_TYPE = 'text/plain; charset=utf-8';
export const PHONE_IDENTITY_HEADERS = Object.freeze({
  taskId: 'X-OpenClaw-Task-Id',
  artifactId: 'X-OpenClaw-Artifact-Id',
  sha256: 'X-OpenClaw-Evidence-Sha256',
});

export class PhonePublicationError extends Error {
  constructor(code = 'PHONE_PUBLICATION_INVALID') {
    super(`Terminal phone publication failed (${code})`);
    this.name = 'PhonePublicationError';
    this.code = code;
  }
}

const fail = (code) => { throw new PhonePublicationError(code); };
export const requirePhoneTaskId = (value) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('taskId must be a lowercase UUID');
  return value;
};

export function requirePhonePublicBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value || /[?#]/.test(value)) {
    throw new TypeError('publicBaseUrl must be a public HTTPS origin');
  }
  let url;
  try { url = new URL(value); } catch { throw new TypeError('publicBaseUrl must be a public HTTPS origin'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  const privateIpv4 = ipv4 && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127
    || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127));
  const privateIpv6 = host === '[::]' || host === '[::1]' || /^\[(?:f[cd]|fe[89ab]|::ffff:)/i.test(host);
  if (url.protocol !== 'https:'
      || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || privateIpv4 || privateIpv6) {
    throw new TypeError('publicBaseUrl must be a public HTTPS origin');
  }
  return url.origin;
}

/** Render only an immutable, canonical Evidence artifact, never a raw snapshot. */
export function renderTerminalPhonePublication({ receipt, publicBaseUrl } = {}) {
  const origin = requirePhonePublicBaseUrl(publicBaseUrl);
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('PHONE_EVIDENCE_INVALID');
    const taskId = requirePhoneTaskId(receipt.taskId);
    const artifactId = requirePhoneTaskId(receipt.artifactId);
    if (receipt.uri !== `artifact://postgres/${artifactId}` || !SHA256.test(receipt.sha256)
        || typeof receipt.serialized !== 'string' || !Number.isSafeInteger(receipt.sizeBytes)
        || receipt.sizeBytes < 1 || Buffer.byteLength(receipt.serialized, 'utf8') !== receipt.sizeBytes
        || createHash('sha256').update(receipt.serialized, 'utf8').digest('hex') !== receipt.sha256) {
      fail('PHONE_EVIDENCE_INVALID');
    }
    const bundle = validateEvidenceBundle(receipt.bundle);
    if (bundle.task.id !== taskId || serializeEvidenceBundle(bundle) !== receipt.serialized) fail('PHONE_EVIDENCE_INVALID');
    const deepLogUrl = `${origin}/tasks/${taskId}/deep-log`;
    const phoneUrl = `${origin}/tasks/${taskId}/phone`;
    const deepLog = renderDeepLogMarkdown({ evidence: bundle, artifactId, snapshotSha256: receipt.sha256 });
    const phone = formatPhoneResult({ evidence: bundle, deepLogUrl });
    return Object.freeze({
      status: phone.status,
      taskId,
      artifactId,
      sha256: receipt.sha256,
      phoneUrl,
      deepLogUrl,
      text: `${phone.lines[0]}\nTask: ${taskId}\n${phone.lines.slice(1).join('\n')}`,
      deepLogText: deepLog.markdown,
    });
  } catch {
    fail('PHONE_EVIDENCE_INVALID');
  }
}

const positiveLimit = (value, name, maximum) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} is out of range`);
  return value;
};

const verifyGet = async ({ fetchImpl, url, expectedText, publication, timeoutMs, maxResponseBytes }) => {
  const controller = new AbortController();
  let reader;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      reject(new PhonePublicationError('PHONE_PUBLICATION_TIMEOUT'));
    }, timeoutMs);
  });
  const verify = async () => {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, cache: 'no-store' });
    try {
      if (controller.signal.aborted) fail('PHONE_PUBLICATION_TIMEOUT');
      if (response?.status !== 200 || response.redirected === true) fail('PHONE_PUBLICATION_HTTP_INVALID');
      if (response.url && response.url !== url) fail('PHONE_PUBLICATION_HTTP_INVALID');
      if (response.headers?.get('content-type')?.toLowerCase().replace(/\s+/g, '') !== 'text/plain;charset=utf-8') {
        fail('PHONE_PUBLICATION_HTTP_INVALID');
      }
      for (const [field, header] of Object.entries(PHONE_IDENTITY_HEADERS)) {
        if (response.headers.get(header) !== publication[field]) fail('PHONE_PUBLICATION_IDENTITY_MISMATCH');
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) fail('PHONE_PUBLICATION_BODY_TOO_LARGE');
      if (!response.body || typeof response.body.getReader !== 'function') fail('PHONE_PUBLICATION_BODY_INVALID');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let body = '';
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) fail('PHONE_PUBLICATION_BODY_INVALID');
          bytes += part.value.byteLength;
          if (bytes > maxResponseBytes) fail('PHONE_PUBLICATION_BODY_TOO_LARGE');
          body += decoder.decode(part.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (body !== expectedText) fail('PHONE_PUBLICATION_BODY_MISMATCH');
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  };
  try {
    await Promise.race([verify(), timeout]);
  } catch (error) {
    if (error instanceof PhonePublicationError) throw error;
    fail('PHONE_PUBLICATION_HTTP_FAILED');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};

/** Retries finalize/read the existing task; this API never creates or executes work. */
export function createTerminalPhonePublication({
  finalizer,
  publicBaseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxResponseBytes = 128_000,
} = {}) {
  if (typeof finalizer?.finalize !== 'function') throw new TypeError('finalizer.finalize must be a function');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const origin = requirePhonePublicBaseUrl(publicBaseUrl);
  positiveLimit(timeoutMs, 'timeoutMs', 60_000);
  positiveLimit(maxResponseBytes, 'maxResponseBytes', 1_000_000);
  return Object.freeze({
    async publish(taskId) {
      const id = requirePhoneTaskId(taskId);
      let receipt;
      try { receipt = await finalizer.finalize(id); }
      catch { fail('PHONE_EVIDENCE_FINALIZE_FAILED'); }
      const publication = renderTerminalPhonePublication({ receipt, publicBaseUrl: origin });
      if (publication.taskId !== id) fail('PHONE_EVIDENCE_TASK_MISMATCH');
      for (const [url, expectedText] of [[publication.deepLogUrl, publication.deepLogText], [publication.phoneUrl, publication.text]]) {
        await verifyGet({ fetchImpl, url, expectedText, publication, timeoutMs, maxResponseBytes });
      }
      const { deepLogText, ...result } = publication;
      return Object.freeze({ ...result, published: true });
    },
  });
}
