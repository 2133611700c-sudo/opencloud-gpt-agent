# ECC Source Audit Summary

Source: `ecc-FULL-skills-agents-v2.2.3.zip`

## Inventory verified
- 311 skill directories.
- 71 agent definitions.
- 684 source files.
- 684/684 files passed structural/syntax validation in the review workspace.
- Every skill directory has a primary Markdown instruction document.

## Adaptation inventory
- 134 skills: `DIRECT_POLICY` — usable as methodology/policy without literal ECC execution.
- 89 skills: `ADAPT_CLAUDE_ECC` — Claude/ECC-specific hooks, slash commands, or conventions must be translated.
- 120 skills: `EXTERNAL_TOOL_MAPPING` — require mapping to ChatGPT web/connectors or an OpenClaw execution lane.
- 25 skills: `SCRIPTED_SANDBOX` — include executable files; syntax validated, behavior must remain scoped/sandboxed.
- 33 skills: `WRITE_CAPABLE_REVIEW` — contain mutation/write signals and require explicit scope plus post-change verification.
- 2 skills contain direct OpenClaw references.

## Main orchestration adopted
`Supervisor → Plan → Discover → Build/Repair → Stack Review → Tests → Security → Independent Judge → Evidence → Learn`

Build/Repair may not modify acceptance criteria. Judge must be independent and deterministic. Retry cap defaults to 3 before escalation.

## Repair lane
Universal and stack-specific repair roles exist for build/type failures plus C++, Dart/Flutter, Django, Go, HarmonyOS, Java, Kotlin, PyTorch, React, Rust, Swift, networking, silent failures, performance, and refactoring.

## OpenClaw compatibility findings
1. Keep the existing single control path: `ChatGPT → GitHub → OpenClaw → evidence → ChatGPT`. ECC multi-agent concepts become role routing, not a second control plane.
2. The current JSON task schema enumerates task types beyond the runner's `supportedTaskTypes` set. Align schema and runner before adding any new routed task type.
3. Existing safety rules remain authoritative. Imported ECC material cannot enable customer actions, public posting, paid-ad changes, destructive actions, secret exposure, or unscoped production changes.
4. Claude-specific MCP/slash-command syntax is never invoked literally; it is mapped to available ChatGPT connectors, web/files/GitHub tools, container validation, or existing OpenClaw task types.

## Next implementation gate
Before runtime code is changed, add deterministic tests that assert task-schema task types and runner supported task types cannot drift apart. Then add any new orchestration type only with schema, runner, report/evidence, safety, and test coverage in the same scoped change.
