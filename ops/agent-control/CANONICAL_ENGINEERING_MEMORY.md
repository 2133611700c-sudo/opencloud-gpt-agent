# CANONICAL ENGINEERING MEMORY

Status: DRAFT — rules are being created live with the project owner.
Purpose: permanent operating memory for ChatGPT/OpenClaw work in this repository.
Update rule: this file MUST be updated in the same work cycle whenever a confirmed architectural change, important lesson, serious error, new prohibition, new acceptance criterion, new operating rule, or credential/access-map change appears.

## Rule 1 — No invention
Do not invent, fabricate, improvise missing facts, or add unsupported assumptions. Act only from the concrete situation after understanding the context and building a real map of the system. If understanding is incomplete, do not fill gaps with guesses or present an assumption as fact.

## Rule 2 — Return to primary sources when knowledge is missing
If knowledge, data, or understanding is insufficient, return to primary/original sources. Re-check the source facts, verify what is about to be done, separately verify what was already done, and compare the result against the original primary task so the work does not drift or solve the wrong problem.

## Rule 3 — Every action must have system-level purpose
Do not act merely because something can be done or because a local change looks correct. Before a significant action, understand the global goal, real value, what will concretely change after implementation, how the action affects the whole system and future steps, and whether it creates downstream problems. Every movement must contribute to the overall structure, not be an isolated brick.

## Rule 4 — Analyze completely before changing anything
During diagnosis, do not start fixing, rebuilding, or implementing changes mid-analysis. First collect facts, read source material, verify current state, map causes/dependencies/options, provide an objective assessment, and separate symptoms from root causes. Change only after the situation is understood comprehensively.

## Rule 5 — Maximum self-execution; no temporary hacks
Execute the task end-to-end whenever technically possible: investigate, compare options, choose the solution, implement, test, and drive to the intended result. Do not push work to the project owner when it can be completed with available tools and access. Difficulty is not a reason to delegate back to the owner. Do not introduce temporary hacks or changes whose only purpose is to make a current test pass. Prefer durable, system-aligned solutions. Ask for owner-only action only when an external permission or human-only control is objectively unavoidable, and only after exhausting safe available paths.

## Rule 6 — Maintain permanent project operational memory
Every serious project must maintain a continuously updated operational memory. At minimum it must include:
- Current status / entry board: current verified state, what works, what is broken, blockers, current goal, latest verified SHA/run/evidence, and one next action.
- Error history: symptom, root cause, how it was found, how it was fixed, verification test, and prevention of recurrence.
- Decision history: decision, alternatives considered, why it was chosen, and conditions for reconsideration.
- Change/improvement history: what changed and what real system value it produced.
- Verification history: exact tests executed, SHA/environment, evidence, and PASS | FAIL | BLOCKED.
- Risk state: known technical, architectural, financial, operational, and dependency risks with mitigation/control.
- Project metrics: open blockers, failed acceptance gates, flaky tests, unresolved defects, verified capabilities, regressions.
- Session/checkpoint history: entry state, discoveries, changes, verified results, unknowns, and next action.

The entry board must let a new session understand the project quickly without reconstructing history from chat. Do not rewrite history to fit a later conclusion. Supersede older claims explicitly and preserve the evidence chain.

## Rule 7 — Parallel agent execution under central supervision
Do not work as a single isolated executor when the task can be decomposed. Use available agents, subagents, specialized tools, and parallel work lanes to investigate, verify, implement, test, and review in parallel where this improves quality or speed.

For every delegated lane:
- define a concrete objective and scope;
- provide the relevant context, constraints, and expected evidence;
- grant the maximum available permissions appropriate to that scoped task;
- require a factual report with evidence and explicit unknowns;
- independently review the agent's conclusions and outputs;
- cross-check conflicting results rather than averaging them;
- keep final architectural decisions and PASS/FAIL/BLOCKED judgment under supervisor control;
- track each lane from assignment through verification to closure.

Delegation does not transfer responsibility. The supervisor remains accountable for correctness, integration, evidence quality, and the final result.

## Rule 8 — One canonical memory system, concise reporting, complete handoff
Do not create duplicate journals, duplicate status boards, or parallel truth stores when the project already has a canonical place for the information. Put every material fact in the existing authoritative artifact for that fact and keep owner-facing responses concise, factual, and decision-relevant.

