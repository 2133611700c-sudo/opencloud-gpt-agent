export const EXECUTION_STATUSES = Object.freeze([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAIL_WITH_EVIDENCE',
  'BLOCKED',
  'AWAITING_APPROVAL',
  'CANCELLED',
]);

export const TERMINAL_STATUSES = Object.freeze(new Set([
  'SUCCESS',
  'FAIL_WITH_EVIDENCE',
  'BLOCKED',
  'CANCELLED',
]));

const TASK_TRANSITIONS = Object.freeze({
  PENDING: new Set(['RUNNING', 'FAIL_WITH_EVIDENCE', 'AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED']),
  RUNNING: new Set(['SUCCESS', 'FAIL_WITH_EVIDENCE', 'AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED']),
  AWAITING_APPROVAL: new Set(['RUNNING', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED']),
  SUCCESS: new Set(),
  FAIL_WITH_EVIDENCE: new Set(),
  BLOCKED: new Set(),
  CANCELLED: new Set(),
});

const NODE_TRANSITIONS = Object.freeze({
  PENDING: new Set(['RUNNING', 'AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED']),
  RUNNING: new Set(['PENDING', 'SUCCESS', 'FAIL_WITH_EVIDENCE', 'AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED']),
  AWAITING_APPROVAL: new Set(['PENDING', 'BLOCKED', 'CANCELLED']),
  SUCCESS: new Set(),
  FAIL_WITH_EVIDENCE: new Set(),
  BLOCKED: new Set(),
  CANCELLED: new Set(),
});

const TRANSITIONS_BY_ENTITY = Object.freeze({
  task: TASK_TRANSITIONS,
  node: NODE_TRANSITIONS,
});

export class InvalidStateTransitionError extends Error {
  constructor(entity, from, to) {
    super(`Invalid ${entity} state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.code = 'INVALID_STATE_TRANSITION';
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

export function isKnownStatus(status) {
  return EXECUTION_STATUSES.includes(status);
}

export function isTerminalStatus(status) {
  if (!isKnownStatus(status)) {
    throw new TypeError(`Unknown execution status: ${status}`);
  }
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(entity, from, to) {
  const transitions = TRANSITIONS_BY_ENTITY[entity];
  if (!transitions) {
    throw new TypeError(`Unknown state-machine entity: ${entity}`);
  }
  if (!isKnownStatus(from) || !isKnownStatus(to)) {
    throw new TypeError(`Unknown execution status in transition: ${from} -> ${to}`);
  }
  return transitions[from].has(to);
}

export function assertTransition(entity, from, to) {
  if (!canTransition(entity, from, to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
  return true;
}
