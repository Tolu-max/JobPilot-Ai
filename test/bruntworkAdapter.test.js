import test from 'node:test';
import assert from 'node:assert/strict';
import bruntworkAdapter from '../src/adapters/bruntwork.js';
import { FormStep } from '../src/adapters/types.js';

test('bruntwork adapter accepts received confirmation on an enhancement page', async () => {
  const page = fakeTextPage(
    "Enhance your application for Administrative & Compliance Coordinator. We've received your application and our team is reviewing your profile."
  );

  assert.equal(await bruntworkAdapter.getCurrentStep(page), FormStep.SUBMITTED);

  const submitted = await bruntworkAdapter.isSubmitted(page);
  assert.equal(submitted.submitted, true);
});

test('bruntwork adapter does not treat an enhancement heading alone as submitted proof', async () => {
  const page = fakeTextPage('Enhance your application for Administrative & Compliance Coordinator.');
  assert.equal(await bruntworkAdapter.getCurrentStep(page), FormStep.DETAILS);
  assert.equal((await bruntworkAdapter.isSubmitted(page)).submitted, false);
});

test('bruntwork adapter accepts explicit submitted confirmation', async () => {
  const page = fakeTextPage(
    "Thank you for your application. Your application has been submitted."
  );

  assert.equal(await bruntworkAdapter.getCurrentStep(page), FormStep.SUBMITTED);
  assert.equal((await bruntworkAdapter.isSubmitted(page)).submitted, true);
});

function fakeTextPage(bodyText, url = 'https://bruntworkcareers.co/applications/123') {
  return {
    url: () => url,
    locator: () => ({
      innerText: async () => bodyText,
      first() {
        return this;
      },
      isVisible: async () => false
    }),
    getByRole: () => ({
      first() {
        return this;
      },
      isVisible: async () => false
    }),
    evaluate: async () => 4
  };
}
