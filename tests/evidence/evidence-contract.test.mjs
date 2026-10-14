import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEvidenceBundle, createEvidenceArtifact, validateEvidenceBundle, EvidenceContractError } from '../../src/evidence/evidence-contract.mjs';
import { transformData } from '../../src/data/data-transformer.mjs';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const at = '2026-10-14T10:00:00.123456Z';
const fixture = () => {
  const taskId = uuid(1); const researchId = uuid(2); const dataId = uuid(3); const lease = uuid(4);
  const result = { status: 'SUCCESS', summary: 'Verified model', confidence: 'HIGH', sources: [{ id: 's1', title: 'Source', url: 'https://example.com/docs', checkedAt: at }], items: [{ id: 'i1', title: 'Model', data: { price: 0, active: false, values: ['b', 'a'] }, sourceIds: ['s1'] }], needsBrowser: [] };
  const task = { id: taskId, goal: 'Research a model', request_payload: { requiredFields: ['price', 'active'], maxResults: 3, constraints: { requiredDomains: ['example.com'] } }, status: 'SUCCESS', terminal_reason: 'ALL_NODES_SUCCEEDED', terminal_detail: {}, budget_limit_usd: '1.000000', current_cost_usd: '0.000003', reserved_cost_usd: '0', token_budget_limit: '100', current_tokens: '9', reserved_tokens: '0', max_total_steps: 10, current_steps: 2, created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00Z' };
  const node = (nodeId, nodeKey, agent, output) => ({ id: nodeId, task_id: taskId, node_key: nodeKey, agent_id: agent, status: 'SUCCESS', attempt: 1, max_attempts: 3, output_data: output, last_error: null, reserved_cost_usd: '0', reserved_tokens: '0', created_at: at, updated_at: at, started_at: at, finished_at: at });
  const accounting = { id: uuid(5), task_id: taskId, node_id: researchId, lease_token: lease, call_key: 'research:fixture', provider: 'deepseek', model: 'deepseek-flash', pricing_version: 'fixture-v1', provider_request_id: 'session-1', prompt_cache_hit_tokens: '2', prompt_cache_miss_tokens: '3', completion_tokens: '4', total_tokens: '9', reserved_cost_usd: '0.100000', cost_usd: '0.000003', latency_ms: 0, created_at: at, accounting_basis: 'OBSERVED_USAGE' };
  const reservation = { id: uuid(6), task_id: taskId, node_id: researchId, lease_token: lease, reservation_key: 'research:fixture', status: 'RECONCILED', reserved_cost_usd: '0.100000', reserved_tokens: '100', actual_cost_usd: '0.000003', actual_tokens: '9', reconciliation_basis: 'OBSERVED_USAGE', created_at: at, reconciled_at: at, released_at: null, release_reason: null };
  return { task, nodes: [node(researchId, 'research', 'researcher', result), node(dataId, 'data', 'data', transformData({ requiredFields: task.request_payload.requiredFields, researchResult: result }))], dependencies: [{ task_id: taskId, node_id: dataId, parent_node_id: researchId }], accounting: [accounting], reservations: [reservation] };
};
const reject = (snapshot, code) => assert.throws(() => buildEvidenceBundle(snapshot), (error) => error instanceof EvidenceContractError && (!code || error.code === code));
const failure = () => {
  const snapshot = fixture();
  Object.assign(snapshot.task, { status: 'FAIL_WITH_EVIDENCE', terminal_reason: 'NODE_FAILED', current_cost_usd: '0', current_tokens: '0', current_steps: 1 });
  Object.assign(snapshot.nodes[0], { status: 'FAIL_WITH_EVIDENCE', output_data: null, last_error: { code: 'RUNTIME_FAILED', message: 'Must not be preserved' } });
  Object.assign(snapshot.nodes[1], { status: 'BLOCKED', output_data: null, attempt: 0, started_at: null, last_error: { reason: 'UPSTREAM_FAILED' } });
  snapshot.accounting = [];
  Object.assign(snapshot.reservations[0], { status: 'RELEASED', actual_cost_usd: null, actual_tokens: null, reconciled_at: null, released_at: at, release_reason: 'NODE_FAILED' });
  return snapshot;
};

test('terminal SUCCESS produces immutable, linked version1 evidence without invented history', () => {
  const snapshot = fixture(); const before = structuredClone(snapshot); const bundle = buildEvidenceBundle(snapshot);
  assert.deepEqual(snapshot, before); assert.equal(bundle.schemaVersion, 1); assert.equal(bundle.task.status, 'SUCCESS');
  assert.equal(bundle.task.currentCostUsd, '0.000003'); assert.equal(bundle.task.currentTokens, '9');
  assert.equal(bundle.accounting[0].reservationId, snapshot.reservations[0].id); assert.equal(bundle.reservations[0].accountingId, snapshot.accounting[0].id);
  assert.equal(bundle.nodes[1].result.items[0].data.price, 0); assert.equal(bundle.nodes[1].result.items[0].data.active, false);
  assert.deepEqual(bundle.nodes[1].result.items[0].data.values, ['b', 'a']); assert.equal(bundle.task.terminalAt, at);
  assert.equal(bundle.coverage.runtimeReceiptsPresent, false); assert.equal(bundle.coverage.runtimeVerification, 'NOT_PROVEN'); assert.equal(bundle.coverage.attemptHistory, 'NOT_PROVEN'); assert.equal(bundle.coverage.judgeVerdict, 'NOT_PROVEN');
  assert.equal(bundle.integrity.canonicalDataVerifiedBeforeRedaction, true); assert.equal(bundle.integrity.canonicalDataVerifiedAtRetrieval, true); assert.equal(bundle.attemptCounters.totalAttempts, '2');
  assert.equal(Object.isFrozen(bundle.nodes[0].result.items[0].data), true); assert.throws(() => { bundle.task.status = 'RUNNING'; }, TypeError);
});

test('failure retains released ledger, safe errors and attempt0 blocked descendants', () => {
  const bundle = buildEvidenceBundle(failure());
  assert.equal(bundle.nodes[1].startedAt, null); assert.equal(bundle.nodes[1].attempt, 0); assert.equal(bundle.nodes[1].result, null);
  assert.deepEqual(bundle.nodes[0].error, { code: 'RUNTIME_FAILED' }); assert.equal(bundle.agentsExecuted.length, 1);
  assert.equal(bundle.reservations[0].accountingId, null); assert.equal(bundle.task.currentCostUsd, '0.000000'); assert.equal(bundle.nextAction, 'Review durable evidence before retrying.');
});

test('failure can preserve malformed acceptance payload without fabricating criteria', () => {
  const snapshot = failure(); snapshot.task.request_payload = 17;
  assert.deepEqual(buildEvidenceBundle(snapshot).acceptanceCriteria, { goal: snapshot.task.goal, valid: false, verification: 'NOT_PROVEN', reason: 'INVALID_REQUEST_PAYLOAD' });
  const success = fixture(); success.task.request_payload = 17; reject(success);
});

test('cancelled, blocked and empty-DAG terminal snapshots are representable', () => {
  for (const status of ['CANCELLED', 'BLOCKED', 'FAIL_WITH_EVIDENCE']) {
    const snapshot = failure(); snapshot.task.status = status; snapshot.task.current_steps = 0; snapshot.nodes = []; snapshot.dependencies = []; snapshot.reservations = [];
    assert.equal(buildEvidenceBundle(snapshot).task.status, status);
  }
});

test('nodeSUCCESS and taskFAIL stay distinct after deadline finalization', () => {
  const snapshot = fixture(); snapshot.task.status = 'FAIL_WITH_EVIDENCE'; snapshot.task.terminal_reason = 'DEADLINE_EXCEEDED';
  const bundle = buildEvidenceBundle(snapshot); assert.equal(bundle.task.status, 'FAIL_WITH_EVIDENCE'); assert.equal(bundle.nodes[1].status, 'SUCCESS'); assert.equal(bundle.integrity.canonicalDataVerifiedBeforeRedaction, true);
});

test('canonical UTF8 bytes and SHA256 are deterministic across row/key ordering', () => {
  const snapshot = fixture(); snapshot.task.goal = 'Модель 📱';
  const reverse = (value) => Array.isArray(value) ? value.map(reverse) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
  const permuted = reverse(snapshot); permuted.nodes.reverse();
  const a = createEvidenceArtifact(snapshot); const b = createEvidenceArtifact(permuted);
  assert.equal(a.serialized, b.serialized); assert.equal(a.sha256, b.sha256); assert.equal(a.sizeBytes, Buffer.byteLength(a.serialized, 'utf8'));
  assert.equal(a.sha256, createHash('sha256').update(a.serialized).digest('hex')); assert.deepEqual(JSON.parse(a.serialized), a.bundle);
  assert.equal(Object.hasOwn(a.bundle, 'sha256'), false); assert.equal(Object.hasOwn(a.bundle, 'capturedAt'), false);
});

test('meaningful custom arrays retain their order in canonical bytes', () => {
  const a = fixture(); const b = fixture(); b.nodes[0].output_data.items[0].data.values.reverse(); b.nodes[1].output_data = transformData({ requiredFields: b.task.request_payload.requiredFields, researchResult: b.nodes[0].output_data });
  assert.notEqual(createEvidenceArtifact(a).sha256, createEvidenceArtifact(b).sha256);
});

test('safe decimal strings and DB BIGINT strings retain exact precision', () => {
  const snapshot = failure(); snapshot.task.token_budget_limit = '9223372036854775807';
  assert.equal(buildEvidenceBundle(snapshot).task.tokenBudgetLimit, '9223372036854775807');
  for (const value of [Number.MAX_SAFE_INTEGER + 1, '9223372036854775808', '-1', '1.2']) { const bad = failure(); bad.task.current_tokens = value; reject(bad, 'EVIDENCE_COUNTER_INVALID'); }
  for (const value of ['0.0000001', '-0.1', '1e-6', 0.0000001, '1000000']) { const bad = failure(); bad.task.budget_limit_usd = value; reject(bad, 'EVIDENCE_MONEY_INVALID'); }
});

test('zero-cost zero-token accounting remains legitimate and fully reconciled', () => {
  const snapshot = fixture(); snapshot.task.current_cost_usd = 0; snapshot.task.current_tokens = 0;
  Object.assign(snapshot.accounting[0], { cost_usd: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  Object.assign(snapshot.reservations[0], { actual_cost_usd: 0, actual_tokens: 0 });
  assert.equal(buildEvidenceBundle(snapshot).accounting[0].costUsd, '0.000000');
});

test('reservation fallback retains explicit accounting basis and exact conservative charge', () => {
  const snapshot = fixture(); Object.assign(snapshot.task, { current_cost_usd: '0.100000', current_tokens: '100' });
  Object.assign(snapshot.accounting[0], { accounting_basis: 'RESERVATION_FALLBACK', cost_usd: '0.100000', prompt_cache_hit_tokens: '0', prompt_cache_miss_tokens: '100', completion_tokens: '0', total_tokens: '100' });
  Object.assign(snapshot.reservations[0], { reconciliation_basis: 'RESERVATION_FALLBACK', actual_cost_usd: '0.100000', actual_tokens: '100' });
  assert.equal(buildEvidenceBundle(snapshot).accounting[0].basis, 'RESERVATION_FALLBACK');
  snapshot.accounting[0].completion_tokens = '1'; snapshot.accounting[0].prompt_cache_miss_tokens = '99'; reject(snapshot, 'EVIDENCE_LEDGER_INVALID');
});

test('historical reservation fencing matches accounting rather than terminal node lease', () => {
  const snapshot = fixture(); snapshot.nodes[0].lease_token = null; assert.equal(buildEvidenceBundle(snapshot).accounting.length, 1);
  snapshot.reservations[0].lease_token = uuid(999); reject(snapshot, 'EVIDENCE_LEDGER_INVALID');
});

test('reject cross-task/node ledger, dependencies and duplicated identities', () => {
  for (const mutate of [(s) => { s.nodes[0].task_id = uuid(99); }, (s) => { s.accounting[0].node_id = uuid(99); }, (s) => { s.reservations[0].task_id = uuid(99); }, (s) => { s.dependencies[0].parent_node_id = uuid(99); }, (s) => { s.nodes.push(structuredClone(s.nodes[0])); }, (s) => { s.accounting.push(structuredClone(s.accounting[0])); }, (s) => { s.reservations.push(structuredClone(s.reservations[0])); }, (s) => { s.dependencies.push(structuredClone(s.dependencies[0])); }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot); }
});

test('reject missing/ambiguous ledger and mismatched reserved/actual/basis/call key', () => {
  for (const mutate of [(s) => { s.reservations = []; }, (s) => { s.reservations[0].reservation_key = 'other'; }, (s) => { s.reservations[0].actual_tokens = '8'; }, (s) => { s.reservations[0].actual_cost_usd = '0.000004'; }, (s) => { s.reservations[0].reconciliation_basis = 'RESERVATION_FALLBACK'; }, (s) => { s.accounting[0].reserved_cost_usd = '0.200000'; }, (s) => { s.reservations[0].reconciled_at = null; }, (s) => { s.accounting[0].completion_tokens = '3'; }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot); }
});

test('released reservations cannot hide accounting or actual charge', () => {
  for (const mutate of [(s) => { s.reservations[0].actual_tokens = '0'; }, (s) => { s.reservations[0].actual_cost_usd = '0'; }, (s) => { s.reservations[0].released_at = null; }]) { const snapshot = failure(); mutate(snapshot); reject(snapshot); }
});

test('task totals must include every accounting row exactly', () => {
  for (const [key, value] of [['current_cost_usd', '0.000004'], ['current_tokens', '10']]) { const snapshot = fixture(); snapshot.task[key] = value; reject(snapshot, 'EVIDENCE_ACCOUNTING_MISMATCH'); }
  const missing = fixture(); missing.accounting = []; missing.reservations = []; missing.task.current_cost_usd = '0'; missing.task.current_tokens = '0'; reject(missing, 'EVIDENCE_ACCOUNTING_MISSING');
});

test('terminal snapshot cannot retain active nodes or unresolved reservations', () => {
  for (const status of ['PENDING', 'RUNNING', 'AWAITING_APPROVAL']) { const snapshot = fixture(); snapshot.nodes[0].status = status; reject(snapshot, 'EVIDENCE_ACTIVE_NODE'); }
  for (const mutate of [(s) => { s.task.status = 'RUNNING'; }, (s) => { s.task.reserved_cost_usd = '0.000001'; }, (s) => { s.nodes[1].reserved_tokens = '1'; }, (s) => { s.reservations[0].status = 'RESERVED'; }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot); }
});

test('Data cannot contain model accounting or reservations', () => {
  for (const collection of ['accounting', 'reservations']) { const snapshot = fixture(); snapshot[collection][0].node_id = snapshot.nodes[1].id; reject(snapshot); }
});

test('reject fake gate-only Data, corrupt canonical Data and lost source/dependency linkage', () => {
  for (const mutate of [(s) => { s.nodes[1].output_data = { status: 'SUCCESS', completionMode: 'DETERMINISTIC_LIVE_GATE_COMPLETION' }; }, (s) => { s.nodes[1].output_data.items[0].data.price = 1; }, (s) => { s.nodes[1].output_data.items[0].sourceIds = ['missing']; }, (s) => { s.dependencies = []; }, (s) => { s.nodes[0].status = 'BLOCKED'; }, (s) => { s.task.terminal_reason = 'OTHER'; }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot); }
});

test('durable receipt joins historical ledger and separates observed from configured metadata', () => {
  const snapshot = fixture(); snapshot.runtimeReceipts = [{ id: uuid(7), task_id: snapshot.task.id, node_id: snapshot.nodes[0].id, call_key: snapshot.accounting[0].call_key, lease_token: snapshot.accounting[0].lease_token, recorded_at: at, observed: { provider: 'deepseek', model: 'deepseek-flash', sessionId: 'session-1', toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 0, totalToolTimeMs: 0 } }, configured: { runtimeVersion: '2026.9.8', requestedModel: 'deepseek/deepseek-flash', modelRelease: 'DeepSeek-V4.1-Flash', thinkingLevel: 'max' }, trace: [{ event: 'ACCOUNTING_RECONCILED', at }], error: null }];
  const bundle = buildEvidenceBundle(snapshot); assert.equal(bundle.coverage.runtimeReceiptsPresent, true); assert.equal(bundle.coverage.toolMetadataPresent, true); assert.equal(bundle.coverage.runtimeVerification, 'NOT_PROVEN');
  assert.deepEqual(bundle.runtimeReceipts[0].observed.toolSummary.tools, ['web_fetch', 'web_search']); assert.equal(bundle.runtimeReceipts[0].configured.thinkingLevel, 'max'); assert.equal(Object.hasOwn(bundle.runtimeReceipts[0].observed, 'modelRelease'), false);
  for (const mutate of [(s) => { s.runtimeReceipts[0].task_id = uuid(99); }, (s) => { s.runtimeReceipts[0].lease_token = uuid(99); }, (s) => { s.runtimeReceipts[0].observed.model = 'other'; }, (s) => { s.runtimeReceipts[0].observed.toolSummary.failures = 3; }, (s) => { s.runtimeReceipts[0].observed.toolSummary.tools = ['exec']; }, (s) => { s.runtimeReceipts[0].trace[0].event = 'private thoughts'; }]) { const bad = structuredClone(snapshot); mutate(bad); reject(bad); }
});

test('descriptor strict JSON rejects accessors without invocation and unsupported values', () => {
  let called = false; const accessor = fixture(); Object.defineProperty(accessor, 'omitted', { enumerable: true, get() { called = true; return 'never'; } }); reject(accessor, 'EVIDENCE_INVALID_JSON'); assert.equal(called, false);
  const unsupported = [NaN, Infinity, undefined, 1n, () => {}, Symbol('x'), new Date(), new Map(), Object.create({ custom: true })];
  for (const value of unsupported) { const snapshot = fixture(); snapshot.omitted = value; reject(snapshot, 'EVIDENCE_INVALID_JSON'); }
  const cycle = fixture(); cycle.omitted = cycle; reject(cycle, 'EVIDENCE_INVALID_JSON');
  const sparse = fixture(); sparse.omitted = Array(1); reject(sparse, 'EVIDENCE_INVALID_JSON');
  const hidden = fixture(); Object.defineProperty(hidden, 'omitted', { value: 'hidden' }); reject(hidden, 'EVIDENCE_INVALID_JSON');
  const named = fixture(); named.omitted = []; named.omitted.extra = 1; reject(named, 'EVIDENCE_INVALID_JSON');
});

test('shared plain references and null prototypes remain valid finite JSON', () => {
  const snapshot = fixture(); const shared = Object.assign(Object.create(null), { safe: 0 }); snapshot.omittedA = shared; snapshot.omittedB = shared;
  assert.equal(buildEvidenceBundle(snapshot).redaction.applied, false);
});

test('allowlist omits raw process/envelope/notes/messages and private reasoning recursively', () => {
  const snapshot = fixture(); const privateText = 'Never export private reasoning text';
  snapshot.environment = { arbitrary: privateText }; snapshot.accounting[0].accounting_note = privateText;
  snapshot.nodes[0].last_error = { code: 'SAFE_CODE', message: privateText, stack: privateText };
  snapshot.nodes[0].output_data.items[0].data.reasoning_content = privateText; snapshot.nodes[0].output_data.items[0].data.nested = { chainOfThought: privateText, safe: false, headers: { custom: privateText }, prompt: privateText };
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot); assert.equal(artifact.serialized.includes(privateText), false); assert.equal(artifact.serialized.includes('chainOfThought'), false);
  assert.equal(artifact.bundle.redaction.applied, true); assert.deepEqual(artifact.bundle.nodes[1].result.items[0].data.nested, { safe: false });
});

test('supplied opaque credentials are removed from values, keys and encoded URLs', () => {
  const secret = ['opaque', 'fixture', 'credential'].join('-'); const snapshot = fixture();
  snapshot.task.goal = `Inspect ${secret}`; snapshot.nodes[0].output_data.sources[0].url = `https://example.com/${encodeURIComponent(secret)}?q=${encodeURIComponent(encodeURIComponent(secret))}#${secret}`;
  snapshot.nodes[0].output_data.items[0].data[secret] = secret;
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot, { sensitiveValues: [secret] });
  assert.equal(artifact.serialized.includes(secret), false); assert.equal(artifact.bundle.redaction.applied, true); assert.equal(artifact.serialized.includes('[REDACTED]'), true);
});

