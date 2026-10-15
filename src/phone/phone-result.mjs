const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAIL_WITH_EVIDENCE']);
const SENSITIVE_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential)/i;

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
};

const cleanText = (value, name, max = 240) => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) throw new TypeError(`${name} must not be empty`);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const parseNonnegativeInteger = (value, name) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  throw new TypeError(`${name} must be a nonnegative safe integer`);
};

const parseUsdMicros = (value, name) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new TypeError(`${name} must be a nonnegative USD decimal with at most 6 fractional digits`);
  }
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 1_000_000n) + BigInt((fraction + '000000').slice(0, 6));
};

const formatUsdMicros = (micros) => {
  const whole = micros / 1_000_000n;
  const fraction = String(micros % 1_000_000n).padStart(6, '0');
  return `$${whole}.${fraction}`;
};

const isPrivateIpv4 = (hostname) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const requireDeepLogUrl = (value) => {
  const raw = cleanText(value, 'deepLogUrl', 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError('deepLogUrl must be an absolute URL');
  }
  if (url.protocol !== 'https:') throw new TypeError('deepLogUrl must use https');
  if (url.username || url.password) throw new TypeError('deepLogUrl must not contain credentials');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]' || host === '::1' || isPrivateIpv4(host)) {
    throw new TypeError('deepLogUrl must be publicly routable');
  }
  return url.toString();
};

const evidenceCostMicros = (bundle) => {
  const taskCost = parseUsdMicros(bundle.task.currentCostUsd, 'task.currentCostUsd');
  if (!Array.isArray(bundle.accounting)) throw new TypeError('accounting must be an array');
  const accountingCost = bundle.accounting.reduce((sum, row, index) => {
    requireObject(row, `accounting[${index}]`);
    return sum + parseUsdMicros(row.costUsd, `accounting[${index}].costUsd`);
  }, 0n);
  if (accountingCost !== taskCost) throw new Error('task cost does not match accounting total');
  return taskCost;
};

const formatScalar = (value) => {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
};

const formatItem = (item, index) => {
  requireObject(item, `data.items[${index}]`);
  const title = typeof item.title === 'string' && item.title.trim() ? cleanText(item.title, `data.items[${index}].title`, 120) : cleanText(item.id, `data.items[${index}].id`, 120);
  const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {};
  const details = Object.keys(data)
    .sort()
    .filter((key) => !SENSITIVE_KEY.test(key))
    .map((key) => [key, formatScalar(data[key])])
    .filter(([, value]) => value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`);
  const line = `${index + 1}. ${title}${details.length ? ` — ${details.join('; ')}` : ''}`;
  return line.length <= 240 ? line : `${line.slice(0, 239)}…`;
};

const attemptCount = (bundle) => {
  requireObject(bundle.attemptCounters, 'attemptCounters');
  return parseNonnegativeInteger(bundle.attemptCounters.totalAttempts, 'attemptCounters.totalAttempts');
};

const unresolvedReservations = (bundle) => {
  if (!Array.isArray(bundle.reservations)) throw new TypeError('reservations must be an array');
  return bundle.reservations.filter((reservation) => reservation?.status === 'RESERVED').length;
};

const assertTerminalClean = (bundle) => {
  if (!TERMINAL_STATUSES.has(bundle.task.status)) throw new Error('phone result requires a terminal SUCCESS or FAIL_WITH_EVIDENCE task');
  if (!Array.isArray(bundle.nodes) || bundle.nodes.length === 0) throw new TypeError('nodes must be a non-empty array');
  if (bundle.nodes.some((node) => node?.status === 'RUNNING')) throw new Error('terminal Evidence cannot contain RUNNING nodes');
};

const successLines = (bundle) => {
  const dataNode = bundle.nodes.find((node) => node?.nodeKey === 'data' && node?.status === 'SUCCESS');
  if (!dataNode || !dataNode.result || dataNode.result.status !== 'SUCCESS' || !Array.isArray(dataNode.result.items) || dataNode.result.items.length === 0) {
    throw new Error('SUCCESS phone result requires production Data items');
  }
  return dataNode.result.items.slice(0, 5).map(formatItem);
};

const failureReason = (bundle) => {
  const codes = bundle.nodes
    .filter((node) => node?.error && typeof node.error.code === 'string' && node.error.code.trim())
    .map((node) => node.error.code.trim())
    .filter((code, index, all) => all.indexOf(code) === index);
  const terminal = cleanText(bundle.task.terminalReason, 'task.terminalReason', 120);
  return codes.length ? `${terminal} / ${codes.slice(0, 2).join(', ')}` : terminal;
};

export function formatPhoneResult({ evidence, deepLogUrl } = {}) {
  const bundle = requireObject(evidence, 'evidence');
  bundle.task = requireObject(bundle.task, 'task');
  assertTerminalClean(bundle);

  const url = requireDeepLogUrl(deepLogUrl);
  const costMicros = evidenceCostMicros(bundle);
  const attempts = attemptCount(bundle);
  const status = bundle.task.status;
  const lines = [`[${status}]`];

  if (status === 'SUCCESS') {
    lines.push(...successLines(bundle));
  } else {
    const unresolved = unresolvedReservations(bundle);
    const reservedCost = parseUsdMicros(bundle.task.reservedCostUsd, 'task.reservedCostUsd');
    const reservedTokens = parseNonnegativeInteger(bundle.task.reservedTokens, 'task.reservedTokens');
    if (unresolved !== 0 || reservedCost !== 0n || reservedTokens !== 0) {
      throw new Error('FAIL_WITH_EVIDENCE cannot prove zero further paid calls while reservations remain');
    }
    const succeeded = bundle.nodes.filter((node) => node?.status === 'SUCCESS').length;
    const steps = parseNonnegativeInteger(bundle.task.currentSteps, 'task.currentSteps');
    lines.push(`Reason: ${failureReason(bundle)}`);
    lines.push(`Progress: ${succeeded}/${bundle.nodes.length} nodes succeeded; steps=${steps}`);
    lines.push('Further calls: blocked by terminal task; unresolved reservations=0');
  }

  lines.push(`Cost: ${formatUsdMicros(costMicros)}`);
  lines.push(`Attempts: ${attempts}`);
  lines.push(`Deep log: ${url}`);

  return Object.freeze({ status, deepLogUrl: url, lines: Object.freeze(lines), text: lines.join('\n') });
}
