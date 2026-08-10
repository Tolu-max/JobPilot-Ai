import test from 'node:test';
import assert from 'node:assert/strict';
import { jobbermanAdapter } from '../src/adapters/jobberman.js';
import { FormStep } from '../src/adapters/types.js';

function fakePage(bodyText) {
  return {
    locator: () => ({
      innerText: async () => bodyText,
      first() {
        return this;
      },
      isVisible: async () => false,
      inputValue: async () => '',
      fill: async () => {}
    }),
    url: () => 'https://www.jobberman.com/listings/some-role-9kk',
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => false,
    getByRole: () => ({
      first() {
        return this;
      },
      isVisible: async () => false
    })
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

test('jobberman adapter does not treat a job detail apply button as an opened form', async () => {
  const page = fakePage('Executive Assistant Easy apply Apply here Job summary');
  page.getByRole = (_role, options = {}) => ({
    first() {
      return this;
    },
    isVisible: async () => /apply here|easy apply/i.test(String(options.name || '')),
    click: async () => {},
    waitFor: async () => {}
  });

  const step = await jobbermanAdapter.getCurrentStep(page, {});
  assert.equal(step, FormStep.DETAILS);

  await assert.rejects(
    () => jobbermanAdapter.fillStep(page, step, { config: {} }),
    /application form did not open/i
  );
});

test('jobberman adapter returns ERROR on login wall when no credentials are configured', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Please login to apply for this job'), { config: {} });
  assert.equal(step, FormStep.ERROR);
});

test('jobberman adapter returns UNKNOWN for an unrecognised page', async () => {
  const step = await jobbermanAdapter.getCurrentStep(fakePage('Some unrelated content'), {});
  assert.equal(step, FormStep.UNKNOWN);
});
