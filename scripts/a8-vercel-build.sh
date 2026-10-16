#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo 'DeepSeek credential missing' >&2
  exit 1
fi

node --input-type=module <<'NODE'
import { mkdir, writeFile } from 'node:fs/promises';

const key = process.env.DEEPSEEK_API_KEY;
const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

const modelsStarted = Date.now();
const modelsResponse = await fetch('https://api.deepseek.com/models', { headers });
const modelsJson = await modelsResponse.json();
if (!modelsResponse.ok) {
  throw new Error(`models request failed HTTP ${modelsResponse.status}`);
}
const availableModels = Array.isArray(modelsJson?.data)
  ? modelsJson.data.map((entry) => entry?.id).filter(Boolean)
  : [];
if (!availableModels.includes('deepseek-v4-pro')) {
  throw new Error(`deepseek-v4-pro unavailable; models=${availableModels.join(',')}`);
}

const prompt = [
  'Solve this exactly, without external tools:',
  'Find the smallest positive nontrivial integer solution (x,y), y>0, of x^2 - 61*y^2 = 1.',
  'Give a concise proof that the pair satisfies the equation and that it is the fundamental positive solution.',
  'Your final answer must explicitly contain x=1766319049 and y=226153980 if those values are correct.',
].join('\n');

const requestBody = {
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: prompt }],
  thinking: { type: 'enabled' },
  reasoning_effort: 'max',
  max_tokens: 8000,
  stream: false,
};

const started = Date.now();
const response = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers,
  body: JSON.stringify(requestBody),
});
const result = await response.json();
const latencyMs = Date.now() - started;

if (!response.ok) {
  throw new Error(`completion failed HTTP ${response.status}: ${result?.error?.message || 'unknown error'}`);
}

const message = result?.choices?.[0]?.message ?? {};
const content = typeof message.content === 'string' ? message.content : '';
const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
const answerCorrect = content.includes('1766319049') && content.includes('226153980');
const equationCorrect = 1766319049n ** 2n - 61n * (226153980n ** 2n) === 1n;

if (result.model !== 'deepseek-v4-pro') {
  throw new Error(`unexpected response model: ${String(result.model)}`);
}
if (!reasoning) {
  throw new Error('thinking mode returned no reasoning_content');
}
if (!answerCorrect || !equationCorrect) {
  throw new Error('V4 Pro returned an incorrect or incomplete Pell solution');
}

const evidence = {
  status: 'PASS_LIVE',
  capability: 'deepseek_v4_pro_max_reasoning',
  modelsHttp: modelsResponse.status,
  modelsLatencyMs: Date.now() - modelsStarted - latencyMs,
  availableModels,
  completionHttp: response.status,
  requestedModel: 'deepseek-v4-pro',
  responseModel: result.model,
  thinking: 'enabled',
  reasoningEffort: 'max',
  reasoningChars: reasoning.length,
  finishReason: result?.choices?.[0]?.finish_reason ?? null,
  answerCorrect,
  equationCorrect,
  latencyMs,
  usage: result?.usage ?? null,
};

await mkdir('a8-output', { recursive: true });
await writeFile('a8-output/v4-pro-max-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile('a8-output/index.html', '<!doctype html><meta charset="utf-8"><title>DeepSeek V4 Pro PASS</title><h1>DeepSeek V4 Pro MAX PASS_LIVE</h1>\n');
console.log(`DEEPSEEK_V4_PRO_MAX_PASS ${JSON.stringify(evidence)}`);
NODE