For OpenClaw V2, the canonical memory map is:
- `START_HERE.md` — stable execution router and mandatory boot order.
- `PROJECT_STATE.json` — current machine-readable project checkpoint, verified baseline, gate map, current route, blockers, and next action.
- `docs/RESULTS_JOURNAL.md` — append-only route-level evidence, corrections, decisions, major errors, recoveries, and checkpoint history.
- `docs/EXECUTION_LOG.md` — detailed engineering history and implementation lessons.
- Git history, CI runs, runtime logs, hosted checks, and evidence artifacts — primary proof; these override stale summaries.
- `ops/agent-control/CANONICAL_ENGINEERING_MEMORY.md` — stable operating rules governing analysis, delegation, change, verification, recording, and handoff.
- `ops/agent-control/ACCESS_REGISTRY.md` — canonical credential-reference and runtime-access map.

Do not split error, decision, risk, verification, session, or improvement history into new files merely for neatness if the existing V2 artifacts can represent them clearly. Create a new ledger only when volume or structure makes the existing canonical artifacts objectively insufficient; record why the split is necessary and link it from the router/state.

When the project owner requests transfer to a new chat/session, the current session MUST complete the handoff before stopping:
1. Re-read current branch HEAD and exact latest CI/runtime evidence.
2. Reconcile `PROJECT_STATE.json` with actual repository/hosted/live state.
3. Append a checkpoint or correction to `docs/RESULTS_JOURNAL.md` if material truth, route, error state, or evidence changed.
4. Update this canonical memory if a rule, lesson, prohibition, or operating doctrine changed.
5. Update `ACCESS_REGISTRY.md` if any credential reference, storage location, consumer, or verification state changed.
6. Preserve exact unresolved items, blockers, risks, forbidden detours, branch/SHA/run identifiers, and the single next allowed action.
7. Produce a self-contained handoff that tells the new chat exactly what to read first and what must not be assumed.
8. Never rely on chat memory alone for a fact needed to continue the project.

Reporting rule: answer the owner briefly and plainly. Show the full important state, result, blocker, evidence, and next action, but do not spend time or tokens on repetition, filler, narration of obvious tool use, or irrelevant detail.

## Rule 9 — Canonical access/credential registry
Maintain one canonical access registry for every project so credentials and runtime access are never repeatedly rediscovered.

The registry must contain, for every credential or protected runtime variable:
- exact variable/key/reference name;
- purpose;
- native storage location or authoritative source;
- services/agents/workflows that consume it;
- verification status (present/working/not proven/revoked/obsolete as applicable);
- the last material verification/change recorded in the project journal/state when relevant.

Do not infer that a credential exists because code mentions its name. A working status requires direct evidence from the native secret store, runtime, provider, or successful authenticated execution.

Do not waste time repeatedly asking the owner to locate a credential whose canonical storage location is already known and accessible through available tools. Use the available native access path first. If a value cannot be read by design but can be used by the native runtime, verify it through a safe runtime/authenticated test and record the result.

When a credential is added, moved, rotated, revoked, replaced, or begins serving a new consumer, update the registry in the same work cycle.

## Rule 10 — Non-negotiable Truth Gate
No summary, archive, journal, state file, previous assistant statement, agent report, or inferred narrative may replace primary evidence.

Before any material conclusion, status update, architectural decision, correction, or implementation:
1. Identify the exact claim being made.
2. Identify its primary source or direct evidence.
3. Classify the claim as VERIFIED, HYPOTHESIS, UNKNOWN, PASS, FAIL, or BLOCKED.
4. Check for conflicting evidence across chat instructions, repository state, git history, CI/logs, runtime/hosted state, and primary documentation when relevant.
5. If a conflict exists, stop conclusion/implementation and reconcile the conflict first.
6. If evidence is missing, say UNKNOWN; never substitute a plausible story.
7. If a canonical file conflicts with primary evidence, primary evidence wins and the canonical file must be corrected in the same work cycle.
8. Absence of a fact from an archive or journal is never evidence that the fact did not exist.
9. A summary/archive is not trusted merely because it was previously labeled canonical; it is trusted only to the extent its claims remain traceable to current or preserved primary evidence.
10. No implementation change may begin until the Truth Gate for the problem statement and current-state map passes.

The assistant has no discretion to weaken, bypass, reinterpret, or silently override this gate for convenience, speed, continuity, or to preserve a previous conclusion.

## Canonical verification discipline
- VERIFIED: supported by repository state, logs, CI, primary documentation, live test, or equivalent direct evidence.
- HYPOTHESIS: plausible but not yet proven.
- UNKNOWN: insufficient evidence.
- PASS: the exact intended behavior is demonstrated by the required test/evidence.
- FAIL: the exact intended behavior was tested and did not meet the requirement.
- BLOCKED: the test or action could not be completed because a concrete prerequisite was unavailable.

Never promote HYPOTHESIS or UNKNOWN to VERIFIED/PASS without new evidence.
