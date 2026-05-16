# OpenCloud GPT Agent

External execution layer for ChatGPT.

Core flow:
`Sergii -> ChatGPT -> GitHub task -> OpenClaw Cloud Agent -> evidence -> ChatGPT verification -> next step`

This project is intentionally separate from Handyment, messageinfo, and USAS Helper.

## Runtime policy
- Node.js baseline: `22.x` for local and CI execution.
- Package manager: `npm` with committed `package-lock.json`; use `npm ci` in automation.
- Browser automation: Playwright (`1.60.0` baseline in this cycle).

## OpenClaw scope boundary
- OpenClaw: browser automation, evidence generation, workflow-driven monitoring tasks.
- OpenCV/OpenCL: not installed or supported by default in this repository.
- Add OpenCV/OpenCL only when there is a direct runtime import/use case committed in code and approved by task contract.

## Windows operation
- Prefer native Windows PowerShell for local runs when WSL is also installed.
- Primary runbook: `ops/agent-control/WINDOWS_RUNBOOK.md`.
