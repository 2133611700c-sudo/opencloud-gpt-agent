import { access, readFile, readdir } from 'node:fs/promises';

const required = [
  'README.md',
  'START_HERE.md',
  'SYSTEM.md',
  'PROJECT_STATE.json',
  'docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md',
  'docs/02_48H_WALKING_SKELETON.md',
  'docs/EXECUTION_LOG.md',
  'docs/RESULTS_JOURNAL.md',
  'docs/FINAL_48.md',
  'package.json',
  'src/health.mjs',
  'tests/health.test.mjs',
  '.github/workflows/v2-ci.yml',
  '.github/workflows/v2-live-prerequisites.yml',
];

for (const path of required) await access(path);

const root = new Set(await readdir('.'));
const forbiddenLegacyRoots = ['ops', 'products'];
for (const name of forbiddenLegacyRoots) {
  if (root.has(name)) throw new Error(`legacy root present in clean V2 tree: ${name}`);
}

const workflow = await readFile('.github/workflows/v2-ci.yml', 'utf8');
if (!workflow.includes('group: openclaw-v2-shared-hosted-state')) {
  throw new Error('V2 CI must serialize access to shared hosted state');
}
if (!workflow.includes('cancel-in-progress: false')) {
  throw new Error('V2 CI must not cancel an in-flight hosted live gate');
}
if (/^permissions:\s+write-all\s*$/m.test(workflow)) {
  throw new Error('V2 CI must not grant write-all GitHub token permissions');
}
for (const requiredPermission of [
  'contents: read',
  'statuses: write',
  'id-token: write',
]) {
  if (!workflow.includes(requiredPermission)) {
    throw new Error(`V2 CI is missing least-privilege permission: ${requiredPermission}`);
  }
}

// Final-48 live gates are operator-controlled. Ordinary push/PR foundation work
// must remain deterministic and must never receive hosted/provider credentials.
for (const requiredLiveGateToken of [
  'live_gate:',
  '- none',
  '- hosted',
  '- kernel',
  '- smoke',
  "github.event_name == 'workflow_dispatch'",
  "github.ref == 'refs/heads/v2/openclaw-clean-20261011'",
]) {
  if (!workflow.includes(requiredLiveGateToken)) {
    throw new Error(`V2 CI is missing Final-48 live gate control: ${requiredLiveGateToken}`);
  }
}

const foundationMatch = workflow.match(/\n  foundation:\n([\s\S]*?)\n  live_request_guard:/);
if (!foundationMatch) throw new Error('V2 CI foundation/live job boundary is missing');
if (/\bsecrets\./.test(foundationMatch[1])) {
  throw new Error('ordinary foundation job must not read GitHub live secrets');
}
if (/live-research-kernel-vertical\.mjs|live-deepseek-smoke\.mjs|verify-hosted-postgres\.mjs/.test(foundationMatch[1])) {
  throw new Error('ordinary foundation job must not execute hosted or paid live gates');
}

const requireJob = (jobName, gateName) => {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  if (start < 0) throw new Error(`V2 CI is missing ${jobName}`);
  const rest = workflow.slice(start + 1);
  const nextJob = rest.search(/\n  [a-zA-Z0-9_]+:\n/);
  const section = nextJob > 0 ? rest.slice(0, nextJob) : rest;
  const requiredIf = `github.event_name == 'workflow_dispatch' && github.event.inputs.live_gate == '${gateName}'`;
  if (!section.includes(requiredIf)) {
    throw new Error(`${jobName} must be selected only by workflow_dispatch live_gate=${gateName}`);
  }
  if (!section.includes('live_request_guard')) {
    throw new Error(`${jobName} must depend on the canonical live request guard`);
  }
  return section;
};

const hostedSection = requireJob('live_hosted', 'hosted');
const kernelSection = requireJob('live_kernel', 'kernel');
const smokeSection = requireJob('live_smoke', 'smoke');

