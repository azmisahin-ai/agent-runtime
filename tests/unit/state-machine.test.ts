import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionTask, InvalidTaskTransitionError } from '../../src/domain/state-machine.js';

test('valid task transition is accepted', () => {
  assert.equal(canTransition('CREATED', 'QUEUED'), true);
  assert.equal(transitionTask('CREATED', 'QUEUED'), 'QUEUED');
});

test('terminal task cannot return to running', () => {
  assert.equal(canTransition('COMPLETED', 'RUNNING'), false);
  assert.throws(() => transitionTask('COMPLETED', 'RUNNING'), InvalidTaskTransitionError);
});

test('failed task requires a new attempt rather than direct restart', () => {
  assert.equal(canTransition('FAILED', 'RUNNING'), false);
});

test('paused task resumes to running or cancels, never re-queues (spec 13 §5)', () => {
  assert.equal(canTransition('PAUSED', 'RUNNING'), true);
  assert.equal(canTransition('PAUSED', 'CANCELLED'), true);
  assert.equal(canTransition('PAUSED', 'QUEUED'), false);
  assert.throws(() => transitionTask('PAUSED', 'QUEUED'), InvalidTaskTransitionError);
});

test('terminal states are terminal for every target', () => {
  for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
    for (const target of ['CREATED', 'QUEUED', 'RUNNING', 'PAUSED'] as const) {
      assert.equal(canTransition(terminal, target), false, `${terminal} -> ${target}`);
    }
  }
});

test('waiting states can only return through defined transitions', () => {
  assert.equal(canTransition('WAITING_TOOL', 'RUNNING'), true);
  assert.equal(canTransition('WAITING_TOOL', 'COMPLETED'), false);
  assert.equal(canTransition('WAITING_USER', 'VERIFYING'), false);
  assert.equal(canTransition('VERIFYING', 'COMPLETED'), true);
  assert.equal(canTransition('VERIFYING', 'CANCELLED'), false);
});
