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
const modelsLatencyMs = Date.now() - modelsStarted;
if (!modelsResponse.ok) throw new Error(`models request failed HTTP ${modelsResponse.status}`);

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
  'End with one line exactly in this format using plain decimal digits without separators: x=<integer>, y=<integer>',
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
if (!response.ok) throw new Error(`completion failed HTTP ${response.status}: ${result?.error?.message || 'unknown error'}`);

const message = result?.choices?.[0]?.message ?? {};
const content = typeof message.content === 'string' ? message.content : '';
const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
const compact = content.replace(/[\s,_]/g, '');
const answerCorrect = compact.includes('x=1766319049') && compact.includes('y=226153980');
const equationCorrect = 1766319049n ** 2n - 61n * (226153980n ** 2n) === 1n;
const modelCorrect = result.model === 'deepseek-v4-pro';
const reasoningPresent = reasoning.length > 0;
const status = modelCorrect && reasoningPresent && answerCorrect && equationCorrect ? 'PASS_LIVE' : 'FAIL_LIVE';

const evidence = {
  status,
  capability: 'deepseek_v4_pro_max_reasoning',
  modelsHttp: modelsResponse.status,
  modelsLatencyMs,
  availableModels,
  completionHttp: response.status,
  requestedModel: 'deepseek-v4-pro',
  responseModel: result.model,
  thinking: 'enabled',
  reasoningEffort: 'max',
  reasoningPresent,
  reasoningChars: reasoning.length,
  finishReason: result?.choices?.[0]?.finish_reason ?? null,
  answerCorrect,
  equationCorrect,
  latencyMs,
  usage: result?.usage ?? null,
  finalAnswer: content,
};

await mkdir('a8-output', { recursive: true });
await writeFile('a8-output/v4-pro-max-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile('a8-output/index.html', `<!doctype html><meta charset="utf-8"><title>DeepSeek V4 Pro ${status}</title><h1>DeepSeek V4 Pro MAX ${status}</h1>\n`);
console.log(`DEEPSEEK_V4_PRO_MAX_RESULT ${JSON.stringify(evidence)}`);
if (status !== 'PASS_LIVE') process.exit(1);
NODE
