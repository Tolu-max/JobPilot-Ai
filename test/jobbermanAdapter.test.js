import test from 'node:test';
import assert from 'node:assert/strict';
import { jobbermanAdapter } from '../src/adapters/jobberman.js';
import { FormStep } from '../src/adapters/types.js';

function fakePage(bodyText) {
  return {
    locator: () => ({ innerText: async () => bodyText }),
    url: () => 'https://www.jobberman.com/listings/some-role-9kk',
    goto: async () => {},
    waitForTimeout: async () => {}
  };
}

test('jobberman adapter detects submitted confirmation', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Your application submitted — you have applied. Thank you!'), {});
  assert.equal(step, FormStep.SUBMITTED);
});

test('jobberman adapter detects the application details step', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Apply here and then Submit and apply'), {});
  assert.equal(step, FormStep.DETAILS);
});

test('jobberman adapter returns ERROR on login wall when no credentials are configured', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Please login to apply for this job'), { config: {} });
  assert.equal(step, FormStep.ERROR);
});

test('jobberman adapter returns UNKNOWN for an unrecognised page', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Some unrelated content'), {});
  assert.equal(step, FormStep.UNKNOWN);
});
