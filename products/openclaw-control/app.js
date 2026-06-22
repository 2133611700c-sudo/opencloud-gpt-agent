const secretInput = document.querySelector("#secret");
const saveSecretButton = document.querySelector("#save-secret");
const refreshButton = document.querySelector("#refresh");
const taskForm = document.querySelector("#task-form");
const previewButton = document.querySelector("#preview");
const previewOutput = document.querySelector("#preview-output");
const statusGrid = document.querySelector("#status-grid");
const runsNode = document.querySelector("#runs");
const logNode = document.querySelector("#log");
const repoLabel = document.querySelector("#repo-label");

const SECRET_KEY = "openclaw-control-secret";

function log(message, data) {
  const line = `${new Date().toISOString()} ${message}${data ? `\n${JSON.stringify(data, null, 2)}` : ""}`;
  logNode.textContent = `${line}\n\n${logNode.textContent}`.trim();
}

function readSecret() {
  return localStorage.getItem(SECRET_KEY) || "";
}

function saveSecret() {
  localStorage.setItem(SECRET_KEY, secretInput.value.trim());
  log("Saved control secret locally.");
}

async function api(method = "GET", body) {
  const response = await fetch("./api/control", {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-OpenCloud-Control-Key": readSecret(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

function renderState(payload) {
  repoLabel.textContent = payload.repo;
  const latest = payload.latest || {};
  const cards = [
    ["Latest status", latest.status || "UNKNOWN"],
    ["Latest task", latest.task_id || "n/a"],
    ["Latest run", latest.run_id || "n/a"],
    ["Latest report", latest.report_file || "n/a"],
    ["Latest artifact", latest.artifact_name || "n/a"],
    ["Evidence commit", latest.evidence_commit_sha || "n/a"],
    ["Heartbeat", latest.timestamp_utc || "n/a"],
    ["Run link", latest.run_url || "n/a"],
  ];
  statusGrid.innerHTML = cards
    .map(([label, value]) => `<article class="card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  const combinedRuns = [...(payload.active_runs || []), ...(payload.recent_runs || [])];
  const seen = new Set();
  runsNode.innerHTML = combinedRuns
    .filter((run) => {
      if (seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    })
    .map(
      (run) => `
        <article class="run">
          <div>
            <h3>${run.title || run.name}</h3>
            <p>${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}</p>
            <p>${run.created_at || ""}</p>
          </div>
          <div class="run-actions">
            <a href="${run.url}" target="_blank" rel="noreferrer">Actions</a>
            <a href="${run.artifacts_url}" target="_blank" rel="noreferrer">Artifacts</a>
            <button data-run="${run.id}" data-action="rerun">Rerun</button>
            <button data-run="${run.id}" data-action="cancel">Cancel</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function buildTaskPayload(form) {
  const data = new FormData(form);
  return {
    project: data.get("project"),
    type: data.get("type"),
    id: data.get("id"),
    goal: data.get("goal"),
    target_origin: data.get("target_origin"),
    routes: data.get("routes"),
    max_attempts: Number(data.get("max_attempts")),
    expected_status: data.get("expected_status"),
    comment: data.get("comment"),
  };
}

async function refresh() {
  const payload = await api();
  renderState(payload);
  log("Refreshed state.", payload.latest);
}

saveSecretButton.addEventListener("click", saveSecret);
refreshButton.addEventListener("click", () => refresh().catch((error) => log("Refresh failed.", { error: String(error) })));
previewButton.addEventListener("click", async () => {
  try {
    const result = await api("POST", { action: "preview", task: buildTaskPayload(taskForm) });
    previewOutput.textContent = JSON.stringify(result.result, null, 2);
    log("Built task preview.", result.result);
  } catch (error) {
    log("Preview failed.", { error: String(error) });
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  try {
    const result = await api("POST", {
      action: "launch",
      launch_mode: submitter?.dataset.mode || "dispatch",
      force_rerun: true,
      task: buildTaskPayload(taskForm),
    });
    previewOutput.textContent = JSON.stringify(result.result, null, 2);
    log("Launch accepted.", result.result);
    await refresh();
  } catch (error) {
    log("Launch failed.", { error: String(error) });
  }
});

runsNode.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-run]");
  if (!button) return;
  try {
    const result = await api("POST", {
      action: button.dataset.action,
      run_id: Number(button.dataset.run),
    });
    log(`Run ${button.dataset.action} accepted.`, result.result);
    await refresh();
  } catch (error) {
    log(`Run ${button.dataset.action} failed.`, { error: String(error) });
  }
});

secretInput.value = readSecret();
refresh().catch((error) => log("Initial refresh failed.", { error: String(error) }));