test('known credential patterns, sensitive keys and sourceURL credentials are sanitized', () => {
  const apiKey = ['sk', 'a'.repeat(24)].join('-'); const database = ['postgresql', '://', 'fixture', ':', 'synthetic', '@example.com/db'].join('');
  const snapshot = fixture(); snapshot.task.goal = `Use ${apiKey} and ${database}`;
  snapshot.nodes[0].output_data.sources[0].url = 'https://fixture:synthetic@example.com/docs?token=opaque-token&safe=1#fragment';
  Object.assign(snapshot.nodes[0].output_data.items[0].data, { apiKey, nested: { database_url: database, password: 'synthetic' }, authorization: 'Bearer opaque-bearer' });
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot); for (const value of [apiKey, database, 'opaque-token', 'opaque-bearer', 'synthetic']) assert.equal(artifact.serialized.includes(value), false);
  assert.equal(artifact.bundle.nodes[1].result.items[0].data.apiKey, '[REDACTED]'); assert.equal(artifact.bundle.redaction.applied, true);
});

test('redacted key/sourceID collisions fail closed and errors do not echo secrets', () => {
  const secretA = ['sk', 'a'.repeat(24)].join('-'); const secretB = ['sk', 'b'.repeat(24)].join('-');
  const snapshot = fixture(); snapshot.nodes[0].output_data.items[0].data[secretA] = 1; snapshot.nodes[0].output_data.items[0].data[secretB] = 2;
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  assert.throws(() => buildEvidenceBundle(snapshot), (error) => error.code === 'EVIDENCE_REDACTION_COLLISION' && !error.message.includes(secretA) && !error.message.includes(secretB));
  const identifiers = fixture(); identifiers.nodes[0].output_data.sources = [{ ...identifiers.nodes[0].output_data.sources[0], id: secretA }, { ...identifiers.nodes[0].output_data.sources[0], id: secretB, url: 'https://example.com/other' }]; identifiers.nodes[0].output_data.items[0].sourceIds = [secretA, secretB]; identifiers.nodes[1].output_data = transformData({ requiredFields: identifiers.task.request_payload.requiredFields, researchResult: identifiers.nodes[0].output_data });
  reject(identifiers, 'EVIDENCE_REDACTION_COLLISION');
});

