export function buildHealth() {
  return {
    system: 'openclaw-v2',
    phase: 1,
    phase_name: 'foundation',
    status: 'PASS',
    schema_version: 1
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(buildHealth())}\n`);
}