if (!hostedSection.includes('test -n "${DATABASE_URL:-}"')) {
  throw new Error('live_hosted must fail closed when DATABASE_URL is missing');
}
if (!hostedSection.includes('verify-hosted-postgres.mjs')) {
  throw new Error('live_hosted must execute hosted PostgreSQL verification');
}
if (!kernelSection.includes('test -n "${DATABASE_URL:-}"') || !kernelSection.includes('test -n "${DEEPSEEK_API_KEY:-}"')) {
  throw new Error('live_kernel must fail closed when either live secret is missing');
}
if (!kernelSection.includes('live-research-kernel-vertical.mjs')) {
  throw new Error('live_kernel must execute exactly the production Research kernel vertical');
}
if (kernelSection.includes('live-deepseek-smoke.mjs')) {
  throw new Error('live_kernel must not also execute the provider smoke');
}
if (!smokeSection.includes('test -n "${DEEPSEEK_API_KEY:-}"')) {
  throw new Error('live_smoke must fail closed when DEEPSEEK_API_KEY is missing');
}
if (!smokeSection.includes('live-deepseek-smoke.mjs')) {
  throw new Error('live_smoke must execute the isolated provider smoke');
}
if (smokeSection.includes('live-research-kernel-vertical.mjs')) {
  throw new Error('live_smoke must not also execute the Kernel Research vertical');
}

const countOccurrences = (value, needle) => value.split(needle).length - 1;
if (countOccurrences(workflow, 'live-research-kernel-vertical.mjs') !== 1) {
  throw new Error('V2 CI must contain exactly one paid Kernel Research command');
}
if (countOccurrences(workflow, 'live-deepseek-smoke.mjs') !== 1) {
  throw new Error('V2 CI must contain exactly one provider smoke command');
}

const liveGuardMatch = workflow.match(/\n  live_request_guard:\n([\s\S]*?)\n  live_hosted:/);
if (!liveGuardMatch) throw new Error('V2 CI live request guard is missing');
if (!liveGuardMatch[1].includes("test \"$GITHUB_REF\" = 'refs/heads/v2/openclaw-clean-20261011'")) {
  throw new Error('V2 live request guard must reject non-canonical branches');
}

const prerequisiteWorkflow = await readFile('.github/workflows/v2-live-prerequisites.yml', 'utf8');
if (!prerequisiteWorkflow.includes('workflow_dispatch:')) {
  throw new Error('V2 live prerequisite workflow must remain manual');
}
if (/^\s*push:\s*$/m.test(prerequisiteWorkflow) || /^\s*pull_request:\s*$/m.test(prerequisiteWorkflow)) {
  throw new Error('V2 live prerequisite workflow must not run on push or pull_request');
}
if (!prerequisiteWorkflow.includes("test \"$GITHUB_REF\" = 'refs/heads/v2/openclaw-clean-20261011'")) {
  throw new Error('V2 live prerequisite workflow must reject non-canonical branches');
}
for (const secretName of ['DATABASE_URL', 'DEEPSEEK_API_KEY']) {
  if (!prerequisiteWorkflow.includes(`${secretName}: PRESENT`) || !prerequisiteWorkflow.includes(`${secretName}: MISSING`)) {
    throw new Error(`V2 live prerequisite workflow must report only presence for ${secretName}`);
  }
}
if (!prerequisiteWorkflow.includes('No secret values were printed.')) {
  throw new Error('V2 live prerequisite workflow must explicitly preserve secret-value confidentiality');
}

const router = await readFile('START_HERE.md', 'utf8');
for (const requiredPointer of [
  'docs/02_48H_WALKING_SKELETON.md',
  'PROJECT_STATE.json',
  'docs/RESULTS_JOURNAL.md',
  'SKIPPED',
]) {
  if (!router.includes(requiredPointer)) {
    throw new Error(`START_HERE.md is missing mandatory routing pointer: ${requiredPointer}`);
  }
}

const journal = await readFile('docs/RESULTS_JOURNAL.md', 'utf8');
if (!/^## JRNL-/m.test(journal)) {
  throw new Error('RESULTS_JOURNAL.md must contain at least one checkpoint entry');
}
if (!journal.includes('### Route decision')) {
  throw new Error('RESULTS_JOURNAL.md latest history must preserve an explicit route decision');
}