test('invalid timestamps, impossible counters and malformed options produce safe errors', () => {
  for (const mutate of [(s) => { s.task.terminal_at = null; }, (s) => { s.task.created_at = '2026-10-15T00:00:00Z'; }, (s) => { s.nodes[1].attempt = 4; }, (s) => { s.task.current_steps = 11; }, (s) => { s.nodes[0].finished_at = 'private timestamp value'; }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot); }
  assert.throws(() => buildEvidenceBundle(fixture(), { sensitiveValues: [123] }), EvidenceContractError);
});

test('retrieved public bundle validates schema, reciprocal ledger and exact task totals', () => {
  const artifact = createEvidenceArtifact(fixture()); const parsed = JSON.parse(artifact.serialized);
  assert.deepEqual(validateEvidenceBundle(parsed), artifact.bundle);
  for (const mutate of [(b) => { b.schemaVersion = 2; }, (b) => { b.task.status = 'RUNNING'; }, (b) => { b.accounting[0].reservationId = uuid(999); }, (b) => { b.reservations[0].accountingId = uuid(999); }, (b) => { b.task.currentCostUsd = '0.000004'; }, (b) => { b.nodes[1].result.items[0].data.price = 1; }, (b) => { b.coverage.attemptHistory = 'RECORDED'; }, (b) => { b.rawEnvelope = {}; }, (b) => { b.task.secret = 'opaque'; }]) { const bad = structuredClone(parsed); mutate(bad); assert.throws(() => validateEvidenceBundle(bad), EvidenceContractError); }
});

