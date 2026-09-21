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
