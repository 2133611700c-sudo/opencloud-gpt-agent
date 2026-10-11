# ECC Agent Role Lanes

The 71 ECC agents are adapted as role profiles inside the existing ChatGPT → GitHub → OpenClaw control plane. They are not independent authorities.

## Supervisor
`chief-of-staff`, `planner`, `architect`, `agent-evaluator`

## Discovery
`code-explorer`, `spec-miner`, `docs-lookup`

## Architecture
`architect`, `code-architect`, `network-architect`

## Repair
`build-error-resolver`, `cpp-build-resolver`, `dart-build-resolver`, `django-build-resolver`, `go-build-resolver`, `harmonyos-app-resolver`, `java-build-resolver`, `kotlin-build-resolver`, `pytorch-build-resolver`, `react-build-resolver`, `rust-build-resolver`, `swift-build-resolver`, `network-troubleshooter`, `silent-failure-hunter`, `performance-optimizer`, `refactor-cleaner`

## Review
`code-reviewer`, `security-reviewer`, `database-reviewer`, `typescript-reviewer`, `react-reviewer`, `python-reviewer`, `go-reviewer`, `rust-reviewer`, `java-reviewer`, `kotlin-reviewer`, `swift-reviewer`, `django-reviewer`, `fastapi-reviewer`, `flutter-reviewer`, `php-reviewer`, `ruby-reviewer`, `cpp-reviewer`, `csharp-reviewer`, `fsharp-reviewer`, `vue-reviewer`, `mle-reviewer`, `rag-pipeline-reviewer`, `healthcare-reviewer`, `network-config-reviewer`

## Verification
`e2e-runner`, `pr-test-analyzer`, `tdd-guide`, `agent-evaluator`

## Documentation
`doc-updater`, `comment-analyzer`, `commit-reviewer`

## Standard repair chain
`diagnose → narrow resolver → minimal repair → stack reviewer → tests → security → independent judge → evidence`

## Tool mapping
- Read/Grep/Glob → GitHub/files/container.
- Write/Edit → local artifact or isolated GitHub branch.
- Bash → container or scoped OpenClaw runner.
- Browser/Playwright MCP → OpenClaw virtual-browser audit lane.
- WebSearch/WebFetch → ChatGPT web.
- Claude-specific hooks/slash commands → translated router policy, never invoked literally.