test('public contract preserves safe product extensions needed for canonical dedupe', () => {
  const snapshot = fixture(); snapshot.nodes[0].output_data.sources[0].extension = { checked: false };
  snapshot.nodes[0].output_data.items[0].extension = [0, false];
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot); const bundle = validateEvidenceBundle(JSON.parse(artifact.serialized));
  assert.deepEqual(bundle.nodes[1].result.sources[0].extension, { checked: false }); assert.deepEqual(bundle.nodes[0].result.items[0].extension, [0, false]);
});

test('URL percent encoding cannot hide caller-supplied or recognizable credential values', () => {
  const secret = ['opaque', ' +/ ', 'fixture'].join(''); const known = ['sk', 'c'.repeat(24)].join('-'); const snapshot = fixture();
  const encodedKnown = Array.from(known).map((char) => `%${char.charCodeAt(0).toString(16)}`).join('');
  snapshot.nodes[0].output_data.sources[0].url = `https://example.com/${encodeURIComponent(secret).toLowerCase()}?q=${encodeURIComponent(encodeURIComponent(secret)).toLowerCase()}#${encodedKnown}`;
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot, { sensitiveValues: [secret] });
  const url = artifact.bundle.nodes[1].result.sources[0].url; assert.equal(decodeURIComponent(url).includes(secret), false); assert.equal(decodeURIComponent(url).includes(known), false);
});

