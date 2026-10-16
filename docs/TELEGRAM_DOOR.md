# Telegram door + Run Task workflow

Flow: Telegram message -> Neon Function `POST /telegram` -> same bounded intake as
`POST /v1/research/tasks` -> durable task in PostgreSQL -> GitHub creates branch
`run/<task-uuid>/<epoch>-tg<chat>` at the canonical head; the push starts `v2-run-task.yml` (the file stored on
that branch, so `main` is never involved: GitHub only dispatches `workflow_dispatch` from the default branch) -> OpenClaw 2026.10.3 executes the task through
Phone publication -> result is sent back to the same Telegram chat.

Telegram message grammar: plain text or `/r <goal>` = research; `/run <task uuid>` = run an
existing task again (safe: the task is durable and idempotent); `/help`.

## One-time setup (all from a phone browser)

Function environment (Neon Function settings), in addition to the existing intake variables:

| Variable | Value |
| --- | --- |
| `OPENCLAW_TELEGRAM_WEBHOOK_SECRET` | 16-256 chars of `A-Za-z0-9_-`, you choose it |
| `OPENCLAW_TELEGRAM_ALLOWED_CHAT_ID` | your numeric private chat id |
| `OPENCLAW_TELEGRAM_BOT_TOKEN` | token from BotFather |
| `OPENCLAW_GITHUB_DISPATCH_TOKEN` | fine-grained token, this repo only, Contents: read and write |
| `OPENCLAW_GITHUB_REF` | optional, default `v2/openclaw-clean-20261011` |

GitHub Environment `openclaw-v2-live` secrets: `DATABASE_URL`, `DEEPSEEK_API_KEY`,
`OPENCLAW_TELEGRAM_BOT_TOKEN` (the same bot token, used to send the result).
Optional repository variable `OPENCLAW_PUBLIC_BASE_URL` (defaults to the V2 Function origin).

Register the webhook once (replace the three placeholders):

    https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<FUNCTION_ORIGIN>/telegram&secret_token=<WEBHOOK_SECRET>

## Behaviour guarantees

- Only the allowed private chat is served; any other update gets an empty 200.
- The request id derives from Telegram `update_id` and the deadline from the message date, so a
  Telegram retry maps to the same task and never creates a second one or a second run.
- A transient database failure returns 503 so Telegram retries; a failed dispatch keeps the task
  and tells the chat to send `/run <task id>`.
- Each run has its own branch and concurrency group, so different tasks never wait on each other;
  two runs of the same task are serialized by the Kernel lease and fencing, not by GitHub.
- The run branch is deleted at the end of every run.

## Cancel test (manual, free of model cost until the research step starts)

1. Send a research request in Telegram. 2. Cancel the running workflow from the GitHub app.
3. Send `/run <task id>`. Expected: the task resumes through the Kernel lease/retry path and
   finishes, or reports a durable terminal state. Record the outcome in the PR.
