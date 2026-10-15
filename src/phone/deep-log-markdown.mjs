const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|prompt|reasoning|chain.?of.?thought|stdout|stderr)/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TERMINAL = new Set(['SUCCESS', 'FAIL_WITH_EVIDENCE']);

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
};

const text = (value, name, max = 240) => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new TypeError(`${name} must not be empty`);
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
};

const md = (value) => String(value).replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');

const id = (value, name) => {
  const normalized = text(value, name, 128);
  if (!ID_RE.test(normalized)) throw new TypeError(`${name} has an invalid format`);
  return normalized;
};

const integer = (value, name) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new TypeError(`${name} must be a nonnegative safe integer`);
};

const usd = (value, name) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new TypeError(`${name} must be a USD decimal`);
  return value.includes('.') ? value.padEnd(value.indexOf('.') + 7, '0') : `${value}.000000`;
};

const safeUrl = (value) => {
  if (typeof value !== 'string') return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]' || host === '::1') return null;
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
  return parsed.toString();
};

const scalar = (value) => {
  if (typeof value === 'string') return text(value, 'data value', 100);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
};

const unique = (values) => [...new Set(values)];

const collectSources = (nodes) => {
  const result = [];
  const seen = new Set();
  for (const node of nodes) {
    for (const source of Array.isArray(node?.result?.sources) ? node.result.sources : []) {
      const url = safeUrl(source?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      result.push({
        title: typeof source?.title === 'string' && source.title.trim() ? text(source.title, 'source.title', 140) : null,
        url,
        checkedAt: typeof source?.checkedAt === 'string' ? text(source.checkedAt, 'source.checkedAt', 80) : null,
      });
      if (result.length >= 25) return result;
    }
  }
  return result;
};

const resultItems = (nodes) => {
  const data = nodes.find((node) => node?.nodeKey === 'data' && node?.status === 'SUCCESS');
  const items = Array.isArray(data?.result?.items) ? data.result.items : [];
  return items.slice(0, 25).map((item, index) => {
    const title = typeof item?.title === 'string' && item.title.trim()
      ? text(item.title, `items[${index}].title`, 140)
      : text(item?.id ?? `item-${index + 1}`, `items[${index}].id`, 140);
    const values = item?.data && typeof item.data === 'object' && !Array.isArray(item.data)
      ? Object.keys(item.data)
        .sort()
        .filter((key) => !SENSITIVE_KEY.test(key))
        .map((key) => [key, scalar(item.data[key])])
        .filter(([, value]) => value != null && value !== '')
        .slice(0, 6)
      : [];
    return { title, values };
  });
};

const renderAccounting = (rows) => rows.slice(0, 20).map((row, index) => {
  requireObject(row, `accounting[${index}]`);
  const provider = text(row.provider, `accounting[${index}].provider`, 80);
  const model = text(row.model, `accounting[${index}].model`, 120);
  const totalTokens = integer(row.totalTokens, `accounting[${index}].totalTokens`);
  const completionTokens = integer(row.completionTokens, `accounting[${index}].completionTokens`);
  const hit = integer(row.promptCacheHitTokens, `accounting[${index}].promptCacheHitTokens`);
  const miss = integer(row.promptCacheMissTokens, `accounting[${index}].promptCacheMissTokens`);
  const latency = integer(row.latencyMs, `accounting[${index}].latencyMs`);
  const cost = usd(row.costUsd, `accounting[${index}].costUsd`);
  const pricing = text(row.pricingVersion, `accounting[${index}].pricingVersion`, 120);
  return `- ${md(provider)}/${md(model)} — tokens ${totalTokens} (hit ${hit}, miss ${miss}, completion ${completionTokens}), latency ${latency} ms, cost $${cost}, pricing ${md(pricing)}`;
});

const renderReceipts = (receipts) => receipts.slice(0, 20).map((receipt, index) => {
  requireObject(receipt, `runtimeReceipts[${index}]`);
  const configured = requireObject(receipt.configured, `runtimeReceipts[${index}].configured`);
  const observed = receipt.observed && typeof receipt.observed === 'object' && !Array.isArray(receipt.observed) ? receipt.observed : null;
  const runtime = text(configured.runtimeVersion, `runtimeReceipts[${index}].configured.runtimeVersion`, 80);
  const requested = text(configured.requestedModel, `runtimeReceipts[${index}].configured.requestedModel`, 120);
  const thinking = text(configured.thinkingLevel, `runtimeReceipts[${index}].configured.thinkingLevel`, 40);
  const tools = observed?.toolSummary && Array.isArray(observed.toolSummary.tools)
    ? unique(observed.toolSummary.tools.filter((tool) => typeof tool === 'string').map((tool) => text(tool, 'tool', 60))).slice(0, 8)
    : [];
  const events = Array.isArray(receipt.trace)
    ? unique(receipt.trace.map((event) => typeof event?.event === 'string' ? text(event.event, 'trace.event', 80) : null).filter(Boolean)).slice(0, 8)
    : [];
  const errorCode = typeof receipt.error?.code === 'string' ? text(receipt.error.code, 'runtime error code', 120) : null;
  const parts = [`runtime ${md(runtime)}`, `model ${md(requested)}`, `thinking ${md(thinking)}`];
  if (tools.length) parts.push(`tools ${tools.map(md).join(', ')}`);
  if (events.length) parts.push(`events ${events.map(md).join(', ')}`);
  if (errorCode) parts.push(`error ${md(errorCode)}`);
  return `- ${parts.join('; ')}`;
});

export function renderDeepLogMarkdown({ evidence, artifactId, snapshotSha256 } = {}) {
  const bundle = requireObject(evidence, 'evidence');
  const task = requireObject(bundle.task, 'task');
  const taskId = id(task.id, 'task.id');
  const status = text(task.status, 'task.status', 40);
  if (!TERMINAL.has(status)) throw new Error('deep log requires terminal SUCCESS or FAIL_WITH_EVIDENCE Evidence');
  const artifact = id(artifactId, 'artifactId');
  if (typeof snapshotSha256 !== 'string' || !SHA256_RE.test(snapshotSha256)) throw new TypeError('snapshotSha256 must be a lowercase SHA-256 hex digest');
  if (!Array.isArray(bundle.nodes) || bundle.nodes.length === 0) throw new TypeError('nodes must be a non-empty array');
  if (!Array.isArray(bundle.accounting)) throw new TypeError('accounting must be an array');
  if (!Array.isArray(bundle.runtimeReceipts)) throw new TypeError('runtimeReceipts must be an array');
  if (!bundle.attemptCounters || typeof bundle.attemptCounters !== 'object') throw new TypeError('attemptCounters must be an object');

  const attempts = integer(bundle.attemptCounters.totalAttempts, 'attemptCounters.totalAttempts');
  const steps = integer(task.currentSteps, 'task.currentSteps');
  const tokens = integer(task.currentTokens, 'task.currentTokens');
  const cost = usd(task.currentCostUsd, 'task.currentCostUsd');
  const terminalReason = text(task.terminalReason, 'task.terminalReason', 120);
  const items = resultItems(bundle.nodes);
  const sources = collectSources(bundle.nodes);
  const errors = unique(bundle.nodes
    .map((node) => typeof node?.error?.code === 'string' ? text(node.error.code, 'node.error.code', 120) : null)
    .filter(Boolean));

  const lines = [
    '# OpenClaw V2 Deep Log',
    '',
    `- Task: \`${md(taskId)}\``,
    `- Status: **${md(status)}**`,
    `- Terminal reason: \`${md(terminalReason)}\``,
    `- Evidence artifact: \`${md(artifact)}\``,
    `- Snapshot SHA-256: \`${snapshotSha256}\``,
    `- Cost: **$${cost}**`,
    `- Attempts: **${attempts}**`,
    `- Steps / tokens: **${steps} / ${tokens}**`,
    '',
  ];

  if (items.length) {
    lines.push('## Result');
    for (const [index, item] of items.entries()) {
      const details = item.values.map(([key, value]) => `${md(key)}=${md(value)}`).join('; ');
      lines.push(`${index + 1}. ${md(item.title)}${details ? ` — ${details}` : ''}`);
    }
    lines.push('');
  }

  if (errors.length) {
    lines.push('## Errors', ...errors.map((code) => `- \`${md(code)}\``), '');
  }

  lines.push('## Accounting');
  lines.push(...(bundle.accounting.length ? renderAccounting(bundle.accounting) : ['- No model accounting rows.']));
  lines.push('');

  lines.push('## Runtime receipts');
  lines.push(...(bundle.runtimeReceipts.length ? renderReceipts(bundle.runtimeReceipts) : ['- No runtime receipts.']));
  lines.push('');

  lines.push('## Sources');
  lines.push(...(sources.length
    ? sources.map((source) => `- ${source.title ? `${md(source.title)} — ` : ''}<${source.url}>${source.checkedAt ? ` — checked ${md(source.checkedAt)}` : ''}`)
    : ['- No public sources.']));
  lines.push('', '_Safe operational evidence only. Prompts, secrets, stdout/stderr and private reasoning are intentionally excluded._');

  const markdown = lines.join('\n');
  if (markdown.length > 30_000) throw new Error('deep log exceeds safe mobile-readable size');
  return Object.freeze({ taskId, artifactId: artifact, snapshotSha256, markdown });
}