test('public retrieval rejects unsafe strings and private reasoning even under a matching schema', () => {
  for (const mutate of [(b) => { b.task.terminalReason = ['sk', 'd'.repeat(24)].join('-'); }, (b) => { b.acceptanceCriteria.constraints.chainOfThought = 'private text'; }, (b) => { b.nodes[0].result.items[0].data.headers = { authorization: 'opaque' }; }]) {
    const bundle = JSON.parse(createEvidenceArtifact(fixture()).serialized); mutate(bundle); assert.throws(() => validateEvidenceBundle(bundle), EvidenceContractError);
  }
});

test('private error prose, reasoning aliases and think blocks never enter evidence', () => {
  const privateText = 'Hidden private reasoning sentinel'; const snapshot = fixture();
  snapshot.nodes[0].last_error = { code: privateText, reason: privateText, message: privateText };
  snapshot.task.terminal_detail = { code: privateText, reason: privateText };
  Object.assign(snapshot.nodes[0].output_data.items[0].data, { thinking_text: privateText, private_reasoning: privateText, internal_analysis: privateText, chain_of_thought_text: privateText, process_stdout: privateText, user_prompt: privateText });
  snapshot.nodes[0].output_data.summary += ` <think>${privateText}</think>`;
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
  const artifact = createEvidenceArtifact(snapshot); assert.equal(artifact.serialized.includes(privateText), false); assert.deepEqual(artifact.bundle.nodes[0].error, {});
  assert.equal(artifact.bundle.integrity.canonicalDataVerifiedBeforeRedaction, true); assert.equal(artifact.bundle.integrity.canonicalDataVerifiedAtRetrieval, false);
});

