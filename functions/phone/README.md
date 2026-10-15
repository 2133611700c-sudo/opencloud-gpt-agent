# OpenClaw V2 mobile Evidence surface

This Node 24 Neon Function reads immutable terminal Evidence through the existing
v2 PostgreSQL store. It performs no model calls, task creation or Evidence writes.
The intentionally public, sanitized read routes are:

- `GET /tasks/<task UUID>/deep-log`
- `GET /tasks/<task UUID>/phone`

Both routes return UTF-8 text with task, artifact and SHA256 identity headers.
URLs derive only from the configured `OPENCLAW_PUBLIC_BASE_URL` HTTPS origin;
Host and forwarded headers never determine links. The injected branch connection
explicitly selects the `openclaw_v2` database. Deploy only to the V2 Neon branch.

Build with `npm ci --prefix functions/phone` followed by
`npm run --prefix functions/phone build`. ZIP `dist/index.mjs` as archive-root
`index.mjs`; deploy that archive with the Neon Functions deployment API. Configure
`OPENCLAW_PUBLIC_BASE_URL` with the returned invocation origin before publishing
links. Do not put credentials or a `.env` file in the archive.

The automatic execution composition is `createPostgresTaskPhoneRuntime`: resume
the existing task, run fenced Research then Data, finalize terminal Evidence and
verify both external HTTPS routes before returning phone text. Its caller owns
the query transport. The normal PostgreSQL command entrypoint is
`OPENCLAW_TASK_ID=<uuid> node scripts/run-task-to-phone.mjs` with the existing
runtime secrets and `OPENCLAW_PUBLIC_BASE_URL` in the environment.

On a publisher failure, rerun publication for the **same** terminal task using
`scripts/publish-terminal-phone.mjs`. That entrypoint imports no Research worker
and cannot repeat a provider call. Stored Evidence remains the source of truth;
there is no second delivery artifact or rendering database.
