import { mkdir, writeFile } from 'node:fs/promises';
import { runResearchAgent } from '../src/research/research-agent-runner.mjs';

const request = Object.freeze({
  goal: 'Use web_search to locate an official OpenClaw GitHub source for release v2026.10.3, then use web_fetch on at least one official source. Return exactly one sourced item. Its data must include releaseTag set to v2026.10.3 and officialSource set to the fetched official URL. Search snippets alone are insufficient: fetch an official source before answering.',
  maxResults: 1,
  constraints: Object.freeze({
    officialDomains: Object.freeze(['github.com', 'raw.githubusercontent.com']),
    requireSearch: true,
    requireFetch: true,
  }),
  requiredFields: Object.freeze(['releaseTag', 'officialSource']),
});

const run = await runResearchAgent({
  request,
  model: 'deepseek/deepseek-flash',
  env: process.env,
  timeoutMs: 120_000,
});

if (run.result.status !== 'SUCCESS') {
  throw new Error(`A8 requires SUCCESS, observed ${run.result.status}`);
}
if (run.result.items.length !== 1) {
  throw new Error(`A8 requires exactly one item, observed ${run.result.items.length}`);
}
if (run.result.sources.length < 1) {
  throw new Error('A8 requires at least one source');
}

const officialHosts = new Set(['github.com', 'raw.githubusercontent.com']);
for (const source of run.result.sources) {
  const host = new URL(source.url).hostname;
  if (!officialHosts.has(host)) throw new Error(`A8 non-official source: ${host}`);
}

const item = run.result.items[0];
if (item.data?.releaseTag !== 'v2026.10.3') {
  throw new Error(`A8 releaseTag mismatch: ${String(item.data?.releaseTag)}`);
}
if (typeof item.data?.officialSource !== 'string') {
  throw new Error('A8 officialSource missing');
}
const officialSource = new URL(item.data.officialSource);
if (!officialHosts.has(officialSource.hostname)) {
  throw new Error(`A8 officialSource host is not official: ${officialSource.hostname}`);
}
if (!run.result.sources.some((source) => source.url === officialSource.toString())) {
  throw new Error('A8 officialSource is not present in normalized sources');
}

const toolSummary = run.telemetry.toolSummary;
if (!toolSummary.tools.includes('web_search')) throw new Error('A8 missing web_search evidence');
if (!toolSummary.tools.includes('web_fetch')) throw new Error('A8 missing web_fetch evidence');
if (toolSummary.unresolvedError !== null) {
  throw new Error(`A8 has unresolved tool failure: ${toolSummary.unresolvedError.toolName}`);
}
if (run.telemetry.provider !== 'deepseek' || run.telemetry.model !== 'deepseek-flash') {
  throw new Error(`A8 provider/model mismatch: ${run.telemetry.provider}/${run.telemetry.model}`);
}

const evidence = Object.freeze({
  status: 'PASS_LIVE',
  stage: 'A8',
  capability: 'deepseek_research_agent_web_search_fetch',
  openclawVersion: '2026.10.3',
  provider: run.telemetry.provider,
  model: run.telemetry.model,
  contractStatus: run.result.status,
  sourceCount: run.result.sources.length,
  itemCount: run.result.items.length,
  sourceUrls: run.result.sources.map((source) => source.url),
  tools: [...toolSummary.tools],
  toolCalls: toolSummary.calls,
  toolFailures: toolSummary.failures,
  unresolvedToolFailure: toolSummary.unresolvedError,
  telemetryStatus: run.telemetry.telemetryStatus,
  usage: run.telemetry.usage,
  costUsd: run.telemetry.costUsd,
  assistantTurns: run.telemetry.assistantTurns,
  totalToolTimeMs: toolSummary.totalToolTimeMs,
  processExitCode: run.process.exitCode,
  processLatencyMs: run.process.latencyMs,
  secretLogged: false,
  hostedDatabaseMutations: 0,
});

await mkdir('a8-output', { recursive: true });
await writeFile('a8-output/a8-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
await writeFile('a8-output/index.html', '<!doctype html><meta charset="utf-8"><title>A8 PASS</title><h1>A8 PASS_LIVE</h1>\n', 'utf8');
console.log(`A8_PASS_LIVE ${JSON.stringify(evidence)}`);