test('redaction of structural identity/status/counters fails closed across the graph', () => {
  for (const secret of [fixture().task.id, fixture().nodes[0].id, fixture().accounting[0].id, fixture().reservations[0].id, 'SUCCESS', '0.000003']) {
    assert.throws(() => buildEvidenceBundle(fixture(), { sensitiveValues: [secret] }), EvidenceContractError);
  }
});

test('node chronology and distinct-tool invocation counts must be possible', () => {
  const snapshot = fixture(); snapshot.nodes[0].finished_at = '2026-10-14T10:01:00Z'; reject(snapshot, 'EVIDENCE_TIMESTAMP_INVALID');
  const publicBundle = JSON.parse(createEvidenceArtifact(fixture()).serialized); publicBundle.nodes[0].startedAt = '2026-10-14T10:01:00Z'; assert.throws(() => validateEvidenceBundle(publicBundle), EvidenceContractError);
  const receipt = fixture(); receipt.runtimeReceipts = [{ id: uuid(7), task_id: receipt.task.id, node_id: receipt.nodes[0].id, call_key: receipt.accounting[0].call_key, lease_token: receipt.accounting[0].lease_token, recorded_at: at, observed: { provider: 'deepseek', model: 'deepseek-flash', sessionId: 'session-1', toolSummary: { calls: 1, tools: ['web_search', 'web_fetch'], failures: 0 } } }]; reject(receipt, 'EVIDENCE_RECEIPT_INVALID');
});

