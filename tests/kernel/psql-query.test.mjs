import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindPsqlParameters,
  createPsqlQuery,
  postgresEnvFromDatabaseUrl,
} from '../../src/kernel/psql-query.mjs';

test('binds parameters as non-recursive dollar-quoted literals and rejects stacked SQL', () => {
  const dangerous = "x'; DROP TABLE tasks; -- $1";
  const bound = bindPsqlParameters('SELECT $1::text AS value, $2::boolean AS enabled, $3::int AS count', [dangerous, true, 7]);
  assert.match(bound, /^SELECT \$ocv2_[0-9a-f]{16}\$/);
  assert.ok(bound.includes(dangerous));
  assert.ok(bound.includes('TRUE::boolean'));
  assert.ok(bound.includes('7::int'));
  assert.throws(() => bindPsqlParameters('DELETE FROM tasks WHERE id=$1', ['x']), /SELECT statements only/);
  assert.throws(() => bindPsqlParameters('SELECT 1; SELECT 2', []), /stacked/);
});

test('database URL becomes minimal libpq environment without forwarding unrelated secrets', () => {
  const env = postgresEnvFromDatabaseUrl(
    'postgresql://openclaw:p%40ss@ep-example.neon.tech:5432/openclaw_v2?sslmode=require&channel_binding=require',
    { PATH: '/usr/bin', HOME: '/tmp/home', DATABASE_URL: 'must-not-forward', DEEPSEEK_API_KEY: 'must-not-forward' },
  );
  assert.equal(env.PGHOST, 'ep-example.neon.tech');
  assert.equal(env.PGPORT, '5432');
  assert.equal(env.PGUSER, 'openclaw');
  assert.equal(env.PGPASSWORD, 'p@ss');
  assert.equal(env.PGDATABASE, 'openclaw_v2');
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(env.PGCHANNELBINDING, 'require');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
});

test('psql query transport keeps connection secret out of argv and parses rows', async () => {
  const calls = [];
  const databaseUrl = 'postgresql://openclaw:super-secret@ep-example.neon.tech/openclaw_v2?sslmode=require';
  const query = createPsqlQuery({
    databaseUrl,
    parentEnv: { PATH: '/usr/bin', DEEPSEEK_API_KEY: 'deepseek-secret', DATABASE_URL: databaseUrl },
    execFileSyncImpl: (file, args, options) => {
      calls.push({ file, args, options });
      return '[{"accepted":true,"node_id":"n-1"}]\n';
    },
  });

  const result = await query('SELECT $1::uuid AS node_id, $2::boolean AS accepted', ['n-1', true]);
  assert.deepEqual(result, { rows: [{ accepted: true, node_id: 'n-1' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'psql');
  assert.ok(calls[0].args.every((arg) => !arg.includes('super-secret')));
  assert.ok(calls[0].args.every((arg) => !arg.includes('postgresql://')));
  assert.equal(calls[0].options.env.PGPASSWORD, 'super-secret');
  assert.equal(calls[0].options.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(calls[0].options.env.DATABASE_URL, undefined);
  assert.match(calls[0].args.at(-1), /^WITH __openclaw_query AS \(SELECT /);
});

test('psql transport fails closed on malformed output', async () => {
  const query = createPsqlQuery({
    databaseUrl: 'postgresql://u:p@host/db',
    parentEnv: { PATH: '/usr/bin' },
    execFileSyncImpl: () => 'not-json',
  });
  await assert.rejects(() => query('SELECT $1::int AS value', [1]), (error) => error?.code === 'PSQL_RESULT_INVALID');
});
