/** Local redaction policy only; never serialize this list into artifacts or logs. */
export function runtimeSensitiveValues(env = process.env) {
  return Object.freeze([
    env.DEEPSEEK_API_KEY, env.DATABASE_URL, env.OPENCLAW_USER_INTAKE_SECRET,
  ].filter((value) => typeof value === 'string' && value.length > 0));
}
