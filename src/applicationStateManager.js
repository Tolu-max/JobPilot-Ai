export const ApplicationState = Object.freeze({
  SCRAPED: 'SCRAPED',
  SCORED: 'SCORED',
  SELECTED_FOR_APPLICATION: 'SELECTED_FOR_APPLICATION',
  FORM_OPENED: 'FORM_OPENED',
  FORM_FILLED: 'FORM_FILLED',
  SUBMITTED: 'SUBMITTED',
  PROOF_PENDING: 'PROOF_PENDING',  // NEW: awaiting re-verification ground truth
  CONFIRMED_SUCCESS: 'CONFIRMED_SUCCESS',
  FAILED: 'FAILED',
  NEEDS_MANUAL_REVIEW: 'NEEDS_MANUAL_REVIEW'
});

export const ApplicationOutcome = Object.freeze({
  APPLIED_SUCCESSFULLY: 'applied_successfully',
  APPLICATION_FAILED: 'application_failed',
  REQUIRES_MANUAL_REVIEW: 'requires_manual_review'
});

const finalStates = new Set([
  ApplicationState.CONFIRMED_SUCCESS,
  ApplicationState.FAILED,
  ApplicationState.NEEDS_MANUAL_REVIEW
]);

const happyPath = [
  ApplicationState.SCRAPED,
  ApplicationState.SCORED,
  ApplicationState.SELECTED_FOR_APPLICATION,
  ApplicationState.FORM_OPENED,
  ApplicationState.FORM_FILLED,
  ApplicationState.SUBMITTED,
  ApplicationState.PROOF_PENDING,
  ApplicationState.CONFIRMED_SUCCESS
];

export function createApplicationLifecycle(job) {
  const lifecycle = {
    jobUrl: job.applicationUrl,
    title: job.title,
    currentState: ApplicationState.SCRAPED,
    transitions: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
    outcome: null,
    reason: ''
  };

  transitionApplicationState(lifecycle, ApplicationState.SCRAPED, 'Job was scraped.');
  return lifecycle;
}

export function transitionApplicationState(lifecycle, nextState, reason = '', meta = {}) {
  if (isFinalApplicationState(lifecycle.currentState)) {
    return lifecycle;
  }

  lifecycle.currentState = nextState;
  lifecycle.transitions.push({
    state: nextState,
    reason,
    meta,
    at: new Date().toISOString()
  });

  if (isFinalApplicationState(nextState)) {
    lifecycle.endedAt = new Date().toISOString();
    lifecycle.reason = reason;
    lifecycle.outcome = outcomeForFinalState(nextState);
  }

  return lifecycle;
}

export function finalizeApplication(lifecycle, finalState, reason = '', meta = {}) {
  if (!isFinalApplicationState(finalState)) {
    throw new Error(`Cannot finalize application with non-final state: ${finalState}`);
  }
  return transitionApplicationState(lifecycle, finalState, reason, meta);
}

export function isFinalApplicationState(state) {
  return finalStates.has(state);
}

export function outcomeForFinalState(state) {
  if (state === ApplicationState.CONFIRMED_SUCCESS) return ApplicationOutcome.APPLIED_SUCCESSFULLY;
  if (state === ApplicationState.FAILED) return ApplicationOutcome.APPLICATION_FAILED;
  if (state === ApplicationState.NEEDS_MANUAL_REVIEW) return ApplicationOutcome.REQUIRES_MANUAL_REVIEW;
  return null;
}

export function statusForOutcome(outcome) {
  // CRITICAL GUARD (2026-05-30): only mark status='applied' when we have CONFIRMED_SUCCESS
  // that passed through PROOF_PENDING. The previous logic allowed 'applied' from SUBMITTED
  // alone, which caused 7/7 false positives on BruntWork.
  if (outcome === ApplicationOutcome.APPLIED_SUCCESSFULLY) return 'applied';
  if (outcome === ApplicationOutcome.APPLICATION_FAILED) return 'failed';
  return 'manual_review';
}

export function validateApplicationLifecycle(lifecycle) {
  const transitions = Array.isArray(lifecycle?.transitions) ? lifecycle.transitions : [];
  const errors = [];
  let previousState = null;

  for (const [index, transition] of transitions.entries()) {
    const nextState = transition?.state;
    if (!isKnownApplicationState(nextState)) {
      errors.push({
        index,
        from: previousState,
        to: nextState,
        reason: `Unknown application state: ${nextState}`
      });
    } else if (!isAllowedApplicationTransition(previousState, nextState)) {
      errors.push({
        index,
        from: previousState,
        to: nextState,
        reason: `Invalid application transition: ${previousState || 'START'} -> ${nextState}`
      });
    }

    previousState = nextState;
  }

  return {
    ok: errors.length === 0,
    errors,
    debugSnapshot: {
      title: lifecycle?.title || '',
      jobUrl: lifecycle?.jobUrl || '',
      currentState: lifecycle?.currentState || '',
      outcome: lifecycle?.outcome || null,
      transitions: transitions.map((transition) => ({
        state: transition.state,
        reason: transition.reason,
        at: transition.at
      }))
    }
  };
}

export function isAllowedApplicationTransition(fromState, toState) {
  if (!fromState) return toState === ApplicationState.SCRAPED;
  if (toState === ApplicationState.FAILED || toState === ApplicationState.NEEDS_MANUAL_REVIEW) return true;

  const fromIndex = happyPath.indexOf(fromState);
  return fromIndex >= 0 && happyPath[fromIndex + 1] === toState;
}

function isKnownApplicationState(state) {
  return Object.values(ApplicationState).includes(state);
}
