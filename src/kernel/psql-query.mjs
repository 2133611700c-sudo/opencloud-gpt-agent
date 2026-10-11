import { createHash } from 'node:crypto';
import { execFileSync as nodeExecFileSync } from 'node:child_process';

const SAFE_PARENT_ENV = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
]);

export class PsqlQueryError extends Error {
  constructor(message, { code = 'PSQL_QUERY_FAILED', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PsqlQueryError';
    this.code = code;
  }
}

const requireSelect = (text) => {
  if (typeof text !== 'string' || !/^\s*SELECT\b/i.test(text)) {
    throw new TypeError('psql transport accepts SELECT statements only');
  }
  if (text.includes(';')) {
    throw new TypeError('psql transport rejects stacked or terminated SQL statements');
  }
  return text.trim();
};

const dollarQuote = (value) => {
  const text = String(value);
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  let suffix = 0;
  let tag;
  do {
    tag = `$ocv2_${digest}${suffix ? `_${suffix}` : ''}$`;
    suffix += 1;
  } while (text.includes(tag));
  return `${tag}${text}${tag}`;
};

const sqlLiteral = (value) => {
  if (value === null) return 'NULL';
  if (value === undefined) throw new TypeError('SQL parameter must not be undefined');
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('numeric SQL parameter must be finite');
    return String(value);
  }
  if (typeof value === 'string' || typeof value === 'bigint') return dollarQuote(value);
  throw new TypeError(`unsupported SQL parameter type: ${typeof value}`);
};

export function bindPsqlParameters(text, values = []) {
  const select = requireSelect(text);
  if (!Array.isArray(values)) throw new TypeError('SQL values must be an array');
  const referenced = new Set();
  const bound = select.replace(/\$(\d+)/g, (_, rawIndex) => {
    const index = Number(rawIndex) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) {
      throw new RangeError(`missing SQL parameter $${rawIndex}`);
    }
    referenced.add(index);
    return sqlLiteral(values[index]);
  });
  for (let index = 0; index < values.length; index += 1) {
    if (!referenced.has(index)) throw new RangeError(`unused SQL parameter $${index + 1}`);
  }
  return bound;
}

const decodeComponent = (value, label) => {
  try { return decodeURIComponent(value); }
  catch { throw new TypeError(`${label} contains invalid URL encoding`); }
};

export function postgresEnvFromDatabaseUrl(databaseUrl, parentEnv = process.env) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new TypeError('DATABASE_URL is required');
  }
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new TypeError('DATABASE_URL must use postgres or postgresql protocol');
  }
  const username = decodeComponent(parsed.username, 'DATABASE_URL username');
  const password = decodeComponent(parsed.password, 'DATABASE_URL password');
  const database = decodeComponent(parsed.pathname.replace(/^\//, ''), 'DATABASE_URL database');
  if (!parsed.hostname || !username || !database) {
    throw new TypeError('DATABASE_URL must include host, username and database');
  }

  const env = {};
  for (const key of SAFE_PARENT_ENV) {
    if (typeof parentEnv?.[key] === 'string' && parentEnv[key] !== '') env[key] = parentEnv[key];
  }
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || '5432';
  env.PGUSER = username;
  env.PGDATABASE = database;
  env.PGPASSWORD = password;
  env.PGCONNECT_TIMEOUT = '10';
  env.PGAPPNAME = parsed.searchParams.get('application_name') || 'openclaw-v2-research';

  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) env.PGSSLMODE = sslMode;
  const channelBinding = parsed.searchParams.get('channel_binding');
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  const sslRootCert = parsed.searchParams.get('sslrootcert');
  if (sslRootCert) env.PGSSLROOTCERT = sslRootCert;

  return Object.freeze(env);
}

export function createPsqlQuery({
  databaseUrl,
  parentEnv = process.env,
  execFileSyncImpl = nodeExecFileSync,
  maxBufferBytes = 5_000_000,
} = {}) {
  if (typeof execFileSyncImpl !== 'function') throw new TypeError('execFileSyncImpl must be a function');
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1024 || maxBufferBytes > 50_000_000) {
    throw new RangeError('maxBufferBytes must be an integer between 1024 and 50000000');
  }
  const pgEnv = postgresEnvFromDatabaseUrl(databaseUrl, parentEnv);

  return async function query(text, values = []) {
    const bound = bindPsqlParameters(text, values);
    const wrapped = `WITH __openclaw_query AS (${bound}) SELECT COALESCE(json_agg(row_to_json(__openclaw_query)), '[]'::json)::text FROM __openclaw_query`;
    let stdout;
    try {
      stdout = execFileSyncImpl('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-c', wrapped], {
        encoding: 'utf8',
        env: pgEnv,
        maxBuffer: maxBufferBytes,
      });
    } catch (error) {
      throw new PsqlQueryError('PostgreSQL query failed', { cause: error });
    }

    const raw = typeof stdout === 'string' ? stdout.trim() : '';
    if (!raw) return { rows: [] };
    let rows;
    try { rows = JSON.parse(raw); }
    catch (error) { throw new PsqlQueryError('PostgreSQL query returned invalid JSON', { code: 'PSQL_RESULT_INVALID', cause: error }); }
    if (!Array.isArray(rows)) throw new PsqlQueryError('PostgreSQL query result must be a JSON array', { code: 'PSQL_RESULT_INVALID' });
    return { rows };
  };
}
