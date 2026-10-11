import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTION_STATUSES,
  InvalidStateTransitionError,
  assertTransition,
  canTransition,
  isTerminalStatus,
} from '../../src/kernel/state.mjs';

test('execution status vocabulary is canonical and complete', () => {
  assert.deepEqual(EXECUTION_STATUSES, [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAIL_WITH_EVIDENCE',
    'BLOCKED',
    'AWAITING_APPROVAL',
    'CANCELLED',
  ]);
});

test('task lifecycle permits normal execution and terminal completion', () => {
  assert.equal(canTransition('task', 'PENDING', 'RUNNING'), true);
  assert.equal(canTransition('task', 'RUNNING', 'SUCCESS'), true);
  assert.equal(canTransition('task', 'RUNNING', 'FAIL_WITH_EVIDENCE'), true);
});

test('task lifecycle permits system terminal failure before or during approval wait', () => {
  assert.equal(canTransition('task', 'PENDING', 'FAIL_WITH_EVIDENCE'), true);
  assert.equal(canTransition('task', 'AWAITING_APPROVAL', 'FAIL_WITH_EVIDENCE'), true);
  assert.equal(canTransition('task', 'PENDING', 'SUCCESS'), false);
  assert.equal(canTransition('task', 'AWAITING_APPROVAL', 'SUCCESS'), false);
});

test('node lifecycle permits bounded retry requeue without making failure terminal early', () => {
  assert.equal(canTransition('node', 'RUNNING', 'PENDING'), true);
  assert.equal(canTransition('task', 'RUNNING', 'PENDING'), false);
});

test('approval pause resumes through an explicit allowed transition', () => {
  assert.equal(canTransition('task', 'RUNNING', 'AWAITING_APPROVAL'), true);
  assert.equal(canTransition('task', 'AWAITING_APPROVAL', 'RUNNING'), true);
  assert.equal(canTransition('node', 'RUNNING', 'AWAITING_APPROVAL'), true);
  assert.equal(canTransition('node', 'AWAITING_APPROVAL', 'PENDING'), true);
});

test('terminal states never transition back into execution', () => {
  for (const terminal of ['SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED']) {
    assert.equal(isTerminalStatus(terminal), true);
    for (const target of EXECUTION_STATUSES) {
      assert.equal(canTransition('task', terminal, target), false, `${terminal} -> ${target} must be forbidden`);
      assert.equal(canTransition('node', terminal, target), false, `${terminal} -> ${target} must be forbidden`);
    }
  }
});

test('invalid transition throws a typed kernel error', () => {
  assert.throws(
    () => assertTransition('node', 'SUCCESS', 'RUNNING'),
    (error) => {
      assert.equal(error instanceof InvalidStateTransitionError, true);
      assert.equal(error.code, 'INVALID_STATE_TRANSITION');
      assert.equal(error.entity, 'node');
      return true;
    },
  );
});

test('unknown statuses and entities fail closed', () => {
  assert.throws(() => canTransition('node', 'BOGUS', 'RUNNING'), TypeError);
  assert.throws(() => canTransition('worker', 'PENDING', 'RUNNING'), TypeError);
  assert.throws(() => isTerminalStatus('BOGUS'), TypeError);
});
