const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BASE_REF = /^[A-Za-z0-9_./-]{1,200}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * Starts one task run WITHOUT touching the default branch.
 * GitHub only dispatches workflow_dispatch/repository_dispatch from the default branch, but a push to a
 * branch runs the workflow file stored at that branch. So the door creates `run/<task>/<epoch>[-tg<chat>]`
 * at the canonical branch head; `v2-run-task.yml` reacts to the push, executes the task and deletes the branch.
 */
export function createBranchDispatcher({ token, repository, baseRef, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) throw new TypeError('GitHub dispatch token is required');
  if (typeof repository !== 'string' || !REPOSITORY.test(repository)) throw new TypeError('repository must be owner/name');
  if (typeof baseRef !== 'string' || !BASE_REF.test(baseRef) || baseRef.startsWith('run/')) throw new TypeError('baseRef must be the canonical branch name');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'openclaw-v2-intake',
    'Content-Type': 'application/json',
  };
  return async function dispatch({ taskId, chatId }) {
    if (typeof taskId !== 'string' || !UUID.test(taskId)) throw new TypeError('taskId must be a UUID');
    const chat = chatId === undefined || chatId === null || chatId === '' ? '' : String(chatId);
    if (chat && !/^\d{1,20}$/.test(chat)) throw new TypeError('chatId must be a positive numeric chat id');
    const head = await fetchImpl(`https://api.github.com/repos/${repository}/git/ref/heads/${baseRef}`, { headers });
    if (head.status !== 200) throw new Error(`BASE_REF_LOOKUP_FAILED_${head.status}`);
    const sha = (await head.json())?.object?.sha;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('BASE_REF_SHA_INVALID');
    const name = `run/${taskId}/${Math.floor(now() / 1000)}${chat ? `-tg${chat}` : ''}`;
    const created = await fetchImpl(`https://api.github.com/repos/${repository}/git/refs`, {
      method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
    });
    if (created.status !== 201) throw new Error(`RUN_BRANCH_CREATE_FAILED_${created.status}`);
    return name;
  };
}
