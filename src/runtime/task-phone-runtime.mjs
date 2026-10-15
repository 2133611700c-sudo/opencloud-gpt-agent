const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['SUCCESS', 'FAIL_WITH_EVIDENCE']);
const KNOWN = new Set([...TERMINAL, 'PENDING', 'RUNNING', 'BLOCKED', 'AWAITING_APPROVAL', 'CANCELLED']);

/** Resume an existing durable task. Publication retries never create or rerun a task. */
export function createTaskPhoneRuntime({ readTaskStatus, researchWorker, dataWorker, publisher } = {}) {
  if (typeof readTaskStatus !== 'function') throw new TypeError('readTaskStatus must be a function');
  for (const [name, worker] of [['researchWorker', researchWorker], ['dataWorker', dataWorker]]) {
    if (typeof worker?.runTask !== 'function') throw new TypeError(`${name}.runTask must be a function`);
  }
  if (typeof publisher?.publish !== 'function') throw new TypeError('publisher.publish must be a function');
  const read = async (taskId) => {
    const status = await readTaskStatus(taskId);
    if (!KNOWN.has(status)) throw Object.assign(new Error('Task state is unavailable'), { code: 'TASK_STATE_UNAVAILABLE' });
    return status;
  };
  return Object.freeze({
    async runTask(taskId) {
      if (typeof taskId !== 'string' || !UUID.test(taskId)) throw new TypeError('taskId must be a UUID');
      const id = taskId.toLowerCase();
      let status = await read(id);
      for (const worker of [researchWorker, dataWorker]) {
        if (TERMINAL.has(status) || status === 'CANCELLED') break;
        try {
          await worker.runTask(id);
        } catch {
          // Fenced workers persist terminal failures before throwing. Only a
          // confirmed terminal database state may proceed to Evidence/Phone.
          status = await read(id);
          if (!TERMINAL.has(status)) throw Object.assign(new Error('Task execution needs recovery'), { code: 'TASK_EXECUTION_NOT_TERMINAL' });
          break;
        }
        status = await read(id);
      }
      if (TERMINAL.has(status)) return publisher.publish(id);
      return Object.freeze({ status, taskId: id, published: false });
    },
  });
}
