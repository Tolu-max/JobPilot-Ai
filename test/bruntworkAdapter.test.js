import test from 'node:test';
import assert from 'node:assert/strict';
import bruntworkAdapter from '../src/adapters/bruntwork.js';
import { FormStep } from '../src/adapters/types.js';

test('bruntwork adapter treats enhancement page as submitted proof', async () => {
  const page = fakeTextPage(
    "Enhance your application for Administrative & Compliance Coordinator. We've received your application and our team is reviewing your profile."
  );

  assert.equal(await bruntworkAdapter.getCurrentStep(page), FormStep.SUBMITTED);

  const submitted = await bruntworkAdapter.isSubmitted(page);
  assert.equal(submitted.submitted, true);
  assert.equal(submitted.markers.some((marker) => /received your application|enhance your application/i.test(marker)), true);
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
    evaluate: async () => 0
  };
}
