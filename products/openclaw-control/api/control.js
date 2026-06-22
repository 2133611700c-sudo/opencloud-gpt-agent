const DEFAULT_OWNER = "2133611700c-sudo";
const DEFAULT_REPO = "opencloud-gpt-agent";
const TASKS_PREFIX = "ops/agent-control/tasks/";
const DISPATCH_PREFIX = "ops/agent-control/dispatch/";
const LATEST_FILE = "ops/agent-control/reports/openclaw-latest.json";

function requireEnv(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function buildTaskPayload(input, mode) {
  const type = String(input.type || "virtual_browser_audit").trim();
  const taskId = normalizeId(input.id || `OC-MOBILE-${type}-${nowStamp()}`);
  const targetOrigin = String(input.target_origin || "").trim();
  const routes = Array.isArray(input.routes)
    ? input.routes
    : String(input.routes || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  const task = {
    id: taskId,
    type,
    requested_by: String(input.requested_by || "ChatGPT Mobile").trim(),
    status: mode === "push" ? "pending" : "locked",
    goal: String(input.goal || "").trim(),
    expected_status: String(input.expected_status || "PASS").trim().toUpperCase(),
    priority: String(input.priority || "P2").trim().toUpperCase(),
    created_at: new Date().toISOString(),
    params: {
      target_origin: targetOrigin,
      routes,
      max_attempts: Number(input.max_attempts || 2),
      project: String(input.project || "").trim(),
      comment: String(input.comment || "").trim(),
    },
    safety: {
      production_code_change: false,
      customer_action: false,
      secrets_required: false,
      public_posting: false,
      paid_ads_change: false,
      destructive_action: false,
    },
  };
  if (type === "heartbeat" || type === "worker_heartbeat" || type === "synthetic_fail") {
    task.params = {};
  }
  return task;
}

function toBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function gh(path, { method = "GET", body, owner, repo } = {}) {
  const token = requireEnv("OPENCLAW_GITHUB_TOKEN");
  const finalOwner = owner || process.env.OPENCLAW_REPO_OWNER || DEFAULT_OWNER;
  const finalRepo = repo || process.env.OPENCLAW_REPO_NAME || DEFAULT_REPO;
  const response = await fetch(`https://api.github.com/repos/${finalOwner}/${finalRepo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "openclaw-control",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.message || response.statusText || "GitHub API error";
    throw new Error(`${method} ${path} failed: ${response.status} ${message}`);
  }
  return data;
}

async function getContent(path) {
  const data = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=main`);
  const content = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  return { sha: data.sha, content };
}

async function putContent(path, content, message) {
  let sha = undefined;
  try {
    const current = await getContent(path);
    sha = current.sha;
  } catch (error) {
    if (!String(error.message || "").includes("404")) throw error;
  }
  return gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    body: {
      message,
      content: toBase64(content),
      sha,
      branch: "main",
    },
  });
}

async function listRuns() {
  const workflows = await gh("/actions/runs?per_page=20");
  return (workflows.workflow_runs || [])
    .filter((run) => String(run.name || "").includes("OpenClaw"))
    .map((run) => ({
      id: run.id,
      name: run.name,
      title: run.display_title,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      created_at: run.created_at,
      updated_at: run.updated_at,
      head_branch: run.head_branch,
      artifacts_url: `${run.html_url}#artifacts`,
    }));
}

function authorize(req) {
  const expected = requireEnv("OPENCLAW_CONTROL_SHARED_SECRET");
  const provided = req.headers["x-opencloud-control-key"];
  return provided && provided === expected;
}

async function getState() {
  const latest = JSON.parse((await getContent(LATEST_FILE)).content);
  const runs = await listRuns();
  return {
    repo: `${process.env.OPENCLAW_REPO_OWNER || DEFAULT_OWNER}/${process.env.OPENCLAW_REPO_NAME || DEFAULT_REPO}`,
    generated_at: new Date().toISOString(),
    latest,
    active_runs: runs.filter((run) => run.status !== "completed"),
    recent_runs: runs.slice(0, 10),
  };
}

async function launchTask(payload) {
  const mode = String(payload.launch_mode || "dispatch").trim();
  const forceRerun = Boolean(payload.force_rerun);
  const existingTaskFile = String(payload.task_file || "").trim();
  let taskFile = existingTaskFile;
  let taskPayload = null;
  if (!taskFile) {
    taskPayload = buildTaskPayload(payload.task || payload, mode === "push" ? "push" : "dispatch");
    taskFile = `${TASKS_PREFIX}${taskPayload.id}.json`;
    await putContent(taskFile, `${JSON.stringify(taskPayload, null, 2)}\n`, `ops(control): create ${taskPayload.id} task`);
  }
  if (mode === "workflow_dispatch") {
    await gh("/actions/workflows/openclaw-task-runner.yml/dispatches", {
      method: "POST",
      body: {
        ref: "main",
        inputs: {
          task_file: taskFile,
          force_rerun: forceRerun ? "true" : "false",
          run_windows_smoke: "false",
        },
      },
    });
    return { mode, task_file: taskFile, task: taskPayload };
  }
  const dispatchId = normalizeId(`${pathBasename(taskFile, ".json")}-${nowStamp()}`);
  const dispatchFile = `${DISPATCH_PREFIX}${dispatchId}.request.json`;
  const dispatchPayload = {
    task_file: taskFile,
    force_rerun: forceRerun,
  };
  await putContent(dispatchFile, `${JSON.stringify(dispatchPayload, null, 2)}\n`, `ops(control): dispatch ${taskFile}`);
  return { mode, task_file: taskFile, dispatch_file: dispatchFile, task: taskPayload };
}

function pathBasename(file, suffix) {
  const parts = String(file || "").split("/");
  const base = parts[parts.length - 1] || "";
  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!authorize(req)) {
    json(res, 401, { status: "BLOCKED", error: "invalid control secret" });
    return;
  }
  try {
    if (req.method === "GET") {
      json(res, 200, await getState());
      return;
    }
    if (req.method !== "POST") {
      json(res, 405, { status: "FAIL", error: "method_not_allowed" });
      return;
    }
    const body = await readBody(req);
    const action = String(body.action || "launch").trim();
    if (action === "launch") {
      json(res, 200, { status: "PASS", result: await launchTask(body) });
      return;
    }
    if (action === "rerun") {
      await gh(`/actions/runs/${Number(body.run_id)}/rerun`, { method: "POST" });
      json(res, 200, { status: "PASS", result: { run_id: Number(body.run_id) } });
      return;
    }
    if (action === "cancel") {
      await gh(`/actions/runs/${Number(body.run_id)}/cancel`, { method: "POST" });
      json(res, 200, { status: "PASS", result: { run_id: Number(body.run_id) } });
      return;
    }
    if (action === "preview") {
      const task = buildTaskPayload(body.task || body, "dispatch");
      json(res, 200, {
        status: "PASS",
        result: {
          task_file: `${TASKS_PREFIX}${task.id}.json`,
          task,
        },
      });
      return;
    }
    json(res, 400, { status: "FAIL", error: `unknown action: ${action}` });
  } catch (error) {
    json(res, 500, { status: "FAIL", error: String(error.message || error) });
  }
};
