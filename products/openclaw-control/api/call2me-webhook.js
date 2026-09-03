const crypto = require("node:crypto");

const DEFAULT_OWNER = "2133611700c-sudo";
const DEFAULT_REPO = "opencloud-gpt-agent";
const WEBHOOK_TOKEN_SHA256 = "97e55c26580eaefa79f86bb119f9e5913228c43ac10e8668d245ff4e201d3525";
const REPORT_PREFIX = "ops/agent-control/reports/phone-calls/webhook/";

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function tokenFromRequest(req) {
  try {
    const host = String(req.headers.host || "localhost");
    const parsed = new URL(req.url || "/", `https://${host}`);
    return String(parsed.searchParams.get("k") || "");
  } catch {
    return "";
  }
}

function authorized(req) {
  const token = tokenFromRequest(req);
  if (!token || token.length > 256) return false;
  const actual = crypto.createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(WEBHOOK_TOKEN_SHA256, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeId(value, prefix = "unknown") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || prefix;
}

function pickFirst(source, paths) {
  for (const path of paths) {
    let value = source;
    for (const key of path.split(".")) value = value?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

const BLOCKED_KEY = /(transcript|recording|audio|phone|email|token|secret|authorization|password|card|ssn|raw|url)/i;

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 60)) {
      if (BLOCKED_KEY.test(key)) continue;
      out[safeId(key, "field")] = sanitizeValue(child, depth + 1);
    }
    return out;
  }
  return null;
}

function sanitizePayload(body) {
  const eventType = safeId(pickFirst(body, ["type", "event", "event_type", "data.type"]), "call-event");
  const callId = safeId(pickFirst(body, ["call_id", "data.call_id", "call.id", "data.call.id"]), "unknown-call");
  const agentId = safeId(pickFirst(body, ["agent_id", "data.agent_id", "agent.id", "data.agent.id"]), "unknown-agent");
  const status = safeId(pickFirst(body, ["status", "call_status", "data.status", "data.call_status"]), "unknown");
  const durationRaw = Number(pickFirst(body, ["duration_ms", "data.duration_ms", "call.duration_ms", "duration"]));
  const durationMs = Number.isFinite(durationRaw) && durationRaw >= 0 && durationRaw <= 3_600_000 ? durationRaw : null;
  const extraction = pickFirst(body, [
    "post_call_extraction",
    "data.post_call_extraction",
    "extraction",
    "data.extraction",
    "analysis.extraction",
    "data.analysis.extraction",
    "call_analysis",
    "data.call_analysis",
  ]);

  return {
    schema_version: 1,
    provider: "Call2Me",
    received_at: new Date().toISOString(),
    event_type: eventType,
    call_id: callId,
    agent_id: agentId,
    status,
    duration_ms: durationMs,
    extraction: sanitizeValue(extraction),
  };
}

function toBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function githubPut(path, content) {
  const token = requireEnv("OPENCLAW_GITHUB_TOKEN");
  const owner = process.env.OPENCLAW_REPO_OWNER || DEFAULT_OWNER;
  const repo = process.env.OPENCLAW_REPO_NAME || DEFAULT_REPO;
  const apiPath = `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const base = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "openclaw-call2me-webhook",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let sha;
  const current = await fetch(`${base}${apiPath}?ref=main`, { headers });
  if (current.ok) {
    const data = await current.json();
    sha = data.sha;
  } else if (current.status !== 404) {
    throw new Error(`github_read_${current.status}`);
  }

  const response = await fetch(`${base}${apiPath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `ops(phone-agent): store Call2Me webhook ${path.split("/").pop()}`,
      content: toBase64(`${content.trim()}\n`),
      branch: "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) throw new Error(`github_write_${response.status}`);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    json(res, 405, { status: "FAIL", error: "method_not_allowed" });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { status: "BLOCKED", error: "invalid_webhook_capability" });
    return;
  }

  try {
    const body = await readBody(req);
    const result = sanitizePayload(body);
    const callPart = safeId(result.call_id, "unknown-call");
    const file = `${REPORT_PREFIX}${callPart}.json`;
    await githubPut(file, JSON.stringify(result, null, 2));
    json(res, 200, { status: "PASS", accepted: true, call_id: result.call_id });
  } catch (error) {
    const message = String(error?.message || error || "webhook_failed");
    json(res, message === "payload_too_large" ? 413 : 400, { status: "FAIL", error: message.slice(0, 120) });
  }
};