let state;
try {
  state = JSON.parse(await readFile('PROJECT_STATE.json', 'utf8'));
} catch (error) {
  throw new Error(`PROJECT_STATE.json must be valid JSON: ${error.message}`);
}

if (state.schema_version !== 2) throw new Error('PROJECT_STATE.json schema_version must be 2');
if (state.operational_router !== 'START_HERE.md') throw new Error('PROJECT_STATE operational_router must point to START_HERE.md');
if (state.canonical_48h_plan !== 'docs/02_48H_WALKING_SKELETON.md') throw new Error('PROJECT_STATE canonical_48h_plan is incorrect');
if (state.results_journal !== 'docs/RESULTS_JOURNAL.md') throw new Error('PROJECT_STATE results_journal is incorrect');
if (state.architecture_source !== 'SYSTEM.md') throw new Error('PROJECT_STATE architecture_source is incorrect');
if (state.walking_skeleton_gate !== 'IN_PROGRESS' && !String(state.walking_skeleton_gate).startsWith('PASS')) {
  throw new Error('PROJECT_STATE walking_skeleton_gate must be IN_PROGRESS or an explicit PASS state');
}
if (typeof state.route_id !== 'string' || state.route_id.trim() === '') throw new Error('PROJECT_STATE route_id is required');
if (typeof state.next_action !== 'string' || state.next_action.trim() === '') throw new Error('PROJECT_STATE next_action is required');

// PROJECT_STATE is a current checkpoint, not an append-only history surface.
// These older narrative mirrors duplicated canonical completion truth and already
// drifted once; historical wording belongs in RESULTS_JOURNAL / EXECUTION_LOG.
for (const deprecatedField of ['acceptance_notes', 'user_intake']) {
  if (Object.hasOwn(state, deprecatedField)) {
    throw new Error(`PROJECT_STATE contains deprecated duplicate field: ${deprecatedField}`);
  }
}

const scopeEntries = Object.entries(state.scope_map_48h ?? {});
const acceptanceEntries = Object.entries(state.acceptance_map ?? {});
if (scopeEntries.length !== 15) throw new Error(`PROJECT_STATE scope_map_48h must contain exactly 15 items; found ${scopeEntries.length}`);
if (acceptanceEntries.length !== 9) throw new Error(`PROJECT_STATE acceptance_map must contain exactly 9 items; found ${acceptanceEntries.length}`);

const evidencePrefixes = [
  'PASS_CODE_CI',
  'PASS_HOSTED',
  'PASS_LIVE',
  'SKIPPED',
  'NOT_PROVEN',
  'DRIFT',
  'NOT_BUILT',
  'BLOCKED',
];
const validateEvidenceMap = (entries, label) => {
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || !evidencePrefixes.some((prefix) => value.startsWith(prefix))) {
      throw new Error(`${label}.${key} must start with a canonical evidence label; got ${String(value)}`);
    }
  }
};
validateEvidenceMap(scopeEntries, 'scope_map_48h');
validateEvidenceMap(acceptanceEntries, 'acceptance_map');

const truthLabels = new Set(state.truth_labels ?? []);
for (const label of evidencePrefixes) {
  if (!truthLabels.has(label)) throw new Error(`PROJECT_STATE truth_labels is missing ${label}`);
}

