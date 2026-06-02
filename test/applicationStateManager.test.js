import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationOutcome,
  ApplicationState,
  createApplicationLifecycle,
  finalizeApplication,
  isFinalApplicationState,
  statusForOutcome,
  transitionApplicationState
} from '../src/applicationStateManager.js';

test('application lifecycle reaches exactly one final success state', () => {
  const lifecycle = createApplicationLifecycle({
    title: 'Website Administrator',
    applicationUrl: 'https://example.com/job'
  });

  transitionApplicationState(lifecycle, ApplicationState.SCORED, 'Scored.');
  transitionApplicationState(lifecycle, ApplicationState.SELECTED_FOR_APPLICATION, 'Selected.');
  transitionApplicationState(lifecycle, ApplicationState.FORM_OPENED, 'Opened.');
  transitionApplicationState(lifecycle, ApplicationState.FORM_FILLED, 'Filled.');
  transitionApplicationState(lifecycle, ApplicationState.SUBMITTED, 'Submitted.');
  finalizeApplication(lifecycle, ApplicationState.CONFIRMED_SUCCESS, 'Confirmed.');
  transitionApplicationState(lifecycle, ApplicationState.FAILED, 'Ignored after final.');

  assert.equal(lifecycle.currentState, ApplicationState.CONFIRMED_SUCCESS);
  assert.equal(lifecycle.outcome, ApplicationOutcome.APPLIED_SUCCESSFULLY);
  assert.equal(statusForOutcome(lifecycle.outcome), 'applied');
  assert.equal(isFinalApplicationState(lifecycle.currentState), true);
});

test('manual review and failed outcomes map to explicit statuses', () => {
  assert.equal(statusForOutcome(ApplicationOutcome.REQUIRES_MANUAL_REVIEW), 'manual_review');
  assert.equal(statusForOutcome(ApplicationOutcome.APPLICATION_FAILED), 'failed');
});