test('proxies are rejected before descriptor/prototype traps execute', () => {
  let called = false; const snapshot = fixture(); snapshot.omitted = new Proxy({}, { getPrototypeOf() { called = true; return Object.prototype; }, ownKeys() { called = true; return []; } });
  reject(snapshot, 'EVIDENCE_INVALID_JSON'); assert.equal(called, false);
});

test('calendar validation and nanosecond chronology reject normalized or truncated invalid times', () => {
  for (const value of ['2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z', '2026-13-01T00:00:00Z', '2026-10-14T24:00:00Z', '2026-10-14T10:00:00+24:00', '2026-10-14T10:00:00.123455Z']) { const snapshot = fixture(); snapshot.task.terminal_at = value; reject(snapshot, 'EVIDENCE_TIMESTAMP_INVALID'); }
  const bundle = JSON.parse(createEvidenceArtifact(fixture()).serialized); bundle.nodes[0].finishedAt = '2026-10-14T10:00:00.123456001Z'; assert.throws(() => validateEvidenceBundle(bundle), EvidenceContractError);
  const equivalent = fixture(); equivalent.nodes[0].finished_at = '2026-10-14T12:00:00.123456+02:00'; assert.equal(buildEvidenceBundle(equivalent).nodes[0].finishedAt, equivalent.nodes[0].finished_at);
});

