# CANONICAL ENGINEERING MEMORY

Status: DRAFT — rules are being created live with the project owner.
Purpose: permanent operating memory for ChatGPT/OpenClaw work in this repository.
Update rule: this file MUST be updated in the same work cycle whenever a confirmed architectural change, important lesson, serious error, new prohibition, new acceptance criterion, or new operating rule appears.

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
- Error ledger: symptom, root cause, how it was found, how it was fixed, verification test, and prevention of recurrence.
- Decision log: decision, alternatives considered, why it was chosen, and conditions for reconsideration.
- Change/improvement log: what changed and what real system value it produced.
- Verification log: exact tests executed, SHA/environment, evidence, and PASS | FAIL | BLOCKED.
- Risk register: known technical, architectural, financial, operational, and dependency risks with mitigation/control.
- Project metrics: open blockers, failed acceptance gates, flaky tests, unresolved defects, verified capabilities, regressions.
- Session/daily journal: entry state, discoveries, changes, verified results, unknowns, and next action.

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
Do not create duplicate journals, duplicate status boards, or parallel truth stores when the project already has a canonical place for the information. Put every material fact in the existing authoritative artifact for that fact and keep chat responses concise, factual, and decision-relevant.

For OpenClaw V2, the canonical memory map is:
- `START_HERE.md` — stable execution router and mandatory boot order.
- `PROJECT_STATE.json` — current machine-readable project checkpoint, verified baseline, gate map, current route, blockers, and next action.
- `docs/RESULTS_JOURNAL.md` — append-only route-level evidence, corrections, decisions, major errors, recoveries, and checkpoint history.
- `docs/EXECUTION_LOG.md` — detailed engineering history and implementation lessons.
- Git history, CI runs, runtime logs, hosted checks, and evidence artifacts — primary proof; these override stale summaries.
- `CANONICAL_ENGINEERING_MEMORY.md` — stable operating rules that govern how work is analyzed, delegated, changed, verified, recorded, and handed off.

Do not split error, decision, risk, verification, session, or improvement history into new files merely for neatness if the existing V2 artifacts can represent them clearly. Create a new ledger only when volume or structure makes the existing canonical artifacts objectively insufficient; record why the split is necessary and link it from the router/state.

When the project owner requests transfer to a new chat/session, the current session MUST complete the handoff before stopping:
1. Re-read current branch HEAD and exact latest CI/runtime evidence.
2. Reconcile `PROJECT_STATE.json` with actual repository/hosted/live state.
3. Append a checkpoint or correction to `docs/RESULTS_JOURNAL.md` if material truth, route, error state, or evidence changed.
4. Update this canonical memory if a rule, lesson, prohibition, or operating doctrine changed.
5. Preserve exact unresolved items, blockers, risks, forbidden detours, branch/SHA/run identifiers, and the single next allowed action.
6. Produce a self-contained handoff that tells the new chat exactly what to read first and what must not be assumed.
7. Never rely on chat memory alone for a fact needed to continue the project.

Reporting rule: answer the owner briefly and plainly. Show the full important state, result, blocker, evidence, and next action, but do not spend time or tokens on repetition, filler, narration of obvious tool use, or irrelevant detail.

## Canonical verification discipline
- VERIFIED: supported by repository state, logs, CI, primary documentation, live test, or equivalent direct evidence.
- HYPOTHESIS: plausible but not yet proven.
- UNKNOWN: insufficient evidence.
- PASS: the exact intended behavior is demonstrated by the required test/evidence.
- FAIL: the exact intended behavior was tested and did not meet the requirement.
- BLOCKED: the test or action could not be completed because a concrete prerequisite was unavailable.

Never promote HYPOTHESIS or UNKNOWN to VERIFIED/PASS without new evidence.
