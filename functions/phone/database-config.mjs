/** Keep credential-bearing URL parse errors out of function startup logs. */
export function phoneDatabaseOptions(databaseUrl) {
  let connection;
  try {
    if (typeof databaseUrl !== 'string' || !databaseUrl) throw new Error();
    connection = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname) throw new Error();
  } catch {
    throw new Error('PHONE_DATABASE_CONFIGURATION_INVALID');
  }
  // Neon injects the branch connection; explicitly select this application's DB.
  connection.pathname = '/openclaw_v2';
  return {
    connectionString: connection.toString(), max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, statement_timeout: 5000,
  };
}
