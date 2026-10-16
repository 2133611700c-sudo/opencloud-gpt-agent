const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^[A-Za-z0-9_.-]+\.ya?ml$/;

/** Starts one GitHub Actions run of the task workflow. Throws unless GitHub answers 204. */
export function createWorkflowDispatcher({ token, repository, workflow, ref, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) throw new TypeError('GitHub dispatch token is required');
  if (typeof repository !== 'string' || !REPOSITORY.test(repository)) throw new TypeError('repository must be owner/name');
  if (typeof workflow !== 'string' || !WORKFLOW.test(workflow)) throw new TypeError('workflow must be a workflow file name');
  if (typeof ref !== 'string' || !ref || /\s/.test(ref)) throw new TypeError('ref is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  return async function dispatch({ taskId, chatId }) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'openclaw-v2-intake',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: { task_id: taskId, chat_id: String(chatId) } }),
    });
    if (response.status !== 204) throw new Error(`WORKFLOW_DISPATCH_FAILED_${response.status}`);
  };
}