test('source timestamps must be real calendar instants even after a valid canonical Data transform', () => {
  for (const value of ['2026-02-30T10:00:00Z', '2026-10-14T24:00:00Z']) {
    const snapshot = fixture(); snapshot.nodes[0].output_data.sources[0].checkedAt = value;
    snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: snapshot.nodes[0].output_data });
    reject(snapshot, 'EVIDENCE_TIMESTAMP_INVALID');
  }
});

test('successful nodes and ledger require an executed attempt and steps reconcile to all attempts', () => {
  for (const mutate of [(s) => { s.nodes[0].attempt = 0; s.nodes[0].started_at = null; s.task.current_steps = 1; }, (s) => { s.nodes[1].attempt = 0; s.nodes[1].started_at = null; s.task.current_steps = 1; }, (s) => { s.task.current_steps = 0; }]) { const snapshot = fixture(); mutate(snapshot); reject(snapshot, 'EVIDENCE_COUNTER_INVALID'); }
  const ledger = failure(); ledger.nodes[0].attempt = 0; ledger.nodes[0].started_at = null; ledger.task.current_steps = 0; reject(ledger, 'EVIDENCE_COUNTER_INVALID');
  const publicBundle = JSON.parse(createEvidenceArtifact(fixture()).serialized); publicBundle.nodes[0].attempt = 0; publicBundle.nodes[0].startedAt = null; publicBundle.task.currentSteps = 1; assert.throws(() => validateEvidenceBundle(publicBundle), EvidenceContractError);
});

test('authentic redaction cannot hide forged retained Data facts at retrieval', () => {
  const snapshot = fixture(); snapshot.task.goal += ` ${['sk', 'e'.repeat(24)].join('-')}`;
  const bundle = JSON.parse(createEvidenceArtifact(snapshot).serialized); assert.equal(bundle.redaction.applied, true);
  assert.equal(bundle.integrity.canonicalDataVerifiedAtRetrieval, false);
  for (const mutate of [(b) => { b.nodes[1].result.items[0].data.price = 999; }, (b) => { b.nodes[1].result.items[0].title = 'Forged title'; }, (b) => { b.nodes[1].result.sources[0].url = 'https://example.com/forged'; }, (b) => { b.nodes[1].result.items[0].id = 'forged'; }]) {
    const bad = structuredClone(bundle); mutate(bad); assert.throws(() => validateEvidenceBundle(bad), EvidenceContractError);
  }
});

test('public provenance still covers deduped representatives, aliases and unused sources', () => {
  const snapshot = fixture(); const result = snapshot.nodes[0].output_data;
  result.sources.push({ ...result.sources[0], id: 's2' }, { id: 's3', url: 'https://example.com/unused', checkedAt: at });
  result.items.push({ ...structuredClone(result.items[0]), id: 'i2', sourceIds: ['s2'] });
  snapshot.nodes[1].output_data = transformData({ requiredFields: snapshot.task.request_payload.requiredFields, researchResult: result });
  const bundle = createEvidenceArtifact(snapshot).bundle; assert.equal(bundle.nodes[1].result.items.length, 1); assert.equal(bundle.nodes[1].result.sources.length, 2);
  assert.deepEqual(validateEvidenceBundle(JSON.parse(JSON.stringify(bundle))), bundle);
});