if (String(state.walking_skeleton_gate).startsWith('PASS')) {
  const unfinished = [...scopeEntries, ...acceptanceEntries].filter(([, value]) => !String(value).startsWith('PASS_'));
  if (unfinished.length > 0) {
    throw new Error(`Walking Skeleton cannot be PASS while ${unfinished.length} mapped gates are unfinished`);
  }

  const requiredLiveCompletion = [
    ['route_prerequisites.current_full_positive_e2e', state.route_prerequisites?.current_full_positive_e2e],
    ['route_prerequisites.automatic_phone_publication', state.route_prerequisites?.automatic_phone_publication],
    ['route_prerequisites.external_user_ingress', state.route_prerequisites?.external_user_ingress],
    ['user_http_intake.status', state.user_http_intake?.status],
    ['48h_completion.status', state['48h_completion']?.status],
  ];
  for (const [label, value] of requiredLiveCompletion) {
    if (value !== 'PASS_LIVE') throw new Error(`Walking Skeleton PASS requires ${label}=PASS_LIVE; got ${String(value)}`);
  }

  const completionTaskId = state['48h_completion']?.final_external_task_id;
  const taskIdentities = [
    ['48h_completion.final_external_task_id', completionTaskId],
    ['user_http_intake.task_id', state.user_http_intake?.task_id],
    ['live_capabilities.final_external_paid_success.task_id', state.live_capabilities?.final_external_paid_success?.task_id],
    ['evidence.final_external_task_id', state.evidence?.final_external_task_id],
  ];
  for (const [label, value] of taskIdentities) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Walking Skeleton PASS requires ${label}`);
    if (value !== completionTaskId) throw new Error(`Walking Skeleton final task identity drift at ${label}`);
  }

  const completionArtifactId = state['48h_completion']?.artifact_id;
  const artifactIdentities = [
    ['48h_completion.artifact_id', completionArtifactId],
    ['live_capabilities.final_external_paid_success.artifact_id', state.live_capabilities?.final_external_paid_success?.artifact_id],
    ['evidence.final_external_artifact_id', state.evidence?.final_external_artifact_id],
  ];
  for (const [label, value] of artifactIdentities) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Walking Skeleton PASS requires ${label}`);
    if (value !== completionArtifactId) throw new Error(`Walking Skeleton final artifact identity drift at ${label}`);
  }

  const completionReceiptId = state['48h_completion']?.runtime_receipt_id;
  const receiptIdentities = [
    ['48h_completion.runtime_receipt_id', completionReceiptId],
    ['live_capabilities.final_external_paid_success.runtime_receipt_id', state.live_capabilities?.final_external_paid_success?.runtime_receipt_id],
    ['evidence.final_external_runtime_receipt_id', state.evidence?.final_external_runtime_receipt_id],
  ];
  for (const [label, value] of receiptIdentities) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`Walking Skeleton PASS requires ${label}`);
    if (value !== completionReceiptId) throw new Error(`Walking Skeleton final runtime receipt identity drift at ${label}`);
  }
}

// The historical paid Research prerequisite and the final current-production positive
// E2E are intentionally separate. Production Data/Evidence/Phone were allowed only
// after the historical Research gate passed; acceptance #1 may later return to
// NOT_PROVEN when the map is tightened to require the complete current composition.
const historicalResearchStatus = state.route_prerequisites?.historical_research_gate
  ?? state.acceptance_map?.['01_positive_real_research_e2e_success'];
if (historicalResearchStatus !== 'PASS_LIVE') {
  const forbidden = new Set(state.forbidden_until_live_research_pass ?? []);
  for (const requiredBlock of ['production_data_result_runtime', 'durable_evidence_feature_layer', 'phone_ux']) {
    if (!forbidden.has(requiredBlock)) {
      throw new Error(`PROJECT_STATE must block ${requiredBlock} until the historical live Research prerequisite is PASS_LIVE`);
    }
  }
}

// Gap inventory evolves as independently verified gates close; its size is not a schema invariant.
const gapMap = state.remaining_48h_gaps;
if (!gapMap || typeof gapMap !== 'object' || Array.isArray(gapMap)) {
  throw new Error('PROJECT_STATE remaining_48h_gaps must be an object');
}
const remaining48hGaps = Object.entries(gapMap);
validateEvidenceMap(remaining48hGaps, 'remaining_48h_gaps');
if (String(state.walking_skeleton_gate).startsWith('PASS') && remaining48hGaps.length !== 0) {
  throw new Error('Walking Skeleton cannot be PASS while remaining_48h_gaps is nonempty');
}

console.log('FOUNDATION_PASS');
console.log('ROUTE_MAP_PASS');
