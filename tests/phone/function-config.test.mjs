import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneDatabaseOptions } from '../../functions/phone/database-config.mjs';

test('malformed function database configuration never exposes URL input or credentials', () => {
  const password = 'synthetic-credential';
  for (const value of [undefined, '', ['postgresql:', '//reader:', password, '@'].join(''), 'file:///tmp/db']) {
    assert.throws(() => phoneDatabaseOptions(value), (error) => {
      assert.equal(error.message, 'PHONE_DATABASE_CONFIGURATION_INVALID');
      assert.equal(Object.hasOwn(error, 'input'), false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.ok(!String(error.stack).includes(password));
      return true;
    });
  }
});

test('function connects to the injected branch while selecting the explicit V2 database', () => {
  const input = ['postgresql:', '//reader:synthetic@ep-fixture.neon.tech/neondb?sslmode=require'].join('');
  const options = phoneDatabaseOptions(input);
  const url = new URL(options.connectionString);
  assert.equal(url.hostname, 'ep-fixture.neon.tech');
  assert.equal(url.pathname, '/openclaw_v2');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(options.max, 3);
  assert.equal(options.statement_timeout, 5000);
});
