import { parseGitHubIssueIntake } from './github-issue-intake.mjs';

const requireKernel = (kernel) => {
  if (!kernel || typeof kernel.createLiteResearchTask !== 'function') {
    throw new TypeError('kernel.createLiteResearchTask must be a function');
  }
  return kernel;
};

const requirePersistedTask = (value) => {
  if (!value || typeof value !== 'object' || typeof value.taskId !== 'string' || value.taskId.length === 0 || typeof value.created !== 'boolean') {
    throw new TypeError('kernel.createLiteResearchTask returned an invalid task result');
  }
  return value;
};

export async function persistGitHubIssueIntake({ event, kernel } = {}) {
  const target = requireKernel(kernel);
  const contract = parseGitHubIssueIntake(event);
  const persisted = requirePersistedTask(await target.createLiteResearchTask({
    idempotencyKey: contract.idempotencyKey,
    goal: contract.goal,
    requestPayload: contract.requestPayload,
    budgetLimitUsd: contract.budgetLimitUsd,
    tokenBudgetLimit: contract.tokenBudgetLimit,
    maxTotalSteps: contract.maxTotalSteps,
    deadlineAt: contract.deadlineAt,
  }));

  return Object.freeze({
    taskId: persisted.taskId,
    created: persisted.created,
    idempotencyKey: contract.idempotencyKey,
    source: contract.source,
  });
}
