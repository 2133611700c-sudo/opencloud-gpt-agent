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
  'package.json',
  'src/health.mjs',
  'tests/health.test.mjs',
  '.github/workflows/v2-ci.yml'
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
